// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ReviewCore } from "../review-core.js";
import { ReviewAuthority } from "../review-authority.js";
import { createReviewCoreApi, REVIEW_CREDENTIAL_HEADER } from "../review-core-api.js";
import { captureInspection } from "../inspect-capture.js";
import { AgentDiffIndexCache } from "../agent-diff-index.js";
import { DEFAULTS } from "../diff-options.js";
import { REVIEW_STORE_LIMITS, ReviewStore } from "../review-store.js";
import { createApp } from "../../server.js";
import { InMemoryCommentStore } from "../comments.js";
import { InMemoryPlanStore } from "../plans.js";
import { SESSION_TOKEN_HEADER } from "../server-auth.js";
import * as nativeFs from "../native-fs.js";
import * as inspectCapture from "../inspect-capture.js";
import * as diffEngine from "../diff-engine.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(options: Parameters<typeof ReviewCore.open>[4] = {}) {
  const directory = await mkdtemp(join(tmpdir(), "diffing-core-http-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority();
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "capture", "comment", "decide"]);
  const agent = authority.issue(identity, { id: "agent", kind: "agent" }, ["read", "capture", "comment"]);
  const patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
  const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch, complete: true }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: null, indexDigest: "c".repeat(64), resolvedRevisions: [] }));
  const index = new AgentDiffIndexCache().getOrBuild(patch, true, undefined, captured.manifest);
  const sources = { capture: async () => index, get: (id: string) => id === index.manifest!.snapshotId ? index : undefined };
  const open = async () => { const core = await ReviewCore.open(directory, identity, authority, sources, { ...options, openStore: options.openStore ?? ((path) => ReviewStore.open(path, options.store)) }); cleanup.push(() => core.close()); return core; };
  const core = await open();
  const app = new Hono().route("/api/review-core", createReviewCoreApi(core));
  const headers = (token: string) => ({ [REVIEW_CREDENTIAL_HEADER]: token, "Content-Type": "application/json" });
  const request = (requestId: string, command: unknown, snapshotId: string | null = null) => ({ ...identity, version: 1, requestId, expectedVersion: core.state(human).version, snapshotId, command });
  const post = (body: unknown, token = human) => app.request("/api/review-core/operations", { method: "POST", headers: headers(token), body: JSON.stringify(body) });
  return { directory, identity, authority, human, agent, core, app, open, headers, request, post };
}

describe("opt-in review core HTTP adapter", () => {
  it("shares retained server snapshot identities with the owned core factory", async () => {
    const f = await fixture();
    let content = "new";
    const readPatch = vi.spyOn(diffEngine, "executeDiffWithMeta").mockImplementation(async () => {
      const patch = `diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+${content}\n`;
      return { patch, complete: true, layers: [{ kind: "working", patch }], binaryFiles: [], filePaths: ["a"], tabSizeMap: {}, untrackedFiles: [], repoName: "fixture", branch: "test" };
    });
    vi.spyOn(inspectCapture, "readInspectionIdentity").mockResolvedValue({ repositoryId: f.identity.repositoryId, workspaceId: f.identity.workspaceId, head: null, indexDigest: "c".repeat(64), resolvedRevisions: [] });
    const factory = vi.fn(async (sources: Parameters<typeof ReviewCore.open>[3]) => {
      const core = await ReviewCore.open(join(f.directory, "integrated"), f.identity, f.authority, sources, { openStore: (path) => ReviewStore.open(path) });
      cleanup.push(() => core.close());
      return core;
    });
    const app = createApp(f.directory, DEFAULTS, new InMemoryCommentStore(), new InMemoryPlanStore(), undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, factory);
    const core = await app.reviewCoreReady;
    expect(core).toBeDefined();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(readPatch).not.toHaveBeenCalled();
    const files = await (await app.request("/api/diff/files?limit=1")).json();
    const send = (requestId: string, command: unknown, snapshotId: string | null) => app.request("/api/review-core/operations", { method: "POST", headers: f.headers(f.human), body: JSON.stringify({ ...f.identity, version: 1, requestId, expectedVersion: core!.state(f.human).version, snapshotId, command }) });
    const captured = await (await send("capture", { op: "capture" }, null)).json();
    expect(captured.result.snapshotId).toBe(files.snapshotId);
    const added = await send("add", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "same displayed source" }, files.snapshotId);
    expect(added.status).toBe(200);
    expect(core!.state(f.human).comments[0]).toMatchObject({ lineContent: "new", sourceAnchor: { snapshotId: files.snapshotId, file: { contentDigest: files.files[0].metadata.patchDigest } } });
    content = "changed outside review";
    const rejected = await send("decision", { op: "decision.record", decision: "approved", rationale: "old view" }, files.snapshotId);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ code: "stale_snapshot" });
    const refreshed = await (await send("refresh", { op: "capture" }, null)).json();
    expect(refreshed.result.snapshotId).not.toBe(files.snapshotId);
    expect(core!.state(f.human).commentFreshness[0].status).toBe("stale");
    readPatch.mockClear();
    const retained = await (await app.request(`/api/diff/files?snapshotId=${files.snapshotId}`)).json();
    expect(retained.files).toEqual(files.files);
    expect(retained.snapshotId).toBe(files.snapshotId);
    expect(readPatch).not.toHaveBeenCalled();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60_000);
    expect((await app.request(`/api/diff/files?snapshotId=${refreshed.result.snapshotId}`)).status).toBe(410);
    const expired = await send("expired-add", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "expired coordinates" }, refreshed.result.snapshotId);
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual({ code: "snapshot_expired", recovery: "capture_source" });
    expect(readPatch).not.toHaveBeenCalled();
  });

  it("reads the immutable sent handoff through its credential-checked and bounded endpoint", async () => {
    const f = await fixture();
    const sender = f.authority.issue(f.identity, { id: "sender", kind: "human" }, ["read", "handoff"]);
    const capture = await (await f.post(f.request("capture", { op: "capture" }))).json();
    const snapshot = capture.result.snapshotId;
    const comment = await (await f.post(f.request("add", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "sent concern" }, snapshot))).json();
    const sent = await (await f.post(f.request("send", { op: "handoff.create", recipient: "agent", instructions: "review", commentIds: [comment.result.id] }, snapshot), sender)).json();
    const path = `/api/review-core/handoffs/${sent.result.id}`;
    expect((await f.app.request(path)).status).toBe(401);
    const deleted = await f.post(f.request("delete", { op: "comment.delete", commentId: comment.result.id }, snapshot));
    expect(deleted.status).toBe(200);
    const response = await f.app.request(path, { headers: f.headers(f.agent) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await response.json();
    expect(payload.sent.comments).toMatchObject([{ id: comment.result.id, body: "sent concern" }]);
    expect(payload.sent.sequence).toBe(sent.sequence);
    expect((await f.app.request("/api/review-core/handoffs/missing", { headers: f.headers(f.agent) })).status).toBe(404);
    vi.spyOn(f.core, "handoff").mockReturnValue({ ...payload, sent: { ...payload.sent, comments: payload.sent.comments.map((comment: object) => ({ ...comment, body: "x".repeat(REVIEW_STORE_LIMITS.replayBytes) })) } });
    const oversized = await f.app.request(path, { headers: f.headers(f.agent) });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ code: "response_too_large", recovery: "read_events" });
  });

  it("refuses classic comment, viewed and handoff routes when a core owns the review", async () => {
    const fileAccess = vi.spyOn(nativeFs, "getNativeRepositoryFs").mockImplementation(() => { throw new Error("Unexpected file access"); });
    const f = await fixture();
    const legacy = new InMemoryCommentStore();
    await legacy.add({ id: "legacy", filePath: "a", side: "additions", lineNumber: 1, lineContent: "new", body: "preserved", status: "open", createdAt: 1, replies: [] });
    const app = createApp(f.directory, DEFAULTS, legacy, new InMemoryPlanStore(), undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, f.core);
    const before = f.core.state(f.human);
    for (const [method, path] of [
      ["GET", "/api/comments"], ["POST", "/api/comments"],
      ["PUT", "/api/comments/legacy"], ["DELETE", "/api/comments/legacy"],
      ["POST", "/api/comments/legacy/replies"], ["PUT", "/api/comments/legacy/replies/reply"],
      ["DELETE", "/api/comments/legacy/replies/reply"], ["POST", "/api/comments/resolve-all"],
      ["POST", "/api/comments/legacy/apply-suggestion"],
      ["GET", "/api/viewed"], ["PUT", "/api/viewed"],
      ["POST", "/api/review/send"], ["GET", "/api/review/await?timeoutMs=1"],
      ["GET", "/api/review/status"], ["GET", "/api/review/history"], ["GET", "/api/review/since-last"],
      ["POST", "/api/agent/register"], ["DELETE", "/api/agent/register/agent"],
      ["GET", "/api/ai/evidence/snapshot/discussion"],
      ["GET", "/api/plans"], ["POST", "/api/plans"],
      ["GET", "/api/plans/legacy"], ["PUT", "/api/plans/legacy"], ["DELETE", "/api/plans/legacy"],
      ["GET", "/api/plans/legacy/versions"], ["GET", "/api/plans/legacy/versions/1"],
      ["POST", "/api/plans/legacy/decision"], ["POST", "/api/plans/legacy/comments"],
      ["GET", "/api/plan-review/await?timeoutMs=1"], ["GET", "/api/plan-review/status"],
    ]) {
      const response = await app.request(path, { method, headers: f.headers(f.human), ...(method === "GET" ? {} : { body: JSON.stringify({ status: "resolved", body: "changed", filePath: "a", viewed: true }) }) });
      expect(response.status, `${method} ${path}`).toBe(409);
      expect(await response.json()).toEqual({ code: "review_core_required", recovery: "use_review_core_operations" });
    }
    const edit = await app.request("/api/edit-save", { method: "POST", headers: f.headers(f.human), body: JSON.stringify({ filePath: "a", content: "changed", anchorUpdates: [{ id: "legacy", side: "additions", lineNumber: 2 }] }) });
    expect(edit.status).toBe(409);
    expect(fileAccess).not.toHaveBeenCalled();
    expect((await legacy.getAll()).map(({ body, status }) => ({ body, status }))).toEqual([{ body: "preserved", status: "open" }]);
    expect(f.core.state(f.human)).toEqual(before);
    const response = await app.request("/api/review-core/operations", { method: "POST", headers: f.headers(f.human), body: JSON.stringify(f.request("capture", { op: "capture" })) });
    expect(response.status).toBe(200);
  });

  it("recovers exact migrated plan bytes in bounded authenticated pages without reconstructing history", async () => {
    const f = await fixture();
    const bytes = Buffer.from(JSON.stringify([{ id: "old-plan", title: "Original", body: "محفوظ".repeat(20_000), createdAt: 1, version: 3, decision: "approved", future: { preserved: true } }], null, 2));
    const source = { name: "plans.json" as const, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), base64: bytes.toString("base64") };
    await f.core.importLegacy(f.human, { version: 1, sources: [source] });
    const state = f.core.state(f.human);
    const route = "/api/review-core/legacy/sources/plans.json";
    expect((await f.app.request(route)).status).toBe(401);
    const chunks: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const response = await f.app.request(`${route}?offset=${offset}&limit=49152`, { headers: f.headers(f.agent) });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const text = await response.text();
      expect(Buffer.byteLength(text)).toBeLessThan(REVIEW_STORE_LIMITS.replayBytes);
      const page = JSON.parse(text);
      expect(page).toMatchObject({ identity: f.identity, source: { name: source.name, bytes: source.bytes, sha256: source.sha256 }, offset, provenance: "legacy-unverified" });
      const chunk = Buffer.from(page.base64, "base64");
      expect(chunk.length).toBeLessThanOrEqual(49152);
      chunks.push(chunk);
      if (page.next === null) break;
      expect(page.next).toBe(offset + chunk.length);
      offset = page.next;
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(JSON.parse(Buffer.concat(chunks).toString())[0].versions).toBeUndefined();
    for (const query of ["offset=-1", "limit=0", "limit=49153", "offset=1&offset=2", "extra=1", `offset=${bytes.length + 1}`]) {
      expect((await f.app.request(`${route}?${query}`, { headers: f.headers(f.agent) })).status, query).toBe(400);
    }
    expect((await f.app.request("/api/review-core/legacy/sources/viewed.json", { headers: f.headers(f.agent) })).status).toBe(404);
    expect((await f.app.request("/api/review-core/legacy/sources/unknown.json", { headers: f.headers(f.agent) })).status).toBe(400);
    await f.core.close();
    const reopened = await f.open();
    const app = new Hono().route("/api/review-core", createReviewCoreApi(reopened));
    const last = await (await app.request(`${route}?offset=${bytes.length}`, { headers: f.headers(f.agent) })).json();
    expect(last).toMatchObject({ offset: bytes.length, next: null, base64: "" });
    expect(reopened.state(f.human)).toEqual(state);
  });

  it("mounts only for an explicitly supplied core and keeps review authority separate from session authentication", async () => {
    const f = await fixture();
    const security = { bindHost: "127.0.0.1", authToken: "session-only", insecureNoAuth: false };
    const create = (core?: ReviewCore) => createApp(f.directory, DEFAULTS, new InMemoryCommentStore(), new InMemoryPlanStore(), undefined, false, security, undefined, undefined, undefined, undefined, undefined, core);
    const headers = { [SESSION_TOKEN_HEADER]: security.authToken };
    const inactive = await create().request("/api/review-core/state", { headers });
    expect(inactive.status).toBe(404);
    expect(await inactive.json()).toEqual({ code: "review_core_disabled" });
    const app = create(f.core);
    expect((await app.request("/api/review-core/state", { headers })).status).toBe(401);
    const state = await app.request("/api/review-core/state", { headers: { ...headers, ...f.headers(f.human) } });
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ identity: f.identity, version: 1 });
  });

  it("requires a trusted review credential and rejects forged actors and agent decisions", async () => {
    const f = await fixture();
    expect((await f.app.request("/api/review-core/state", { headers: { "X-Diffing-Token": f.human, Cookie: `token=${f.human}` } })).status).toBe(401);
    const forged = await f.post({ ...f.request("forged", { op: "capture" }), actor: { id: "human", kind: "human" } }, f.agent);
    expect(forged.status).toBe(400);
    const denied = await f.post(f.request("approve", { op: "decision.record", decision: "approved", rationale: "claimed human" }), f.agent);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "forbidden" });
    expect(f.core.state(f.human).version).toBe(1);
    f.authority.revoke(f.agent);
    expect((await f.app.request("/api/review-core/state", { headers: f.headers(f.agent) })).status).toBe(401);
  });

  it("acknowledges committed operations and replays the same result after restart", async () => {
    const f = await fixture();
    const input = f.request("capture", { op: "capture" });
    const first = await f.post(input);
    expect(first.status).toBe(200);
    const committed = await first.json();
    expect(committed).toMatchObject({ version: 1, sequence: 2, result: { actor: { id: "human", kind: "human" }, operation: "capture" } });
    expect(committed).not.toHaveProperty("events");
    expect(await (await f.post(input)).json()).toEqual(committed);
    const stale = await f.post({ ...input, requestId: "different" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "version_conflict", sequence: 2 });
    await f.core.close();
    const reopened = await f.open();
    const response = await createReviewCoreApi(reopened).request("/operations", { method: "POST", headers: f.headers(f.human), body: JSON.stringify(input) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(committed);
  });

  it("reports an unknown write outcome without success and reconciles the original request after reopening", async () => {
    let flushed = 0;
    const f = await fixture({ store: { io: { afterFlush: async () => { if (++flushed === 2) throw new Error("private filesystem detail"); } } } });
    const input = f.request("lost-ack", { op: "capture" });
    const failure = await f.post(input);
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ code: "outcome_unknown", recovery: "retry_same_request" });
    await f.core.close();
    const reopened = await f.open();
    const response = await createReviewCoreApi(reopened).request("/operations", { method: "POST", headers: f.headers(f.human), body: JSON.stringify(input) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sequence: 2, result: { operation: "capture", sequence: 2 } });
    expect(reopened.state(f.human).snapshots).toHaveLength(1);
    expect(reopened.state(f.human).version).toBe(2);
  });

  it("binds bounded event replay to the review identity and validates cursors", async () => {
    const f = await fixture();
    await f.post(f.request("capture", { op: "capture" }));
    const query = new URLSearchParams({ ...f.identity, after: "0", limit: "1" });
    const read = async (params: URLSearchParams) => f.app.request(`/api/review-core/events?${params}`, { headers: f.headers(f.agent) });
    const first = await read(query);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    const page = await first.json();
    expect(page).toMatchObject({ identity: f.identity, next: 1, latest: 2 });
    expect(page.records.map((entry: { sequence: number }) => entry.sequence)).toEqual([1]);
    query.set("after", "1");
    const second = await (await read(query)).json();
    expect(second.records.map((entry: { sequence: number }) => entry.sequence)).toEqual([2]);
    expect(second.next).toBeNull();
    query.set("reviewId", randomUUID());
    expect((await read(query)).status).toBe(400);
    query.set("reviewId", f.identity.reviewId);
    query.append("after", "0");
    expect((await read(query)).status).toBe(400);
    query.set("after", "9007199254740992");
    expect((await read(query)).status).toBe(400);
  });

  it("rejects malformed or oversized requests without mutating the review", async () => {
    const f = await fixture();
    const malformed = await f.app.request("/api/review-core/operations", { method: "POST", headers: f.headers(f.human), body: "{" });
    expect(malformed.status).toBe(400);
    const large = await f.post({ text: "x".repeat(REVIEW_STORE_LIMITS.recordBytes) });
    expect(large.status).toBe(413);
    expect(f.core.state(f.human).version).toBe(1);
  });

  it("bounds large state responses while retaining bounded event recovery", async () => {
    const f = await fixture();
    const bytes = Buffer.from(JSON.stringify([{ id: "legacy", filePath: "a", side: "additions", lineNumber: 1, lineContent: "", body: "x".repeat(REVIEW_STORE_LIMITS.replayBytes), createdAt: 1, status: "open", replies: [] }]));
    await f.core.importLegacy(f.human, { version: 1, sources: [{ name: "comments.json", bytes: bytes.length, base64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex") }] });
    const response = await f.app.request("/api/review-core/state", { headers: f.headers(f.human) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ code: "response_too_large", recovery: "read_events" });
    const query = new URLSearchParams({ ...f.identity, after: "0", limit: "1000" });
    const events = await f.app.request(`/api/review-core/events?${query}`, { headers: f.headers(f.human) });
    expect(events.status).toBe(200);
    expect(Buffer.byteLength(await events.text())).toBeLessThanOrEqual(REVIEW_STORE_LIMITS.replayBytes);
  });
});


it("serves the adopted browser route and migrates legacy links without enabling old writes", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, "index.html"), '<html><head></head><body><div id="root">fixture</div></body></html>');
  const app = createApp(f.directory, DEFAULTS, new InMemoryCommentStore(), new InMemoryPlanStore(), undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, f.core, "ui");
  expect((await app.request("/")).headers.get("Location")).toBe("/review-core");
  for (const path of ["/plan/old-id", "/mockup/old-id", "/gh/pr"]) expect((await app.request(path)).headers.get("Location")).toBe("/review-core?legacy=1");
  expect((await app.request("/review-core")).status).toBe(200);
  const write = await app.request("/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  expect(write.status).toBe(409);
  expect(await write.json()).toMatchObject({ recovery: "use_review_core_operations" });
  expect((await app.request("/api/review-core/state", { headers: f.headers(f.human) })).status).toBe(200);
  expect(f.core.state(f.human).version).toBe(1);
});
