import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentDiffIndex } from "./agent-diff-index.js";
import { ReviewAuthority, reviewIdentitySchema, type ReviewActor, type ReviewIdentity, type ReviewPermission } from "./review-authority.js";
import { reviewCoreEventSchema, reviewRequestSchema, reviewOperationResultSchema, type ReviewOperationResult, type DurableReviewState, type ReviewCoreEvent, type ReviewCommand } from "./review-core-contract.js";
import { ReviewStore, ReviewStoreError, REVIEW_STORE_LIMITS, type ReviewTransaction } from "./review-store.js";
import { assessSourceAnchor, createSourceAnchor } from "./source-anchor.js";
import { inspectionManifestSchema, type InspectionManifest } from "./inspect-capture.js";

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

function project(history: readonly ReviewTransaction[], identity: ReviewIdentity): DurableReviewState {
  const state: DurableReviewState = { identity, version: 0, currentSnapshotId: null, snapshots: [], comments: [], viewed: [], handoffs: [], decisions: [] };
  let opened = false;
  for (const transaction of history) {
    for (const raw of transaction.events) {
      if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) && "version" in raw.data && typeof raw.data.version === "number" && raw.data.version > 1) throw new ReviewStoreError("unsupported_version", transaction.sequence);
      const parsed = reviewCoreEventSchema.safeParse(raw.data);
      if (raw.type !== "review.core" || !parsed.success || !sameIdentity(parsed.data.identity, identity)) throw new ReviewCoreError("corrupt_review");
      const { effect, actor } = parsed.data;
      if (!opened && effect.type !== "review.opened") throw new ReviewCoreError("corrupt_review");
      switch (effect.type) {
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
        case "view.recorded": {
          const key = JSON.stringify(effect.anchor);
          state.viewed = state.viewed.filter((entry) => JSON.stringify(entry.anchor) !== key || entry.actor.id !== actor.id);
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

const permissionFor = (command: ReviewCommand): ReviewPermission => {
  if (command.op === "capture") return "capture";
  if (command.op === "comment.resolve" || command.op === "decision.record" || ["handoff.cancel", "handoff.expire", "handoff.reclaim"].includes(command.op)) return "decide";
  if (command.op === "handoff.create") return "handoff";
  if (command.op.startsWith("handoff.")) return "work";
  return "comment";
};

/** Authoritative local review transitions; transports supply trusted grants. */
export class ReviewCore {
  private constructor(
    private readonly store: Pick<ReviewStore, "version" | "read" | "transact" | "compact" | "close">,
    readonly identity: ReviewIdentity,
    private readonly authority: ReviewAuthority,
    private readonly sources: { capture: () => Promise<AgentDiffIndex>; get: (id: string) => AgentDiffIndex | undefined },
    private readonly now: () => number,
  ) {}

  static async open(directory: string, identity: ReviewIdentity, authority: ReviewAuthority, sources: ReviewCore["sources"], options: {
    now?: () => number;
    store?: Parameters<typeof ReviewStore.open>[1];
    /** Driver qualification seam; application migration is a separate operation. */
    openStore?: (directory: string) => Promise<ReviewCore["store"]>;
  } = {}): Promise<ReviewCore> {
    const scope = Object.freeze(reviewIdentitySchema.parse(identity));
    const store = await (options.openStore ? options.openStore(directory) : ReviewStore.open(directory, options.store));
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
      commentFreshness: state.comments.map((comment) => ({ id: comment.id, ...anchorState(comment.sourceAnchor) })),
      viewedFreshness: state.viewed.map((entry) => ({ anchor: entry.anchor, ...anchorState(entry.anchor) })),
      decisionFreshness: state.decisions.map((decision) => ({ id: decision.id, status: sourceIdentity(state.snapshots.find((entry) => entry.manifest.snapshotId === decision.snapshotId)?.manifest) === sourceIdentity(manifest) ? "current" as const : "stale" as const })),
    };
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

  async execute(token: string, input: unknown): Promise<Omit<ReviewTransaction, "result"> & { result: ReviewOperationResult }> {
    const parsed = reviewRequestSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new ReviewCoreError("invalid_request"));
    const request = parsed.data;
    if (!sameIdentity(request, this.identity)) return Promise.reject(new ReviewCoreError("wrong_review"));
    const actor = this.authority.authorize(token, this.identity, permissionFor(request.command));
    const transaction = await this.store.transact({ key: request.requestId, expectedVersion: request.expectedVersion, input: json({ request, actor: { id: actor.id, kind: actor.kind } }) }, async (history) => {
      const state = project(history, this.identity);
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
      } else if (command.op === "comment.reply" || command.op === "comment.resolve") {
        current();
        if (command.op === "comment.resolve") await verifyCurrentSource();
        const comment = state.comments.find((entry) => entry.id === command.commentId);
        if (!comment) throw new ReviewCoreError("not_found");
        if (command.op === "comment.reply") comment.replies.push({ id: randomUUID(), body: command.body, createdAt: at, role: actor.kind === "human" ? "user" : "agent", actor });
        else {
          comment.status = "resolved";
          comment.resolution = { actor, reason: command.reason, snapshotId: current(), at };
        }
        resultId = comment.id;
        effects.push({ type: "comment.recorded", comment });
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
        if ("claimId" in command && (!handoff.claim || handoff.claim.id !== command.claimId || handoff.claim.actorId !== actor.id || handoff.epoch !== command.epoch)) throw new ReviewCoreError("claim_conflict");
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
    const history: ReviewTransaction[] = [];
    let after = 0;
    do {
      const page = this.store.read(after, 1000);
      history.push(...page.records);
      if (page.next === null) break;
      if (page.next <= after) throw new ReviewStoreError("corrupt_store");
      after = page.next;
    } while (true);
    return project(history, this.identity);
  }
}
