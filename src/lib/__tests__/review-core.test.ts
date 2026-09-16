// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "../diff-options.js";
import { AgentDiffIndexCache } from "../agent-diff-index.js";
import { captureInspection, type InspectionIdentity } from "../inspect-capture.js";
import { ReviewAuthority, ReviewAuthorityError, type ReviewActor, type ReviewIdentity } from "../review-authority.js";
import { ReviewCore } from "../review-core.js";
import type { ReviewCommand } from "../review-core-contract.js";

const identity: ReviewIdentity = { reviewId: "00000000-0000-4000-8000-000000000001", repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
const human: ReviewActor = { id: "human-1", kind: "human" };
const agent: ReviewActor = { id: "agent-1", kind: "agent" };
const agent2: ReviewActor = { id: "agent-2", kind: "agent" };
const activeCores: ReviewCore[] = [];
const activeDirectories: string[] = [];
const patches = {
  one: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+one\n",
  two: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+two\n",
  cr: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+two\r\n",
};

const identityCallback = (): (() => Promise<InspectionIdentity>) => async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: "c".repeat(40), indexDigest: "d".repeat(64), resolvedRevisions: [] });

async function captureIndex(snapshotId: string, patch: string, complete = true) {
  const result = await captureInspection(
    { ...DEFAULTS },
    async () => ({ patch, complete, layers: [{ kind: "working" as const, patch }] }),
    identityCallback(),
    { now: () => 100 },
  );
  result.manifest.snapshotId = snapshotId;
  return new AgentDiffIndexCache().getOrBuild(result.patch, result.complete, undefined, result.manifest);
}

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "diffing-review-core-"));
  activeDirectories.push(directory);
  const authority = new ReviewAuthority(() => 100);
  const humanToken = authority.issue(identity, human, ["read", "capture", "comment", "handoff", "decide", "work"]);
  const agentToken = authority.issue(identity, agent, ["read", "capture", "comment", "handoff", "work"]);
  const agent2Token = authority.issue(identity, agent2, ["read", "capture", "comment", "handoff", "work"]);
  const sourceMap = new Map<string, Awaited<ReturnType<typeof captureIndex>>>();
  let next: { id: string; patch: string; complete?: boolean } = { id: "00000000-0000-4000-8000-000000000010", patch: patches.one };
  const capture = vi.fn(async () => {
      const index = await captureIndex(next.id, next.patch, next.complete ?? true);
      sourceMap.set(next.id, index);
      return index;
  });
  const core = await ReviewCore.open(directory, identity, authority, {
    capture,
    get: (id) => sourceMap.get(id),
  }, { now: () => 100 });
  activeCores.push(core);
  return { directory, authority, core, sourceMap, capture, humanToken, agentToken, agent2Token, setNext: (value: typeof next) => { next = value; } };
}

type CoreTransaction = Awaited<ReturnType<ReviewCore["execute"]>>;
function coreResult(transaction: CoreTransaction) { return transaction.result; }
function request(core: ReviewCore, token: string, command: ReviewCommand, snapshotId: string | null, requestId: string, expectedVersion?: number) {
  const state = core.state(token);
  return core.execute(token, { ...identity, version: 1, requestId, expectedVersion: expectedVersion ?? state.version, snapshotId, command });
}

afterEach(async () => {
  for (const core of activeCores.splice(0)) await core.close();
  for (const directory of activeDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("ReviewCore", () => {
  it("preserves captured comments, anchors, text, actor, and views across reopen", async () => {
    const h = await harness();
    const captured = await request(h.core, h.humanToken, { op: "capture" }, null, "capture-1");
    const snapshot = coreResult(captured).snapshotId!;
    const comment = await request(h.core, h.humanToken, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "keep" }, snapshot, "comment-1");
    await request(h.core, h.humanToken, { op: "view.mark", fileIndex: 0, viewed: true }, snapshot, "view-1");
    const before = h.core.state(h.humanToken);
    await h.core.close();
    const reopened = await ReviewCore.open(h.directory, identity, h.authority, { capture: async () => { throw new Error("unused"); }, get: (id) => h.sourceMap.get(id) }, { now: () => 100 });
    activeCores.push(reopened);
    expect(reopened.state(h.humanToken)).toEqual(before);
    expect(reopened.state(h.humanToken).comments[0]).toMatchObject({ id: coreResult(comment).id, body: "keep", actor: human });
  });

  it("runs handoff through acknowledged work and human approval while preserving event order", async () => {
    const h = await harness();
    const captured = await request(h.core, h.humanToken, { op: "capture" }, null, "capture-1");
    const snapshot = coreResult(captured).snapshotId!;
    const comment = await request(h.core, h.humanToken, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "fix" }, snapshot, "comment-1");
    const handoff = await request(h.core, h.humanToken, { op: "handoff.create", recipient: agent.id, instructions: "fix it", commentIds: [coreResult(comment).id!] }, snapshot, "handoff-1");
    const id = coreResult(handoff).id!;
    await request(h.core, h.agentToken, { op: "handoff.claim", handoffId: id }, snapshot, "claim-1");
    const claimId = h.core.state(h.agentToken).handoffs[0].claim!.id;
    const epoch = h.core.state(h.agentToken).handoffs[0].epoch;
    await request(h.core, h.agentToken, { op: "handoff.start", handoffId: id, claimId, epoch }, snapshot, "start-1");
    h.setNext({ id: "00000000-0000-4000-8000-000000000011", patch: patches.two });
    const latest = await request(h.core, h.agentToken, { op: "capture" }, null, "capture-2");
    const latestSnapshot = coreResult(latest).snapshotId!;
    const result = await request(h.core, h.agentToken, { op: "handoff.result", handoffId: id, claimId, epoch, resultSnapshotId: latestSnapshot, body: "done" }, snapshot, "result-1");
    expect(coreResult(result).snapshotId).toBe(snapshot);
    await request(h.core, h.humanToken, { op: "decision.record", decision: "approved", rationale: "accepted", handoffId: id }, latestSnapshot, "decision-1");
    const state = h.core.state(h.humanToken);
    expect(state.handoffs[0].status).toBe("reviewed");
    expect(state.comments[0].status).toBe("open");
    expect(state.decisions[0]).toMatchObject({ decision: "approved", snapshotId: latestSnapshot });
    const sequences: number[] = [];
    let after = 0;
    for (;;) {
      const page = h.core.events(h.humanToken, { ...identity, after }, 2);
      expect(page.records.length).toBeLessThanOrEqual(2);
      sequences.push(...page.records.map((record) => record.sequence));
      if (page.next === null) break;
      expect(page.next).toBeGreaterThan(after);
      after = page.next;
    }
    expect(sequences).toEqual(Array.from({ length: state.version }, (_, index) => index + 1));
    await h.core.close();
    const reopened = await ReviewCore.open(h.directory, identity, h.authority, { capture: async () => { throw new Error("unexpected capture"); }, get: (id) => h.sourceMap.get(id) });
    activeCores.push(reopened);
    expect(reopened.state(h.humanToken).handoffs[0]).toEqual(state.handoffs[0]);
    expect(reopened.state(h.humanToken).decisions[0]).toEqual(state.decisions[0]);
  });

  it("deduplicates identical requests and rejects changed payloads or stale versions", async () => {
    const h = await harness();
    const first = await request(h.core, h.humanToken, { op: "capture" }, null, "same");
    const duplicate = await request(h.core, h.humanToken, { op: "capture" }, null, "same", 1);
    expect(duplicate).toEqual(first);
    expect(h.capture).toHaveBeenCalledTimes(1);
    await expect(request(h.core, h.humanToken, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "changed" }, coreResult(first).snapshotId, "same", 1)).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(request(h.core, h.humanToken, { op: "capture" }, null, "stale", 1)).rejects.toMatchObject({ code: "version_conflict" });
    await h.core.close();
    const reopened = await ReviewCore.open(h.directory, identity, h.authority, { capture: async () => { throw new Error("unexpected capture"); }, get: () => undefined });
    activeCores.push(reopened);
    await expect(request(reopened, h.humanToken, { op: "capture" }, null, "same", 1)).resolves.toEqual(first);
  });

  it("replays comment, reply and handoff retries after restart without another append", async () => {
    const h = await harness();
    const captured = await request(h.core, h.humanToken, { op: "capture" }, null, "capture");
    const snapshot = captured.result.snapshotId;
    const add: ReviewCommand = { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "concern" };
    const comment = await request(h.core, h.humanToken, add, snapshot, "comment");
    const reply: ReviewCommand = { op: "comment.reply", commentId: comment.result.id!, body: "context" };
    const replied = await request(h.core, h.humanToken, reply, snapshot, "reply");
    const send: ReviewCommand = { op: "handoff.create", recipient: agent.id, instructions: "fix concern", commentIds: [comment.result.id!] };
    const handoff = await request(h.core, h.humanToken, send, snapshot, "handoff");
    await h.core.close();
    const bytes = await readFile(join(h.directory, "review.jsonl"));
    const reopened = await ReviewCore.open(h.directory, identity, h.authority, { capture: async () => { throw new Error("Duplicate reran capture"); }, get: () => undefined });
    activeCores.push(reopened);
    for (const [command, id, original] of [[add, "comment", comment], [reply, "reply", replied], [send, "handoff", handoff]] as const) {
      expect(await request(reopened, h.humanToken, command, snapshot, id, original.sequence - 1)).toEqual(original);
    }
    expect(await readFile(join(h.directory, "review.jsonl"))).toEqual(bytes);
    const state = reopened.state(h.humanToken);
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0].replies).toHaveLength(1);
    expect(state.handoffs).toHaveLength(1);
    expect(state.handoffs[0].round).toBe(1);
  });

  it("denies wrong identity and unauthorized actor commands without appending", async () => {
    const h = await harness();
    const before = h.core.state(h.humanToken).version;
    await expect(h.core.execute(h.humanToken, { ...identity, workspaceId: "e".repeat(64), version: 1, requestId: "wrong", expectedVersion: before, snapshotId: null, command: { op: "capture" } })).rejects.toMatchObject({ code: "wrong_review" });
    await expect(request(h.core, h.agentToken, { op: "decision.record", decision: "approved", rationale: "no" }, null, "agent-decision")).rejects.toThrow(ReviewAuthorityError);
    await expect(request(h.core, h.agentToken, { op: "comment.resolve", commentId: "none", reason: "no" }, null, "agent-resolve")).rejects.toThrow(ReviewAuthorityError);
    await expect(h.core.execute(h.humanToken, { ...identity, version: 1, requestId: "unknown", expectedVersion: before, snapshotId: null, command: { op: "capture", extra: true }, actor: human, role: "human" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(h.core.state(h.humanToken).version).toBe(before);
  });

  it("fences wrong recipients, stale claims, and old results after reclaim", async () => {
    const h = await harness();
    const captured = await request(h.core, h.humanToken, { op: "capture" }, null, "capture");
    const snapshot = coreResult(captured).snapshotId!;
    const comment = await request(h.core, h.humanToken, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "x" }, snapshot, "comment");
    const handoff = await request(h.core, h.humanToken, { op: "handoff.create", recipient: agent.id, instructions: "x", commentIds: [coreResult(comment).id!] }, snapshot, "handoff");
    const id = coreResult(handoff).id!;
    await expect(request(h.core, h.agent2Token, { op: "handoff.claim", handoffId: id }, snapshot, "claim-wrong")).rejects.toMatchObject({ code: "forbidden" });
    await request(h.core, h.agentToken, { op: "handoff.claim", handoffId: id }, snapshot, "claim");
    const oldClaim = h.core.state(h.agentToken).handoffs[0].claim!;
    await request(h.core, h.humanToken, { op: "handoff.reclaim", handoffId: id, recipient: agent2.id, reason: "reassign" }, snapshot, "reclaim");
    await expect(request(h.core, h.agentToken, { op: "handoff.start", handoffId: id, claimId: oldClaim.id, epoch: h.core.state(h.agentToken).handoffs[0].epoch - 1 }, snapshot, "old-start")).rejects.toMatchObject({ code: "claim_conflict" });
    const newClaim = await request(h.core, h.agent2Token, { op: "handoff.claim", handoffId: id }, snapshot, "claim-2");
    expect(coreResult(newClaim).id).toBe(id);
    const replacement = h.core.state(h.agent2Token).handoffs[0];
    await expect(request(h.core, h.agentToken, { op: "handoff.result", handoffId: id, claimId: oldClaim.id, epoch: 1, resultSnapshotId: snapshot, body: "late result" }, snapshot, "old-result")).rejects.toMatchObject({ code: "claim_conflict" });
    expect(h.core.state(h.agent2Token).handoffs[0]).toEqual(replacement);
  });

  it("keeps cancellation, expiration, failure, and outcome-unknown statuses distinct", async () => {
    const h = await harness();
    const captured = await request(h.core, h.humanToken, { op: "capture" }, null, "capture");
    const snapshot = coreResult(captured).snapshotId!;
    const comment = await request(h.core, h.humanToken, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "x" }, snapshot, "comment");
    const first = await request(h.core, h.humanToken, { op: "handoff.create", recipient: agent.id, instructions: "x", commentIds: [coreResult(comment).id!] }, snapshot, "handoff-1");
    await request(h.core, h.humanToken, { op: "handoff.cancel", handoffId: coreResult(first).id!, reason: "stop" }, snapshot, "cancel");
    expect(h.core.state(h.humanToken).handoffs[0].status).toBe("cancelled");
    const second = await request(h.core, h.humanToken, { op: "handoff.create", recipient: agent.id, instructions: "x", commentIds: [coreResult(comment).id!] }, snapshot, "handoff-2");
    await request(h.core, h.humanToken, { op: "handoff.expire", handoffId: coreResult(second).id!, reason: "expired" }, snapshot, "expire");
    expect(h.core.state(h.humanToken).handoffs[1].status).toBe("expired");
    const third = await request(h.core, h.humanToken, { op: "handoff.create", recipient: agent.id, instructions: "x", commentIds: [coreResult(comment).id!] }, snapshot, "handoff-3");
    await request(h.core, h.agentToken, { op: "handoff.claim", handoffId: coreResult(third).id! }, snapshot, "claim-3");
    const claim = h.core.state(h.agentToken).handoffs[2].claim!;
    await request(h.core, h.agentToken, { op: "handoff.fail", handoffId: coreResult(third).id!, claimId: claim.id, epoch: h.core.state(h.agentToken).handoffs[2].epoch, outcome: "outcome-unknown", reason: "lost" }, snapshot, "fail");
    expect(h.core.state(h.humanToken).handoffs[2].status).toBe("outcome-unknown");
    const fourth = await request(h.core, h.humanToken, { op: "handoff.create", recipient: agent.id, instructions: "x", commentIds: [coreResult(comment).id!] }, snapshot, "handoff-4");
    await request(h.core, h.agentToken, { op: "handoff.claim", handoffId: coreResult(fourth).id! }, snapshot, "claim-4");
    const fourthClaim = h.core.state(h.agentToken).handoffs[3].claim!;
    await request(h.core, h.agentToken, { op: "handoff.start", handoffId: coreResult(fourth).id!, claimId: fourthClaim.id, epoch: h.core.state(h.agentToken).handoffs[3].epoch }, snapshot, "start-4");
    await request(h.core, h.humanToken, { op: "handoff.cancel", handoffId: coreResult(fourth).id!, reason: "stop after work" }, snapshot, "cancel-4");
    await expect(request(h.core, h.agentToken, { op: "handoff.result", handoffId: coreResult(fourth).id!, claimId: fourthClaim.id, epoch: h.core.state(h.agentToken).handoffs[3].epoch, resultSnapshotId: snapshot, body: "late" }, snapshot, "late-4")).rejects.toMatchObject({ code: "invalid_transition" });
    await request(h.core, h.agentToken, { op: "handoff.cancel-confirm", handoffId: coreResult(fourth).id!, claimId: fourthClaim.id, epoch: h.core.state(h.agentToken).handoffs[3].epoch }, snapshot, "confirm-4");
    expect(h.core.state(h.humanToken).handoffs[3].status).toBe("cancelled");
    const fifth = await request(h.core, h.humanToken, { op: "handoff.create", recipient: agent.id, instructions: "x", commentIds: [coreResult(comment).id!] }, snapshot, "handoff-5");
    await request(h.core, h.agentToken, { op: "handoff.claim", handoffId: coreResult(fifth).id! }, snapshot, "claim-5");
    const fifthClaim = h.core.state(h.agentToken).handoffs[4].claim!;
    await request(h.core, h.agentToken, { op: "handoff.fail", handoffId: coreResult(fifth).id!, claimId: fifthClaim.id, epoch: h.core.state(h.agentToken).handoffs[4].epoch, outcome: "failed", reason: "failed" }, snapshot, "fail-5");
    expect(h.core.state(h.humanToken).handoffs[4].status).toBe("failed");
  });

  it("rejects stale result snapshots, incomplete approvals, and unavailable sources", async () => {
    const h = await harness();
    const first = await request(h.core, h.humanToken, { op: "capture" }, null, "capture-1");
    const snapshot = coreResult(first).snapshotId!;
    const comment = await request(h.core, h.humanToken, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "x" }, snapshot, "comment");
    const handoff = await request(h.core, h.humanToken, { op: "handoff.create", recipient: agent.id, instructions: "x", commentIds: [coreResult(comment).id!] }, snapshot, "handoff");
    await request(h.core, h.agentToken, { op: "handoff.claim", handoffId: coreResult(handoff).id! }, snapshot, "claim");
    const claim = h.core.state(h.agentToken).handoffs[0].claim!;
    await request(h.core, h.agentToken, { op: "handoff.start", handoffId: coreResult(handoff).id!, claimId: claim.id, epoch: h.core.state(h.agentToken).handoffs[0].epoch }, snapshot, "start");
    await expect(request(h.core, h.agentToken, { op: "handoff.result", handoffId: coreResult(handoff).id!, claimId: claim.id, epoch: h.core.state(h.agentToken).handoffs[0].epoch, resultSnapshotId: "00000000-0000-4000-8000-000000000099", body: "late" }, snapshot, "bad-result")).rejects.toMatchObject({ code: "stale_snapshot" });
    h.setNext({ id: "00000000-0000-4000-8000-000000000012", patch: patches.two, complete: false });
    const incomplete = await request(h.core, h.humanToken, { op: "capture" }, null, "capture-incomplete");
    const incompleteSnapshot = coreResult(incomplete).snapshotId!;
    await expect(request(h.core, h.humanToken, { op: "decision.record", decision: "approved", rationale: "no", handoffId: coreResult(handoff).id! }, incompleteSnapshot, "bad-approval")).rejects.toMatchObject({ code: "incomplete_capture" });
    h.sourceMap.delete(incompleteSnapshot);
    await expect(request(h.core, h.humanToken, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "gone" }, incompleteSnapshot, "missing-source")).rejects.toMatchObject({ code: "snapshot_expired" });
    h.setNext({ id: incompleteSnapshot, patch: patches.cr });
    await expect(request(h.core, h.humanToken, { op: "capture" }, null, "same-snapshot-bytes")).rejects.toMatchObject({ code: "stale_snapshot" });
  });

  it("refuses journal corruption and recovers an uncertain duplicate without rewriting", async () => {
    const h = await harness();
    const directory = h.directory;
    await expect(request(h.core, h.humanToken, { op: "capture" }, null, "capture")).resolves.toBeDefined();
    await h.core.close();
    const storePath = join(directory, "review.jsonl");
    const { readFile, writeFile } = await import("node:fs/promises");
    const bytes = await readFile(storePath, "utf8");
    await writeFile(storePath, bytes.replace("review.core", "tampered"));
    await expect(ReviewCore.open(directory, identity, h.authority, { capture: async () => { throw new Error("unused"); }, get: (id) => h.sourceMap.get(id) })).rejects.toMatchObject({ code: "corrupt_store" });
    await writeFile(storePath, bytes);
    await writeFile(storePath, bytes.replace('{"version":1,', '{"version":999,'));
    await expect(ReviewCore.open(directory, identity, h.authority, { capture: async () => { throw new Error("unused"); }, get: (id) => h.sourceMap.get(id) })).rejects.toMatchObject({ code: "unsupported_version" });
    expect(await (await import("node:fs/promises")).readFile(storePath, "utf8")).toBe(bytes.replace('{"version":1,', '{"version":999,'));
    await writeFile(storePath, bytes);
    const reopened = await ReviewCore.open(directory, identity, h.authority, { capture: async () => { throw new Error("unused"); }, get: (id) => h.sourceMap.get(id) }, { store: { io: { afterFlush: async () => { throw new Error("lost"); } } } });
    activeCores.push(reopened);
    await expect(request(reopened, h.humanToken, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "x" }, "00000000-0000-4000-8000-000000000010", "uncertain")).rejects.toMatchObject({ code: "outcome_unknown" });
    await reopened.close();
    const recovered = await ReviewCore.open(directory, identity, h.authority, { capture: async () => { throw new Error("unused"); }, get: (id) => h.sourceMap.get(id) });
    activeCores.push(recovered);
    await expect(request(recovered, h.humanToken, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "x" }, "00000000-0000-4000-8000-000000000010", "uncertain", 2)).resolves.toBeDefined();
    expect(recovered.state(h.humanToken).comments).toHaveLength(1);
  });
});
