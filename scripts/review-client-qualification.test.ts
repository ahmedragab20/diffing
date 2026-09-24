import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createReviewCoreApi } from "../src/lib/review-core-api.js";
import { ReviewAuthority } from "../src/lib/review-authority.js";
import { ReviewCore } from "../src/lib/review-core.js";
import { captureInspection } from "../src/lib/inspect-capture.js";
import { AgentDiffIndexCache } from "../src/lib/agent-diff-index.js";
import { DEFAULTS } from "../src/lib/diff-options.js";
import { ReviewStore } from "../src/lib/review-store.js";

const execFileAsync = promisify(execFile);
const binary = process.env.DIFFING_SQLITE_TEST_BINARY ?? join(process.cwd(), "target/debug", process.platform === "win32" ? "diffing-tui.exe" : "diffing-tui");

async function runNative(connection: string, read: string) {
  return execFileAsync(binary, ["--review-connection", connection, "--review-read", read], { timeout: 120_000, maxBuffer: 512 * 1024 });
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "diffing-native-qualification-"));
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority();
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "capture", "comment", "handoff", "decide"]);
  const agent = authority.issue(identity, { id: "agent", kind: "agent" }, ["read", "capture", "comment", "work"]);
  const patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
  const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch, complete: true }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: null, indexDigest: "c".repeat(64), resolvedRevisions: [] }));
  const index = new AgentDiffIndexCache().getOrBuild(patch, true, undefined, captured.manifest);
  let captures = 0;
  const core = await ReviewCore.open(directory, identity, authority, { capture: async () => { captures++; return index; }, get: (id: string) => id === index.manifest!.snapshotId ? index : undefined }, { openStore: (path) => ReviewStore.open(path) });
  const app = new Hono().route("/api/review-core", createReviewCoreApi(core));
  let server: ReturnType<typeof serve> | undefined;
  const port = await new Promise<number>((resolve) => { server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => resolve(info.port)); });
  const writeConnection = async (value: Record<string, unknown> = {}) => {
    const file = join(directory, `connection-${randomUUID()}.json`);
    const connection = { version: 1, origin: `http://127.0.0.1:${port}/`, identity, actor: { id: "agent", kind: "agent" }, credential: agent, headers: { "x-diffing-token": "d".repeat(64) }, expiresAt: Date.now() + 60_000, ...value };
    await writeFile(file, JSON.stringify(connection), { mode: 0o600 }); await chmod(file, 0o600); return file;
  };
  const close = async () => { if (server && "closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve())); await core.close(); await rm(directory, { recursive: true, force: true }); };
  return { directory, identity, human, agent, core, writeConnection, close, captures, get captureCount() { return captures; }, snapshotId: index.manifest!.snapshotId };
}

test("native reads are read-only and populated state matches the JS core", { timeout: 150_000 }, async () => {
  const f = await fixture();
  try {
    const connection = await f.writeConnection();
    const empty = JSON.parse((await runNative(connection, "state")).stdout);
    assert.equal(empty.version, 1);
    assert.equal(f.captureCount, 0);
    const captured = await f.core.execute(f.human, { ...f.identity, version: 1, requestId: "capture", expectedVersion: 1, snapshotId: null, command: { op: "capture" } });
    const comment = await f.core.execute(f.human, { ...f.identity, version: 1, requestId: "comment", expectedVersion: captured.sequence, snapshotId: captured.result.snapshotId, command: { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "native" } });
    await f.core.execute(f.human, { ...f.identity, version: 1, requestId: "handoff", expectedVersion: comment.sequence, snapshotId: captured.result.snapshotId, command: { op: "handoff.create", recipient: "agent", instructions: "inspect", commentIds: [comment.result.id] } });
    const captureCount = f.captureCount;
    const nativeState = JSON.parse((await runNative(connection, "state")).stdout);
    const jsState = f.core.state(f.human);
    assert.deepEqual({ identity: nativeState.identity, version: nativeState.version, comments: nativeState.comments, handoffs: nativeState.handoffs }, { identity: jsState.identity, version: jsState.version, comments: jsState.comments, handoffs: jsState.handoffs });
    assert.equal(f.captureCount, captureCount);
    assert.deepEqual(nativeState, JSON.parse(JSON.stringify(jsState)));
    assert.deepEqual(JSON.parse((await runNative(connection, "capabilities")).stdout), f.core.capabilities(f.agent));
    assert.deepEqual(JSON.parse((await runNative(connection, "next-actions")).stdout), f.core.nextActions(f.agent));
  } finally { await f.close(); }
});

test("native rejects secret-bearing credential changes and invalid connection modes", { timeout: 150_000 }, async () => {
  const f = await fixture();
  try {
    const connection = await f.writeConnection();
    const value = { credential: "z".repeat(43) };
    const altered = await f.writeConnection(value);
    await assert.rejects(runNative(altered, "state"), (error: any) => /unauthenticated/.test(error.stderr) && !error.stderr.includes(value.credential) && !error.stderr.includes("d".repeat(64)));
    const nonloopback = await f.writeConnection({ origin: "http://192.0.2.1:1234/" });
    await assert.rejects(runNative(nonloopback, "state"), (error: any) => /loopback|invalid_connection/.test(error.stderr));
    const insecure = await f.writeConnection({}); await chmod(insecure, 0o644);
    if (process.platform !== "win32") await assert.rejects(runNative(insecure, "state"), (error: any) => /insecure_connection/.test(error.stderr));
    else assert.equal(JSON.parse((await runNative(insecure, "state")).stdout).version, 1);
    const wrongReview = await f.writeConnection({ identity: { ...f.identity, reviewId: randomUUID() } });
    await assert.rejects(runNative(wrongReview, "state"), (error: any) => /wrong_review/.test(error.stderr));
    const expired = await f.writeConnection({ expiresAt: 1 });
    await assert.rejects(runNative(expired, "state"), (error: any) => /credential_expired/.test(error.stderr));
    const future = await f.writeConnection({ version: 2 });
    await assert.rejects(runNative(future, "state"), (error: any) => /unsupported_version/.test(error.stderr));
    assert.ok(connection);
  } finally { await f.close(); }
});

test("native binary is present and executable for qualification", async () => {
  try { await execFileAsync(binary, ["--help"], { timeout: 120_000 }); }
  catch (error) { throw new Error(`Native qualification binary unavailable at ${binary}; build with cargo build --locked -p diffing-tui before running this script. ${String(error)}`); }
});
