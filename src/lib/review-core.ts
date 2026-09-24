import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentDiffIndex } from "./agent-diff-index.js";
import { ReviewAuthority, reviewIdentitySchema, type ReviewActor, type ReviewIdentity } from "./review-authority.js";
import { reviewOperations, reviewCapabilitiesSchema, reviewNextActionsSchema, REVIEW_BATCH_LIMIT, type ReviewOperationName } from "./review-operations.js";
import { reviewSourceQuerySchema, reviewSourcePageSchema, REVIEW_SOURCE_LIMITS } from "./review-source-contract.js";
import { reviewCoreEventSchema, reviewRequestSchema, reviewOperationResultSchema, type ReviewOperationResult, type DurableReviewState, type ReviewCoreEvent, type ReviewCommand } from "./review-core-contract.js";
import { ReviewStore, ReviewStoreError, REVIEW_STORE_LIMITS, type ReviewTransaction } from "./review-store.js";
import { SqliteReviewStore } from "./review-sqlite.js";
import { assessSourceAnchor, createSourceAnchor, type SourceAnchor } from "./source-anchor.js";
import { inspectionManifestSchema, type InspectionManifest } from "./inspect-capture.js";
import { decodeLegacyArchive, encodeLegacyArchive, LegacyProjection, type LegacyArchive } from "./review-legacy.js";

export class ReviewCoreError extends Error {
  constructor(readonly code: "invalid_request" | "wrong_review" | "snapshot_expired" | "stale_snapshot" | "incomplete_capture" | "not_found" | "invalid_transition" | "claim_conflict" | "forbidden" | "corrupt_review") { super(code); }
}

type Json = z.infer<ReturnType<typeof z.json>>;
const json = (value: unknown): Json => z.json().parse(JSON.parse(JSON.stringify(value)));
const sameIdentity = (a: ReviewIdentity, b: ReviewIdentity) => a.reviewId === b.reviewId && a.workspaceId === b.workspaceId && a.repositoryId === b.repositoryId;
const system: ReviewActor = { id: "review-core", kind: "system" };
type SourceIdentity = Pick<InspectionManifest, "repositoryId" | "workspaceId" | "scopeDigest" | "head" | "indexDigest" | "resolvedRevisions" | "sourceDigest" | "complete" | "provenance">;
const sourceIdentity = (manifest: SourceIdentity | undefined) => manifest ? JSON.stringify([
  manifest.repositoryId, manifest.workspaceId, manifest.scopeDigest,
  manifest.head, manifest.indexDigest, manifest.resolvedRevisions,
  manifest.sourceDigest, manifest.complete, manifest.provenance ?? null,
]) : null;

// A view action replaces that actor's mark for this file occurrence, even
// after recapture. The event retains the exact historical snapshot/content;
// those changing fields must not prevent a later explicit unmark.
const viewedFileKey = (anchor: SourceAnchor) => JSON.stringify([
  anchor.repositoryId, anchor.workspaceId, anchor.scopeDigest,
  anchor.layer.kind, anchor.layer.ordinal, anchor.layer.revision ?? null,
  anchor.file.oldPath, anchor.file.newPath, anchor.file.occurrence,
]);

export interface ReviewCoreSources {
  capture: () => Promise<AgentDiffIndex>;
  get: (id: string) => AgentDiffIndex | undefined;
}
export type ReviewCoreFactory = (sources: ReviewCoreSources) => Promise<ReviewCore>;

function project(history: readonly ReviewTransaction[], identity: ReviewIdentity): DurableReviewState {
  const state: DurableReviewState = { identity, version: 0, currentSnapshotId: null, snapshots: [], comments: [], viewed: [], handoffs: [], decisions: [], legacy: null, migrationPending: false };
  const legacy = new LegacyProjection();
  let opened = false;
  for (const transaction of history) {
    for (const raw of transaction.events) {
      if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) && "version" in raw.data && typeof raw.data.version === "number" && raw.data.version > 1) throw new ReviewStoreError("unsupported_version", transaction.sequence);
      const parsed = reviewCoreEventSchema.safeParse(raw.data);
      if (raw.type !== "review.core" || !parsed.success || !sameIdentity(parsed.data.identity, identity)) throw new ReviewCoreError("corrupt_review");
      const { effect, actor } = parsed.data;
      if (!opened && effect.type !== "review.opened") throw new ReviewCoreError("corrupt_review");
      switch (effect.type) {
        case "legacy.chunk":
          if (actor.kind !== "human") throw new ReviewCoreError("corrupt_review");
          legacy.apply(effect);
          state.migrationPending = true;
          break;
        case "legacy.committed":
          if (actor.kind !== "human") throw new ReviewCoreError("corrupt_review");
          legacy.apply(effect);
          state.legacy = legacy.summary;
          state.migrationPending = false;
          if (state.comments.length) throw new ReviewCoreError("corrupt_review");
          state.comments = decodeLegacyArchive(legacy.archive).comments.map((comment) => ({
            ...comment, actor: { id: "legacy-unverified", kind: "system" }, provenance: "legacy-unverified",
            replies: comment.replies.map((reply) => ({ ...reply, actor: { id: "legacy-unverified", kind: "system" }, provenance: "legacy-unverified" })),
          }));
          break;
        case "review.opened":
          if (opened || !sameIdentity(effect.identity, identity)) throw new ReviewCoreError("corrupt_review");
          opened = true;
          break;
        case "snapshot.captured":
          if (state.snapshots.some((snapshot) => snapshot.manifest.snapshotId === effect.manifest.snapshotId)) throw new ReviewCoreError("corrupt_review");
          state.snapshots.push({ manifest: effect.manifest, fingerprints: effect.fingerprints });
          state.currentSnapshotId = effect.manifest.snapshotId;
          break;
        case "comment.recorded": {
          const index = state.comments.findIndex((comment) => comment.id === effect.comment.id);
          if (index < 0) state.comments.push(effect.comment);
          else state.comments[index] = effect.comment;
          break;
        }
        case "comment.deleted":
          if (!state.comments.some((comment) => comment.id === effect.commentId)) throw new ReviewCoreError("corrupt_review");
          state.comments = state.comments.filter((comment) => comment.id !== effect.commentId);
          break;
        case "view.recorded": {
          const key = viewedFileKey(effect.anchor);
          state.viewed = state.viewed.filter((entry) => viewedFileKey(entry.anchor) !== key || entry.actor.id !== actor.id || entry.actor.kind !== actor.kind);
          if (effect.viewed) state.viewed.push({ anchor: effect.anchor, actor });
          break;
        }
        case "handoff.recorded": {
          const index = state.handoffs.findIndex((handoff) => handoff.id === effect.handoff.id);
          if (index < 0) state.handoffs.push(effect.handoff);
          else state.handoffs[index] = effect.handoff;
          break;
        }
        case "decision.recorded": state.decisions.push(effect.decision); break;
      }
    }
    state.version = transaction.sequence;
  }
  return state;
}

const permissionFor = (command: ReviewCommand) => reviewOperations[command.op].permission;

/** Authoritative local review transitions; transports supply trusted grants. */
export class ReviewCore {
  private constructor(
    private readonly store: Pick<ReviewStore, "version" | "read" | "transact" | "compact" | "close">,
    readonly identity: ReviewIdentity,
    private readonly authority: ReviewAuthority,
    private readonly sources: ReviewCoreSources,
    private readonly now: () => number,
  ) {}

  /** Open one explicitly selected review directory without inventing a new
   * logical review on restart. Ownership is acquired before reading identity. */
  static async openWorkspace(directory: string, workspace: Pick<ReviewIdentity, "repositoryId" | "workspaceId">, authority: ReviewAuthority, sources: ReviewCore["sources"], options: Parameters<typeof ReviewCore.open>[4] = {}): Promise<ReviewCore> {
    const scope = reviewIdentitySchema.omit({ reviewId: true }).parse(workspace);
    const store = await (options.openStore ? options.openStore(directory) : SqliteReviewStore.open(directory, options.store));
    let identity: ReviewIdentity;
    try {
      if (store.version === 0) {
        identity = { ...scope, reviewId: randomUUID() };
      } else {
        const first = store.read(0, 1).records[0]?.events[0];
        if (first?.data && typeof first.data === "object" && !Array.isArray(first.data) && "version" in first.data && typeof first.data.version === "number" && first.data.version > 1) throw new ReviewStoreError("unsupported_version", 1);
        const parsed = reviewCoreEventSchema.safeParse(first?.data);
        if (first?.type !== "review.core" || !parsed.success || parsed.data.effect.type !== "review.opened" || !sameIdentity(parsed.data.identity, parsed.data.effect.identity)) throw new ReviewCoreError("corrupt_review");
        identity = parsed.data.identity;
        if (identity.repositoryId !== scope.repositoryId || identity.workspaceId !== scope.workspaceId) throw new ReviewCoreError("wrong_review");
      }
    } catch (error) { await store.close(); throw error; }
    // The regular opener validates the complete history and owns cleanup from
    // this point. Supplying the already acquired store avoids a second owner.
    return ReviewCore.open(directory, identity, authority, sources, { ...options, openStore: async () => store });
  }

  static async open(directory: string, identity: ReviewIdentity, authority: ReviewAuthority, sources: ReviewCore["sources"], options: {
    now?: () => number;
    store?: Parameters<typeof SqliteReviewStore.open>[1];
    /** Explicit driver injection for qualification; never an automatic fallback. */
    openStore?: (directory: string) => Promise<ReviewCore["store"]>;
  } = {}): Promise<ReviewCore> {
    const scope = Object.freeze(reviewIdentitySchema.parse(identity));
    const store = await (options.openStore ? options.openStore(directory) : SqliteReviewStore.open(directory, options.store));
    const core = new ReviewCore(store, scope, authority, sources, options.now ?? Date.now);
    try {
      if (store.version === 0) {
        const event = reviewCoreEventSchema.parse({ version: 1, identity: scope, actor: system, snapshotId: null, at: core.now(), effect: { type: "review.opened", identity: scope } });
        await store.transact({ key: "review.initialize", expectedVersion: 0, input: json(scope) }, () => ({ events: [{ type: "review.core", data: json(event) }], result: json(scope) }));
      }
      core.project();
      return core;
    } catch (error) { await store.close(); throw error; }
  }

  state(token: string) {
    this.authority.authorize(token, this.identity, "read");
    const state = this.project();
    const current = state.currentSnapshotId ? this.sources.get(state.currentSnapshotId) : undefined;
    const manifest = state.snapshots.find((entry) => entry.manifest.snapshotId === state.currentSnapshotId)?.manifest;
    const anchorState = (anchor: Parameters<typeof assessSourceAnchor>[0]) => current ? assessSourceAnchor(anchor, current) : { status: "unverified" as const, reason: "snapshot_expired" as const };
    return {
      ...state,
      freshness: "not-checked" as const,
      commentFreshness: state.comments.map((comment) => ({ id: comment.id, ...(comment.provenance === "legacy-unverified" || !comment.sourceAnchor ? { status: "unverified" as const, reason: "legacy" as const } : anchorState(comment.sourceAnchor)) })),
      viewedFreshness: state.viewed.map((entry) => ({ anchor: entry.anchor, ...anchorState(entry.anchor) })),
      decisionFreshness: state.decisions.map((decision) => ({
        id: decision.id,
        status: sourceIdentity(state.snapshots.find((entry) => entry.manifest.snapshotId === decision.snapshotId)?.manifest) !== sourceIdentity(manifest)
          ? "stale" as const
          : !current?.complete || sourceIdentity(current.manifest) !== sourceIdentity(manifest) ? "unverified" as const : "current" as const,
      })),
    };
  }

  capabilities(token: string) {
    const grant = this.authority.describe(token, this.identity);
    return reviewCapabilitiesSchema.parse({
      protocolVersion: 1, identity: this.identity, ...grant,
      operations: Object.values(reviewOperations).filter((operation) => grant.permissions.includes(operation.permission)).map(({ name, permission, snapshot, idempotency }) => ({ name, permission, snapshot, idempotency })),
      batch: { mode: "per-item", limit: REVIEW_BATCH_LIMIT, order: "sequential", onError: "continue" },
    });
  }

  source(token: string, input: unknown) {
    this.authority.authorize(token, this.identity, "read");
    const parsed = reviewSourceQuerySchema.safeParse(input);
    if (!parsed.success) throw new ReviewCoreError("invalid_request");
    const query = parsed.data;
    const state = this.project();
    if (!state.snapshots.some((snapshot) => snapshot.manifest.snapshotId === query.snapshotId)) throw new ReviewCoreError("not_found");
    const index = this.sources.get(query.snapshotId);
    if (!index || index.manifest?.snapshotId !== query.snapshotId) throw new ReviewCoreError("snapshot_expired");
    const file = query.fileIndex === undefined ? undefined : index.files[query.fileIndex];
    if (query.fileIndex !== undefined && !file) throw new ReviewCoreError("not_found");
    const total = file ? file.rows.length : index.files.length;
    if (query.offset > total) throw new ReviewCoreError("invalid_request");
    const entries: z.infer<typeof reviewSourcePageSchema>["entries"] = [];
    let bytes = 1024;
    let position = query.offset;
    for (; position < Math.min(total, query.offset + query.limit); position++) {
      const sourceFile = index.files[position];
      let entry: z.infer<typeof reviewSourcePageSchema>["entries"][number] = file
        ? { index: position, row: file.rows[position] }
        : { index: position, file: { index: position, path: sourceFile.newPath ?? sourceFile.oldPath ?? "", oldPath: sourceFile.oldPath, newPath: sourceFile.newPath, kind: sourceFile.kind, binary: sourceFile.isBinary, rows: sourceFile.rows.length, additions: sourceFile.additions, deletions: sourceFile.deletions } };
      let size = Buffer.byteLength(JSON.stringify(entry));
      if ("file" in entry && [entry.file.path, entry.file.oldPath, entry.file.newPath].some((path) => path && path.length > 4096)) {
        entry = { index: position, omitted: "row_too_large" }; size = 100;
      } else if ("file" in entry) {
        entry.file.anchor = createSourceAnchor(index, query.snapshotId, position);
        size = Buffer.byteLength(JSON.stringify(entry));
      }
      // Anchors repeat paths and revision metadata; bound the complete entry.
      if (size > REVIEW_SOURCE_LIMITS.entryBytes) {
        entry = { index: position, omitted: "row_too_large" }; size = 100;
      }
      if (bytes + size > REVIEW_SOURCE_LIMITS.pageBytes) break;
      entries.push(entry); bytes += size;
    }
    return reviewSourcePageSchema.parse({ identity: this.identity, snapshotId: query.snapshotId, fileIndex: query.fileIndex ?? null, offset: query.offset, next: position < total ? position : null, total, complete: index.complete, freshness: "not-checked", entries });
  }

  /** Hints reflect this projection only. execute always rechecks source,
   * version, authority and claim ownership before committing. */
  nextActions(token: string) {
    const { actor, operations } = this.capabilities(token);
    const state = this.project();
    const allowed = new Set(operations.map((operation) => operation.name));
    const actions: Array<{ operation: ReviewOperationName; handoffId?: string }> = [];
    const add = (operation: ReviewOperationName, handoffId?: string) => {
      if (allowed.has(operation)) actions.push({ operation, ...(handoffId ? { handoffId } : {}) });
    };
    if (!state.migrationPending) {
      add("capture");
      const current = state.currentSnapshotId ? this.sources.get(state.currentSnapshotId) : undefined;
      if (current) {
        if (current.files.length) { add("comment.add"); add("view.mark"); }
        if (state.comments.length) {
          add("comment.reply"); add("comment.edit"); add("comment.delete");
          add("comment.resolve"); add("comment.reopen");
        }
        add("handoff.create");
        if (current.complete) add("decision.record");
      }
      for (const handoff of state.handoffs) {
        if (handoff.status === "available" && handoff.recipient === actor.id) add("handoff.claim", handoff.id);
        if (handoff.claim?.actorId === actor.id) {
          if (handoff.status === "acknowledged") add("handoff.start", handoff.id);
          if (["acknowledged", "working"].includes(handoff.status)) add("handoff.result", handoff.id);
          if (["acknowledged", "working", "cancellation-requested"].includes(handoff.status)) add("handoff.fail", handoff.id);
          if (handoff.status === "cancellation-requested") add("handoff.cancel-confirm", handoff.id);
        }
        if (["available", "acknowledged", "working"].includes(handoff.status)) add("handoff.cancel", handoff.id);
        if (["available", "acknowledged", "working", "cancellation-requested"].includes(handoff.status)) add("handoff.expire", handoff.id);
        if (["acknowledged", "working", "failed", "expired", "cancelled", "outcome-unknown"].includes(handoff.status)) add("handoff.reclaim", handoff.id);
      }
    }
    return reviewNextActionsSchema.parse({ identity: this.identity, version: state.version, snapshotId: state.currentSnapshotId, actions, requiresServerValidation: true });
  }

  events(token: string, cursor: ReviewIdentity & { after: number }, limit = 100) {
    this.authority.authorize(token, this.identity, "read");
    if (!sameIdentity(cursor, this.identity)) throw new ReviewCoreError("wrong_review");
    const page = { ...this.store.read(cursor.after, limit), identity: { ...this.identity } };
    while (Buffer.byteLength(JSON.stringify(page)) > REVIEW_STORE_LIMITS.replayBytes && page.records.length > 1) {
      page.records.pop();
      page.next = page.records.at(-1)!.sequence;
    }
    return page;
  }

  /** The sent discussion and baseline are historical projections, never joins
   * against today's editable comments. No source recapture is needed. */
  handoff(token: string, id: string) {
    this.authority.authorize(token, this.identity, "read");
    const history = this.history();
    const state = project(history, this.identity);
    const handoff = state.handoffs.find((entry) => entry.id === id);
    if (!handoff) throw new ReviewCoreError("not_found");
    const sentIndex = history.findIndex((transaction) => transaction.events.some((raw) => {
      const { effect } = reviewCoreEventSchema.parse(raw.data);
      return effect.type === "handoff.recorded" && effect.handoff.id === id;
    }));
    if (sentIndex < 0) throw new ReviewCoreError("corrupt_review");
    const sentState = project(history.slice(0, sentIndex + 1), this.identity);
    const sentHandoff = sentState.handoffs.find((entry) => entry.id === id)!;
    const snapshot = sentState.snapshots.find((entry) => entry.manifest.snapshotId === sentHandoff.snapshotId);
    if (!snapshot || sentHandoff.status !== "available") throw new ReviewCoreError("corrupt_review");
    const comments = sentHandoff.commentIds.map((commentId) => {
      const comment = sentState.comments.find((entry) => entry.id === commentId);
      if (!comment) throw new ReviewCoreError("corrupt_review");
      return comment;
    });
    return {
      identity: { ...this.identity }, version: state.version, handoff,
      sent: { sequence: history[sentIndex].sequence, handoff: sentHandoff, comments, snapshot },
    };
  }

  /** Explicit import into a new review. This never activates or rewrites legacy stores. */
  async importLegacy(token: string, archive: LegacyArchive) {
    this.authority.authorize(token, this.identity, "decide");
    const encoded = encodeLegacyArchive(archive);
    const effects: ReviewCoreEvent["effect"][] = encoded.chunks.map((base64, index) => ({ type: "legacy.chunk", id: encoded.id, index, total: encoded.chunks.length, base64 }));
    effects.push({ type: "legacy.committed", id: encoded.id });
    for (const [index, effect] of effects.entries()) {
      await this.store.transact({ key: `review.legacy.${encoded.id}.${index}`, expectedVersion: index + 1, input: json({ identity: this.identity, effect }) }, () => {
        const actor = this.authority.authorize(token, this.identity, "decide");
        const event = reviewCoreEventSchema.parse({ version: 1, identity: this.identity, actor, snapshotId: null, at: this.now(), effect });
        return { events: [{ type: "review.core", data: json(event) }], result: { id: encoded.id, index } };
      });
      // A queued/retried import must not outlive a revoked grant.
      this.authority.authorize(token, this.identity, "decide");
    }
    return this.project().legacy!;
  }

  /** Read-only recovery export; retains exact bytes and all unknown legacy fields. */
  exportLegacy(token: string): LegacyArchive | null {
    this.authority.authorize(token, this.identity, "read");
    const legacy = new LegacyProjection();
    let after = 0;
    for (;;) {
      const page = this.store.read(after, 1000);
      for (const transaction of page.records) for (const raw of transaction.events) {
        const event = reviewCoreEventSchema.parse(raw.data);
        if (event.effect.type === "legacy.chunk" || event.effect.type === "legacy.committed") legacy.apply(event.effect);
      }
      if (page.next === null) break;
      after = page.next;
    }
    return legacy.archive;
  }

  async execute(token: string, input: unknown): Promise<Omit<ReviewTransaction, "result"> & { result: ReviewOperationResult }> {
    const parsed = reviewRequestSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new ReviewCoreError("invalid_request"));
    const request = parsed.data;
    if (!sameIdentity(request, this.identity)) return Promise.reject(new ReviewCoreError("wrong_review"));
    const actor = this.authority.authorize(token, this.identity, permissionFor(request.command));
    const transaction = await this.store.transact({ key: request.requestId, expectedVersion: request.expectedVersion, input: json({ request, actor: { id: actor.id, kind: actor.kind } }) }, async (history) => {
      const state = project(history, this.identity);
      if (state.migrationPending) throw new ReviewStoreError("migration_required");
      // Revocation and expiration are rechecked after waiting behind prior writes.
      this.authority.authorize(token, this.identity, permissionFor(request.command));
      const command = request.command;
      const at = this.now();
      const effects: ReviewCoreEvent["effect"][] = [];
      let resultId: string | undefined;
      const current = () => {
        if (!request.snapshotId || request.snapshotId !== state.currentSnapshotId) throw new ReviewCoreError("stale_snapshot");
        return request.snapshotId;
      };
      const source = () => {
        const snapshotId = current();
        const index = this.sources.get(snapshotId);
        if (!index || index.manifest?.snapshotId !== snapshotId) throw new ReviewCoreError("snapshot_expired");
        return index;
      };
      const verifyCurrentSource = async () => {
        const snapshotId = current();
        const recorded = state.snapshots.find((entry) => entry.manifest.snapshotId === snapshotId)?.manifest;
        const observed = (await this.sources.capture()).manifest;
        this.authority.authorize(token, this.identity, permissionFor(command));
        if (!recorded || !observed || sourceIdentity(recorded) !== sourceIdentity(observed)) throw new ReviewCoreError("stale_snapshot");
      };
      if (command.op === "capture") {
        if (request.snapshotId !== null) throw new ReviewCoreError("invalid_request");
        const index = await this.sources.capture();
        this.authority.authorize(token, this.identity, "capture");
        const manifest = index.manifest;
        if (!manifest || manifest.workspaceId !== this.identity.workspaceId || manifest.repositoryId !== this.identity.repositoryId) throw new ReviewCoreError("wrong_review");
        resultId = manifest.snapshotId;
        const existing = state.snapshots.find((snapshot) => snapshot.manifest.snapshotId === manifest.snapshotId);
        if (existing && sourceIdentity(existing.manifest) !== sourceIdentity(manifest)) throw new ReviewCoreError("stale_snapshot");
        if (state.snapshots.some((snapshot) => snapshot.manifest.snapshotId === manifest.snapshotId) && state.currentSnapshotId !== manifest.snapshotId) throw new ReviewCoreError("stale_snapshot");
        if (!state.snapshots.some((snapshot) => snapshot.manifest.snapshotId === manifest.snapshotId)) {
          const fingerprints: Record<string, string> = Object.create(null);
          for (const [fileIndex, file] of index.files.entries()) {
            const key = createHash("sha256").update(JSON.stringify([fileIndex, file.oldPath, file.newPath, file.source?.layerId])).digest("hex");
            fingerprints[key] = file.metadata.patchDigest;
          }
          effects.push({ type: "snapshot.captured", manifest: inspectionManifestSchema.parse(manifest), fingerprints });
        }
      } else if (command.op === "comment.add") {
        const index = source();
        const anchor = createSourceAnchor(index, current(), command.fileIndex, { side: command.side, start: command.startLineNumber ?? command.lineNumber, end: command.lineNumber });
        const file = index.files[command.fileIndex];
        const lineContent = file.rows.flatMap((row) => {
          if (row.type !== "line") return [];
          const line = command.side === "additions" ? row.newLineno : row.oldLineno;
          return line != null && line >= (command.startLineNumber ?? command.lineNumber) && line <= command.lineNumber ? [row.content] : [];
        }).join("\n");
        resultId = randomUUID();
        effects.push({ type: "comment.recorded", comment: {
          id: resultId, filePath: file.newPath ?? file.oldPath ?? "", side: command.side,
          lineNumber: command.lineNumber, ...(command.startLineNumber ? { startLineNumber: command.startLineNumber } : {}),
          lineContent, body: command.body, status: "open", createdAt: at, replies: [], sourceAnchor: anchor, actor,
        } });
      } else if (command.op === "comment.reply" || command.op === "comment.resolve" || command.op === "comment.reopen") {
        current();
        if (command.op === "comment.resolve") await verifyCurrentSource();
        const comment = state.comments.find((entry) => entry.id === command.commentId);
        if (!comment) throw new ReviewCoreError("not_found");
        if (command.op === "comment.reply") comment.replies.push({ id: randomUUID(), body: command.body, createdAt: at, role: actor.kind === "human" ? "user" : "agent", actor });
        else if (command.op === "comment.resolve") {
          comment.status = "resolved";
          comment.resolution = { actor, reason: command.reason, snapshotId: current(), at };
        } else {
          comment.status = "open";
          // Preserve prior resolutions in the event history, not as the live
          // reason for an open thread.
          delete comment.resolution;
          comment.reopened = { actor, reason: command.reason, snapshotId: current(), at };
        }
        resultId = comment.id;
        effects.push({ type: "comment.recorded", comment });
      } else if (command.op === "comment.edit" || command.op === "comment.delete" || command.op === "reply.edit" || command.op === "reply.delete") {
        current();
        const comment = state.comments.find((entry) => entry.id === command.commentId);
        if (!comment) throw new ReviewCoreError("not_found");
        const canEdit = (owner: unknown) => {
          const recorded = owner as Partial<ReviewActor> | undefined;
          if (recorded?.id !== actor.id || recorded?.kind !== actor.kind) this.authority.authorize(token, this.identity, "decide");
        };
        resultId = comment.id;
        if (command.op === "comment.edit" || command.op === "comment.delete") {
          canEdit(comment.actor);
          // Deleting an agent-authored thread cannot discard somebody else's
          // reply. A human can explicitly remove the whole discussion.
          if (command.op === "comment.delete") {
            for (const reply of comment.replies) canEdit(reply.actor);
            effects.push({ type: "comment.deleted", commentId: comment.id });
          } else {
            comment.body = command.body;
            effects.push({ type: "comment.recorded", comment });
          }
        } else {
          const reply = comment.replies.find((entry) => entry.id === command.replyId);
          if (!reply) throw new ReviewCoreError("not_found");
          canEdit(reply.actor);
          if (command.op === "reply.edit") reply.body = command.body;
          else comment.replies = comment.replies.filter((entry) => entry.id !== command.replyId);
          effects.push({ type: "comment.recorded", comment });
        }
      } else if (command.op === "view.mark") {
        effects.push({ type: "view.recorded", anchor: createSourceAnchor(source(), current(), command.fileIndex), viewed: command.viewed });
      } else if (command.op === "handoff.create") {
        current();
        await verifyCurrentSource();
        if (new Set(command.commentIds).size !== command.commentIds.length || command.commentIds.some((id) => !state.comments.some((comment) => comment.id === id))) throw new ReviewCoreError("not_found");
        resultId = randomUUID();
        effects.push({ type: "handoff.recorded", handoff: { id: resultId, round: state.handoffs.length + 1, snapshotId: current(), actor, recipient: command.recipient, instructions: command.instructions, commentIds: command.commentIds, sentAt: at, status: "available", epoch: 0 } });
      } else if (command.op === "decision.record") {
        const snapshotId = current();
        await verifyCurrentSource();
        const snapshot = state.snapshots.find((entry) => entry.manifest.snapshotId === snapshotId)!;
        if (command.decision === "approved" && !snapshot.manifest.complete) throw new ReviewCoreError("incomplete_capture");
        if (command.handoffId) {
          const handoff = state.handoffs.find((entry) => entry.id === command.handoffId);
          if (!handoff) throw new ReviewCoreError("not_found");
          if (handoff.status !== "awaiting-human" || handoff.result?.snapshotId !== snapshotId) throw new ReviewCoreError("stale_snapshot");
          handoff.status = "reviewed";
          effects.push({ type: "handoff.recorded", handoff });
        }
        resultId = randomUUID();
        effects.push({ type: "decision.recorded", decision: { id: resultId, snapshotId, actor, decision: command.decision, rationale: command.rationale, decidedAt: at, ...(command.handoffId ? { handoffId: command.handoffId } : {}) } });
      } else {
        const handoff = state.handoffs.find((entry) => entry.id === command.handoffId);
        if (!handoff) throw new ReviewCoreError("not_found");
        if (request.snapshotId !== handoff.snapshotId) throw new ReviewCoreError("stale_snapshot");
        resultId = handoff.id;
        const requireStatus = (...statuses: typeof handoff.status[]) => {
          if (!statuses.includes(handoff.status)) throw new ReviewCoreError("invalid_transition");
        };
        if ("claimId" in command && (actor.kind !== "agent" || !handoff.claim || handoff.claim.id !== command.claimId || handoff.claim.actorId !== actor.id || handoff.epoch !== command.epoch)) throw new ReviewCoreError("claim_conflict");
        switch (command.op) {
          case "handoff.claim":
            requireStatus("available");
            if (actor.kind !== "agent" || handoff.recipient !== actor.id) throw new ReviewCoreError("forbidden");
            if (handoff.snapshotId !== state.currentSnapshotId) throw new ReviewCoreError("stale_snapshot");
            await verifyCurrentSource();
            handoff.claim = { id: randomUUID(), actorId: actor.id, acknowledgedAt: at };
            handoff.epoch++;
            handoff.status = "acknowledged";
            break;
          case "handoff.start": requireStatus("acknowledged"); await verifyCurrentSource(); handoff.status = "working"; break;
          case "handoff.result":
            requireStatus("working", "acknowledged");
            if (command.resultSnapshotId !== state.currentSnapshotId) throw new ReviewCoreError("stale_snapshot");
            handoff.result = { id: randomUUID(), snapshotId: command.resultSnapshotId, actor, body: command.body, submittedAt: at };
            handoff.status = "awaiting-human";
            break;
          case "handoff.fail": requireStatus("acknowledged", "working", "cancellation-requested"); handoff.status = command.outcome; handoff.reason = command.reason; break;
          case "handoff.cancel": requireStatus("available", "acknowledged", "working"); handoff.status = handoff.claim ? "cancellation-requested" : "cancelled"; handoff.reason = command.reason; break;
          case "handoff.cancel-confirm": requireStatus("cancellation-requested"); handoff.status = "cancelled"; break;
          case "handoff.expire": requireStatus("available", "acknowledged", "working", "cancellation-requested"); handoff.status = "expired"; handoff.reason = command.reason; break;
          case "handoff.reclaim":
            requireStatus("acknowledged", "working", "expired", "failed", "outcome-unknown", "cancelled");
            handoff.epoch++;
            delete handoff.claim;
            delete handoff.result;
            handoff.recipient = command.recipient;
            handoff.reason = command.reason;
            handoff.status = "available";
            break;
        }
        effects.push({ type: "handoff.recorded", handoff });
      }
      const events = effects.map((effect) => ({ type: "review.core", data: json(reviewCoreEventSchema.parse({ version: 1, identity: this.identity, actor, snapshotId: command.op === "capture" ? resultId : request.snapshotId, at, effect })) }));
      return { events, result: json(reviewOperationResultSchema.parse({ identity: this.identity, snapshotId: command.op === "capture" ? resultId : request.snapshotId, actor, operation: command.op, id: resultId ?? null, sequence: state.version + 1 })) };
    });
    const result = reviewOperationResultSchema.safeParse(transaction.result);
    if (!result.success || !sameIdentity(result.data.identity, this.identity) || result.data.sequence !== transaction.sequence) throw new ReviewCoreError("corrupt_review");
    return { ...transaction, result: result.data };
  }

  close() { return this.store.close(); }
  compact() { return this.store.compact(); }

  private project(): DurableReviewState {
    return project(this.history(), this.identity);
  }

  private history(): ReviewTransaction[] {
    const history: ReviewTransaction[] = [];
    let after = 0;
    do {
      const page = this.store.read(after, 1000);
      history.push(...page.records);
      if (page.next === null) break;
      if (page.next <= after) throw new ReviewStoreError("corrupt_store");
      after = page.next;
    } while (true);
    return history;
  }
}
