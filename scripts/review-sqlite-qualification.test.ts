// Real helper qualification, separate from the JS-only suite. Build the helper first.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, rm, copyFile, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SqliteReviewStore } from "../src/lib/review-sqlite.js";
import { ReviewCore } from "../src/lib/review-core.js";
import { ReviewAuthority } from "../src/lib/review-authority.js";
import { captureInspection } from "../src/lib/inspect-capture.js";
import { AgentDiffIndexCache } from "../src/lib/agent-diff-index.js";
import { DEFAULTS } from "../src/lib/diff-options.js";
import type { ReviewCommand } from "../src/lib/review-core-contract.js";

const binary = process.env.DIFFING_SQLITE_TEST_BINARY ?? resolve(`target/debug/diffing-tui${process.platform === "win32" ? ".exe" : ""}`);
const request = { key: "request", expectedVersion: 0, input: { body: "kept" } };
const effect = () => ({ events: [{ type: "sample", data: { body: "kept" } }], result: { id: "kept" } });

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "diffing-sqlite-"));
  const stores: SqliteReviewStore[] = [];
  t.after(async () => { for (const store of stores) await store.close(); await rm(directory, { recursive: true, force: true }); });
  const open = async (path = directory, options: Parameters<typeof SqliteReviewStore.open>[1] = {}) => {
    const store = await SqliteReviewStore.open(path, { binary, ...options });
    stores.push(store);
    return store;
  };
  return { directory, open };
}

test("SQLite preserves exact transactions and canonical retry identity across restart", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const first = await store.transact(request, effect);
  assert.equal(first.sequence, 1);
  await assert.rejects(store.transact({ ...request, input: { body: "changed" } }, effect), { code: "idempotency_conflict" });
  await assert.rejects(store.transact({ ...request, key: "other" }, effect), { code: "version_conflict" });
  await store.close();
  const reopened = await f.open();
  assert.deepEqual(await reopened.transact(request, () => { throw new Error("Duplicate ran producer"); }), first);
  assert.deepEqual(reopened.read(), { records: [first], latest: 1, next: null });
});

test("SQLite excludes a second owner while separate reviews remain usable", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await assert.rejects(f.open(), { code: "owner_busy" });
  const other = await f.open(join(f.directory, "other"));
  assert.equal((await other.transact(request, effect)).sequence, 1);
  assert.equal(store.version, 0);
  await store.close();
  assert.equal((await f.open()).version, 0);
});

test("JSON number and Unicode payloads survive the native boundary exactly", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const payload = { numbers: [0.8455124082255701, 1e21, 1e-7, Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER], text: "العربية ☕ 𐀀", nested: { "𐀀": true, "\ue000": false } };
  const first = await store.transact(request, () => ({ events: [{ type: "payload", data: payload }], result: payload }));
  assert.deepEqual(first.result, payload);
  await store.close();
  const reopened = await f.open();
  assert.deepEqual(reopened.read().records[0], first);
});

test("lost acknowledgement fences the client and retry recovers the single commit", async (t) => {
  const f = await fixture(t);
  const store = await f.open(undefined, { io: { afterFlush: async () => { throw new Error("lost response"); } } });
  await assert.rejects(store.transact(request, effect), { code: "outcome_unknown" });
  assert.throws(() => store.read(), { code: "outcome_unknown" });
  await assert.rejects(store.transact(request, effect), { code: "outcome_unknown" });
  await store.close();
  const reopened = await f.open();
  const result = await reopened.transact(request, () => { throw new Error("Duplicate ran producer"); });
  assert.equal(result.sequence, 1);
  assert.deepEqual(result.result, { id: "kept" });
  assert.equal(reopened.read().records.length, 1);
});

test("queued writers check expected versions before running the second producer", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = store.transact(request, async () => { entered(); await gate; return effect(); });
  await ready;
  let secondRan = false;
  const second = assert.rejects(store.transact({ ...request, key: "other" }, () => { secondRan = true; return effect(); }), { code: "version_conflict" });
  release();
  await first;
  await second;
  assert.equal(secondRan, false);
  assert.equal(store.version, 1);
});

test("large Unicode transactions replay in bounded complete pages and restore from backup", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  for (let index = 0; index < 5; index++) {
    await store.transact({ key: `large-${index}`, expectedVersion: index, input: { index } }, () => ({ events: [{ type: "unicode", data: { text: "☕".repeat(60_000), index } }], result: { index } }));
  }
  const original = [];
  let after = 0;
  for (;;) {
    const page = store.read(after, 1000);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 512 * 1024);
    assert.ok(page.records.length > 0);
    original.push(...page.records);
    if (page.next === null) break;
    assert.ok(page.next > after);
    after = page.next;
  }
  assert.deepEqual(original.map((record) => record.sequence), [1, 2, 3, 4, 5]);
  const { backup } = await store.compact();
  await store.close();
  const reopened = await f.open();
  assert.equal(reopened.version, 5);
  await reopened.close();
  const restoredDirectory = join(f.directory, "restored");
  const empty = await f.open(restoredDirectory);
  await empty.close();
  await copyFile(backup, join(restoredDirectory, "review.sqlite"));
  const restored = await f.open(restoredDirectory);
  for (let index = 0; index < 5; index++) assert.deepEqual(restored.read(index, 1).records[0], original[index]);
});

test("oversized effects and producer failures leave a usable unchanged store", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await assert.rejects(store.transact(request, () => ({ events: [], result: "x".repeat(256 * 1024) })), { code: "store_limit" });
  await assert.rejects(store.transact(request, () => { throw new Error("producer failed"); }), /producer failed/);
  assert.equal(store.version, 0);
  assert.equal((await store.transact(request, effect)).sequence, 1);
});

test("legacy data is never silently converted or erased", async (t) => {
  const f = await fixture(t);
  const path = join(f.directory, "review.jsonl");
  await writeFile(path, "original");
  await assert.rejects(f.open(), { code: "migration_required" });
  assert.equal(await readFile(path, "utf8"), "original");
  await assert.rejects(readFile(join(f.directory, "review.sqlite")), { code: "ENOENT" });
});

test("ReviewCore persists comments, handoff work and human decisions through SQLite", async (t) => {
  const f = await fixture(t);
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority(() => 100);
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "capture", "comment", "handoff", "decide"]);
  const agent = authority.issue(identity, { id: "agent", kind: "agent" }, ["read", "capture", "comment", "work"]);
  const patch = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
  const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch, complete: true, layers: [{ kind: "working", patch }] }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: "c".repeat(40), indexDigest: "d".repeat(64), resolvedRevisions: [] }));
  const index = new AgentDiffIndexCache().getOrBuild(patch, true, undefined, captured.manifest);
  const sources = { capture: async () => index, get: (id: string) => id === index.manifest!.snapshotId ? index : undefined };
  const openStore = (directory: string) => f.open(directory);
  const core = await ReviewCore.open(f.directory, identity, authority, sources, { openStore, now: () => 100 });
  t.after(() => core.close());
  const send = (token: string, command: ReviewCommand, snapshotId: string | null, key: string) => core.execute(token, { ...identity, version: 1, expectedVersion: core.state(token).version, requestId: key, snapshotId, command });
  const snapshotId = (await send(human, { op: "capture" }, null, "capture")).result.snapshotId;
  const add = { ...identity, version: 1, expectedVersion: core.state(human).version, requestId: "comment", snapshotId, command: { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "check" } };
  const comment = await core.execute(human, add);
  const handoff = await send(human, { op: "handoff.create", recipient: "agent", instructions: "check", commentIds: [comment.result.id!] }, snapshotId, "handoff");
  const handoffId = handoff.result.id!;
  await send(agent, { op: "handoff.claim", handoffId }, snapshotId, "claim");
  const state = core.state(agent).handoffs[0];
  const claim = { handoffId, claimId: state.claim!.id, epoch: state.epoch };
  await send(agent, { op: "handoff.start", ...claim }, snapshotId, "start");
  await send(agent, { op: "handoff.result", ...claim, resultSnapshotId: snapshotId, body: "done" }, snapshotId, "result");
  await assert.rejects(send(agent, { op: "decision.record", decision: "approved", rationale: "self approval" }, snapshotId, "bad-decision"), { code: "forbidden" });
  await send(human, { op: "decision.record", decision: "approved", rationale: "reviewed", handoffId }, snapshotId, "decision");
  const expected = core.state(human);
  assert.equal(expected.handoffs[0].status, "reviewed");
  assert.equal(expected.comments[0].status, "open");
  assert.equal(expected.decisions[0].actor.kind, "human");
  await core.close();
  const reopened = await ReviewCore.open(f.directory, identity, authority, sources, { openStore, now: () => 100 });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.state(human), expected);
  assert.deepEqual(await reopened.execute(human, add), comment);
  assert.equal(reopened.state(human).version, expected.version);
});
