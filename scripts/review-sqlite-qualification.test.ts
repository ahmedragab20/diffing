// Real helper qualification, separate from the JS-only suite. Build the helper first.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, rm, copyFile, readFile, writeFile, readdir } from "node:fs/promises";
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
import { readLegacyArchive, decodeLegacyArchive } from "../src/lib/review-legacy.js";
import { createReviewCoreApi, REVIEW_CREDENTIAL_HEADER } from "../src/lib/review-core-api.js";
import { openMigratedWorkspaceReview } from "../src/lib/review-migration.js";
import { FileCommentStore } from "../src/lib/comments.js";
import { FilePlanStore } from "../src/lib/plans.js";
import { FileViewedStore } from "../src/lib/viewed-files.js";

const binary = process.env.DIFFING_SQLITE_TEST_BINARY ?? resolve(`target/debug/diffing-tui${process.platform === "win32" ? ".exe" : ""}`);
const request = { key: "request", expectedVersion: 0, input: { body: "kept" } };
const effect = () => ({ events: [{ type: "sample", data: { body: "kept" } }], result: { id: "kept" } });

const noCapture = { capture: async (): Promise<never> => { throw new Error("Migration must not capture Git"); }, get: () => undefined };
const migrationWorkspace = { repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };

test("explicit workspace migration fences classic stores and resumes from the committed archive", async (t) => {
  const f = await fixture(t);
  const comments = new FileCommentStore(f.directory);
  const original = { id: "kept", filePath: "a.ts", side: "additions" as const, lineNumber: 1, lineContent: "old", body: "preserved", status: "open" as const, createdAt: 1, replies: [] };
  await comments.add(original);
  const before = await readFile(join(f.directory, "comments.json"));
  const authority = new ReviewAuthority();
  let credential = "";
  const connect = (identity: Parameters<ReviewAuthority["issue"]>[0]) => credential = authority.issue(identity, { id: "human", kind: "human" }, ["read", "decide"]);
  const core = await openMigratedWorkspaceReview(f.directory, migrationWorkspace, authority, noCapture, connect, { store: { binary } });
  t.after(() => core.close());
  const identity = core.identity;
  const archive = core.exportLegacy(credential);
  assert.equal(core.state(credential).legacy?.comments, 1);
  assert.equal(core.state(credential).comments[0].body, original.body);
  await assert.rejects(comments.add({ ...original, id: "late" }), { code: "review_core_required" });
  await assert.rejects(new FilePlanStore(f.directory).getAll(), { code: "review_core_required" });
  await assert.rejects(new FileViewedStore(f.directory).toggle("local", "a.ts", true), { code: "review_core_required" });
  assert.deepEqual(await readFile(join(f.directory, "comments.json")), before);
  await core.close();
  await assert.rejects(comments.getAll(), { code: "review_core_required" });
  // The original recovery files are no longer the live authority after commit.
  await writeFile(join(f.directory, "comments.json"), "outside edit");
  const reopened = await openMigratedWorkspaceReview(f.directory, migrationWorkspace, authority, noCapture, connect, { store: { binary } });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.identity, identity);
  assert.deepEqual(reopened.exportLegacy(credential), archive);
  assert.equal(reopened.state(credential).comments.length, 1);
});

test("interrupted workspace migration stays fenced until an exact archive retry completes", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "comments.json"), "[]\n");
  const authority = new ReviewAuthority();
  let credential = "";
  const connect = (identity: Parameters<ReviewAuthority["issue"]>[0]) => credential = authority.issue(identity, { id: "human", kind: "human" }, ["read", "decide"]);
  let writes = 0;
  await assert.rejects(openMigratedWorkspaceReview(f.directory, migrationWorkspace, authority, noCapture, connect, {
    store: { binary, io: { afterFlush: async () => { if (++writes === 2) throw new Error("lost import acknowledgement"); } } },
  }), { code: "outcome_unknown" });
  await assert.rejects(new FileCommentStore(f.directory).getAll(), { code: "review_core_required" });
  const reopened = await openMigratedWorkspaceReview(f.directory, migrationWorkspace, authority, noCapture, connect, { store: { binary } });
  t.after(() => reopened.close());
  assert.equal(reopened.state(credential).migrationPending, false);
  assert.equal(reopened.state(credential).legacy?.comments, 0);
  assert.equal(reopened.state(credential).version, 3);
  assert.equal(await readFile(join(f.directory, "comments.json"), "utf8"), "[]\n");
});

test("malformed first-adoption data does not create a database or erase legacy bytes", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "plans.json"), "{");
  await assert.rejects(openMigratedWorkspaceReview(f.directory, migrationWorkspace, new ReviewAuthority(), noCapture, () => { throw new Error("must not connect"); }, { store: { binary } }));
  assert.equal(await readFile(join(f.directory, "plans.json"), "utf8"), "{");
  assert.ok(!(await readdir(f.directory)).includes("review.sqlite"));
});

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

test("initialized state refuses a missing database and permits explicit backup restoration", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const original = await store.transact(request, effect);
  const { backup } = await store.compact();
  await store.close();
  const database = join(f.directory, "review.sqlite");
  const marker = await readFile(join(f.directory, "review.initialized"));
  await rm(database);
  await assert.rejects(f.open(), { code: "missing_store" });
  await assert.rejects(readFile(database), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(f.directory, "review.initialized")), marker);
  await copyFile(backup, database);
  assert.deepEqual((await f.open()).read().records, [original]);
});

test("damaged initialization metadata is preserved and never treated as a fresh review", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.transact(request, effect);
  await store.close();
  const database = await readFile(join(f.directory, "review.sqlite"));
  await writeFile(join(f.directory, "review.initialized"), "damaged");
  await assert.rejects(f.open(), { code: "corrupt_store" });
  assert.deepEqual(await readFile(join(f.directory, "review.sqlite")), database);
  assert.equal(await readFile(join(f.directory, "review.initialized"), "utf8"), "damaged");
});

test("legacy import survives a lost acknowledgement, retains exact backups and never invents authority", async (t) => {
  const f = await fixture(t);
  const source = join(f.directory, "legacy");
  const destination = join(f.directory, "new-review");
  await mkdir(source);
  const comment = { id: "legacy-comment", filePath: "☕.ts", side: "additions", lineNumber: 1, lineContent: "old source", body: "preserved ".repeat(12_000), createdAt: 10, status: "resolved", replies: [{ id: "legacy-reply", body: "kept", createdAt: 11, role: "agent", model: "descriptive-only", actor: { id: "agent", kind: "agent" } }], futureField: { preserve: true } };
  const plan = { id: "legacy-plan", title: "old plan", body: "unchanged", createdAt: 12, version: 3, decision: "approved", comments: [] };
  const originals = { "comments.json": JSON.stringify([comment], null, 2) + "\n", "plans.json": JSON.stringify([plan]) + "\n", "viewed.json": '{"local":{"files":{"☕.ts":"*"}}}\n' };
  for (const [name, bytes] of Object.entries(originals)) await writeFile(join(source, name), bytes);
  const archive = await readLegacyArchive(source);
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority(() => 100);
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "decide", "capture"]);
  const agent = authority.issue(identity, { id: "agent", kind: "agent" }, ["read", "capture", "comment"]);
  let live: ReturnType<AgentDiffIndexCache["getOrBuild"]> | undefined;
  const sources = {
    capture: async () => { if (!live) throw new Error("Migration must not collect Git"); return live; },
    get: (id: string) => live?.manifest?.snapshotId === id ? live : undefined,
  };
  let writes = 0;
  const core = await ReviewCore.open(destination, identity, authority, sources, { openStore: (path) => f.open(path, { io: { afterFlush: async () => { if (++writes === 2) throw new Error("dropped first chunk acknowledgement"); } } }) });
  t.after(() => core.close());
  await assert.rejects(core.importLegacy(agent, archive), { code: "forbidden" });
  assert.equal(core.state(human).version, 1);
  await assert.rejects(core.importLegacy(human, archive), { code: "outcome_unknown" });
  await core.close();
  const reopened = await ReviewCore.open(destination, identity, authority, sources, { openStore: (path) => f.open(path) });
  t.after(() => reopened.close());
  assert.equal(reopened.state(human).migrationPending, true);
  assert.equal(reopened.state(human).legacy, null);
  assert.equal(reopened.exportLegacy(human), null);
  await assert.rejects(reopened.execute(human, { ...identity, version: 1, requestId: "capture-during-migration", expectedVersion: reopened.state(human).version, snapshotId: null, command: { op: "capture" } }), { code: "migration_required" });
  const imported = await reopened.importLegacy(human, archive);
  assert.equal(imported.comments, 1);
  assert.equal(imported.plans, 1);
  assert.equal(imported.viewedScopes, 1);
  assert.equal(imported.provenance, "legacy-unverified");
  assert.equal(imported.history, "not-persisted-by-legacy-session");
  const beforeRetry = reopened.state(human);
  assert.equal(beforeRetry.migrationPending, false);
  assert.deepEqual(beforeRetry.decisions, []);
  assert.equal(beforeRetry.comments[0].id, "legacy-comment");
  assert.equal(beforeRetry.comments[0].body, comment.body);
  assert.equal(beforeRetry.comments[0].status, "resolved");
  assert.equal(beforeRetry.comments[0].provenance, "legacy-unverified");
  assert.deepEqual(beforeRetry.comments[0].actor, { id: "legacy-unverified", kind: "system" });
  assert.deepEqual(beforeRetry.commentFreshness, [{ id: "legacy-comment", status: "unverified", reason: "legacy" }]);
  assert.deepEqual(await reopened.importLegacy(human, archive), imported);
  assert.deepEqual(reopened.state(human), beforeRetry);
  const backup = reopened.exportLegacy(human)!;
  assert.deepEqual(backup, archive);
  const decoded = decodeLegacyArchive(backup);
  assert.deepEqual(decoded.comments, [comment]);
  assert.deepEqual(decoded.plans, [plan]);
  for (const entry of backup.sources) assert.equal(Buffer.from(entry.base64, "base64").toString("utf8"), originals[entry.name]);
  for (const [name, bytes] of Object.entries(originals)) assert.equal(await readFile(join(source, name), "utf8"), bytes);
  await writeFile(join(source, "comments.json"), "[]");
  await assert.rejects(reopened.importLegacy(human, await readLegacyArchive(source)), { code: "version_conflict" });
  assert.deepEqual(reopened.exportLegacy(human), backup);
  const patch = "diff --git a/☕.ts b/☕.ts\n--- a/☕.ts\n+++ b/☕.ts\n@@ -1 +1 @@\n-old\n+new\n";
  const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch, complete: true, layers: [{ kind: "working", patch }] }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: "c".repeat(40), indexDigest: "d".repeat(64), resolvedRevisions: [] }));
  live = new AgentDiffIndexCache().getOrBuild(patch, true, undefined, captured.manifest);
  const capture = await reopened.execute(human, { ...identity, version: 1, requestId: "post-import-capture", expectedVersion: reopened.state(human).version, snapshotId: null, command: { op: "capture" } });
  assert.deepEqual(reopened.state(agent).comments[0].replies[0].actor, { id: "legacy-unverified", kind: "system" });
  await assert.rejects(reopened.execute(agent, { ...identity, version: 1, requestId: "edit-unverified-reply", expectedVersion: reopened.state(agent).version, snapshotId: capture.result.snapshotId, command: { op: "reply.edit", commentId: "legacy-comment", replyId: "legacy-reply", body: "claimed old author" } }), { code: "forbidden" });
  const replyRequest = { ...identity, version: 1, requestId: "legacy-reply", expectedVersion: reopened.state(agent).version, snapshotId: capture.result.snapshotId, command: { op: "comment.reply", commentId: "legacy-comment", body: "follow-up" } };
  const reply = await reopened.execute(agent, replyRequest);
  assert.equal(reply.result.id, "legacy-comment");
  assert.equal(reopened.state(agent).comments[0].replies.at(-1)!.body, "follow-up");
  assert.equal(reopened.state(agent).commentFreshness[0].status, "unverified");
  await reopened.close();
  const afterRestart = await ReviewCore.open(destination, identity, authority, sources, { openStore: (path) => f.open(path) });
  t.after(() => afterRestart.close());
  assert.deepEqual(await afterRestart.execute(agent, replyRequest), reply);
  assert.equal(afterRestart.state(agent).comments[0].replies.length, 2);
  assert.deepEqual(afterRestart.exportLegacy(human), backup);
});

test("workspace review identity resumes from durable state and rejects a different worktree", async (t) => {
  const cores: ReviewCore[] = [];
  t.after(async () => { for (const core of cores) await core.close(); });
  const f = await fixture(t);
  const workspace = { repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const sources = { capture: async (): Promise<never> => { throw new Error("Opening a review must not capture Git"); }, get: () => undefined };
  const options = { store: { binary } };
  const first = await ReviewCore.openWorkspace(f.directory, workspace, new ReviewAuthority(), sources, options);
  cores.push(first);
  const identity = { ...first.identity };
  await assert.rejects(ReviewCore.openWorkspace(f.directory, workspace, new ReviewAuthority(), sources, options), { code: "owner_busy" });
  await first.close();
  const bytes = await readFile(join(f.directory, "review.sqlite"));
  await assert.rejects(ReviewCore.openWorkspace(f.directory, { ...workspace, workspaceId: "c".repeat(64) }, new ReviewAuthority(), sources, options), { code: "wrong_review" });
  assert.deepEqual(await readFile(join(f.directory, "review.sqlite")), bytes);
  const authority = new ReviewAuthority();
  const resumed = await ReviewCore.openWorkspace(f.directory, workspace, authority, sources, options);
  cores.push(resumed);
  assert.deepEqual(resumed.identity, identity);
  const token = authority.issue(identity, { id: "reader", kind: "human" }, ["read"]);
  assert.equal(resumed.state(token).version, 1);
  await resumed.close();
  const other = await ReviewCore.openWorkspace(join(f.directory, "other"), workspace, authority, sources, options);
  cores.push(other);
  assert.notEqual(other.identity.reviewId, identity.reviewId);
});

test("default ReviewCore refuses an unavailable native helper or a legacy journal without fallback", async (t) => {
  const f = await fixture(t);
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority();
  const sources = { capture: async (): Promise<never> => { throw new Error("No source capture during startup"); }, get: () => undefined };
  await assert.rejects(ReviewCore.open(f.directory, identity, authority, sources, { store: { binary: join(f.directory, "missing-helper") } }), { code: "native_unavailable" });
  assert.deepEqual(await readdir(f.directory), []);
  const legacy = "unmodified legacy journal\n";
  await writeFile(join(f.directory, "review.jsonl"), legacy);
  await assert.rejects(ReviewCore.open(f.directory, identity, authority, sources, { store: { binary } }), { code: "migration_required" });
  assert.equal(await readFile(join(f.directory, "review.jsonl"), "utf8"), legacy);
  assert.ok(!(await readdir(f.directory)).includes("review.sqlite"));
});

test("ReviewCore defaults to SQLite and persists comments, handoff work and human decisions", async (t) => {
  const cores: ReviewCore[] = [];
  t.after(async () => { for (const core of cores) await core.close(); });
  const f = await fixture(t);
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority(() => 100);
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "capture", "comment", "handoff", "decide"]);
  const agent = authority.issue(identity, { id: "agent", kind: "agent" }, ["read", "capture", "comment", "work"]);
  const patch = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
  const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch, complete: true, layers: [{ kind: "working", patch }] }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: "c".repeat(40), indexDigest: "d".repeat(64), resolvedRevisions: [] }));
  const index = new AgentDiffIndexCache().getOrBuild(patch, true, undefined, captured.manifest);
  const sources = { capture: async () => index, get: (id: string) => id === index.manifest!.snapshotId ? index : undefined };
  const options = { store: { binary }, now: () => 100 };
  const core = await ReviewCore.open(f.directory, identity, authority, sources, options);
  cores.push(core);
  assert.equal((await readFile(join(f.directory, "review.sqlite"))).subarray(0, 16).toString(), "SQLite format 3\0");
  const send = (token: string, command: ReviewCommand, snapshotId: string | null, key: string) => core.execute(token, { ...identity, version: 1, expectedVersion: core.state(token).version, requestId: key, snapshotId, command });
  const snapshotId = (await send(human, { op: "capture" }, null, "capture")).result.snapshotId;
  const add = { ...identity, version: 1, expectedVersion: core.state(human).version, requestId: "comment", snapshotId, command: { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "check" } };
  const comment = await core.execute(human, add);
  const handoff = await send(human, { op: "handoff.create", recipient: "agent", instructions: "check", commentIds: [comment.result.id!] }, snapshotId, "handoff");
  const handoffId = handoff.result.id!;
  const sentPayload = core.handoff(agent, handoffId).sent;
  assert.equal(sentPayload.sequence, handoff.sequence);
  assert.equal(sentPayload.comments[0].body, "check");
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
  const reopened = await ReviewCore.open(f.directory, identity, authority, sources, options);
  cores.push(reopened);
  assert.deepEqual(reopened.state(human), expected);
  assert.deepEqual(await reopened.execute(human, add), comment);
  assert.equal(reopened.state(human).version, expected.version);
  const commentId = comment.result.id!;
  const edit = { ...identity, version: 1, expectedVersion: reopened.state(human).version, requestId: "edit-comment", snapshotId, command: { op: "comment.edit", commentId, body: "clarified after review" } };
  await assert.rejects(reopened.execute(agent, edit), { code: "forbidden" });
  const edited = await reopened.execute(human, edit);
  const remove = { ...identity, version: 1, expectedVersion: reopened.state(human).version, requestId: "remove-comment", snapshotId, command: { op: "comment.delete", commentId } };
  const removed = await reopened.execute(human, remove);
  await reopened.close();
  const final = await ReviewCore.open(f.directory, identity, authority, sources, options);
  cores.push(final);
  assert.deepEqual(final.state(human).comments, []);
  assert.deepEqual(final.state(human).handoffs, expected.handoffs);
  assert.deepEqual(final.state(human).decisions, expected.decisions);
  assert.deepEqual(final.handoff(agent, handoffId).sent, sentPayload);
  assert.deepEqual(await final.execute(human, edit), edited);
  assert.deepEqual(await final.execute(human, remove), removed);
  assert.equal(final.state(human).version, removed.sequence);
  const api = createReviewCoreApi(final);
  const historical = await api.request(`/handoffs/${handoffId}`, { headers: { [REVIEW_CREDENTIAL_HEADER]: agent } });
  assert.equal(historical.status, 200);
  assert.deepEqual((await historical.json()).sent, sentPayload);
  const retry = await api.request("/operations", { method: "POST", headers: { [REVIEW_CREDENTIAL_HEADER]: human, "Content-Type": "application/json" }, body: JSON.stringify(remove) });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { version: 1, sequence: removed.sequence, result: removed.result });
  assert.equal(final.state(human).version, removed.sequence);
  const denied = await api.request("/operations", { method: "POST", headers: { [REVIEW_CREDENTIAL_HEADER]: agent, "Content-Type": "application/json" }, body: JSON.stringify({ ...remove, requestId: "forged-approval", expectedVersion: removed.sequence, command: { op: "decision.record", decision: "approved", rationale: "forged" } }) });
  assert.equal(denied.status, 403);
  assert.equal(final.state(human).version, removed.sequence);
});
