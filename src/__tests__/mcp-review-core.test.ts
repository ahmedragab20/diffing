// @vitest-environment node
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createReviewCoreMcpServer } from "../mcp-review-core.js";
import { ReviewCore } from "../lib/review-core.js";
import { ReviewAuthority } from "../lib/review-authority.js";
import { createReviewCoreApi, REVIEW_CREDENTIAL_HEADER } from "../lib/review-core-api.js";
import { captureInspection } from "../lib/inspect-capture.js";
import { AgentDiffIndexCache } from "../lib/agent-diff-index.js";
import { DEFAULTS } from "../lib/diff-options.js";
import { ReviewStore } from "../lib/review-store.js";
import { SESSION_TOKEN_HEADER } from "../lib/session-token.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "diffing-mcp-review-core-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority();
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "capture", "comment", "handoff", "decide"]);
  const agent = authority.issue(identity, { id: "agent", kind: "agent" }, ["read", "capture", "comment", "work"]);
  const patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
  const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch, complete: true }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: null, indexDigest: "c".repeat(64), resolvedRevisions: [] }));
  const index = new AgentDiffIndexCache().getOrBuild(patch, true, undefined, captured.manifest);
  const sources = { capture: async () => index, get: (id: string) => id === index.manifest!.snapshotId ? index : undefined };
  const core = await ReviewCore.open(directory, identity, authority, sources, { openStore: (path) => ReviewStore.open(path) });
  cleanup.push(() => core.close());
  const app = new Hono().route("/api/review-core", createReviewCoreApi(core));
  const connectionFile = join(directory, "connection.json");
  const sessionToken = "d".repeat(64);
  await writeFile(connectionFile, JSON.stringify({ version: 1, origin: "http://127.0.0.1:3000/", identity, actor: { id: "agent", kind: "agent" }, credential: agent, headers: { [SESSION_TOKEN_HEADER]: sessionToken }, expiresAt: Date.now() + 60_000 }), { mode: 0o600 });
  await chmod(connectionFile, 0o600);
  const fetcher: typeof fetch = async (input, init) => app.request(String(input), init);
  const server = createReviewCoreMcpServer({ connectionFile, version: "test", fetch: fetcher });
  const client = new Client({ name: "review-core-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return { identity, human, agent, authority, core, app, client, server, snapshotId: index.manifest!.snapshotId };
}

const resultOf = (response: Awaited<ReturnType<Client["callTool"]>>) => response.structuredContent as { result: Record<string, any> };

describe("durable review core MCP tools", () => {
  it("discovers agent-safe tools and reads state/source after explicit capture", async () => {
    const f = await fixture();
    const tools = await f.client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["review_capabilities", "review_state", "review_execute", "review_source", "review_batch"]));
    const guide = await readFile(join(process.cwd(), "skills/diffing/SKILL.md"), "utf8");
    const durableGuide = guide.split("## Adopted durable reviews")[1].split("## Before you start")[0];
    for (const name of new Set(durableGuide.match(/\breview_[a-z_]+/g))) expect(names).toContain(name);
    const alias = await f.client.callTool({ name: "resolve_comment", arguments: { id: "invented", role: "human" } });
    expect(resultOf(alias).result).toEqual({ code: "review_core_required", recovery: "use_review_core_operations" });
    expect(f.core.state(f.human).version).toBe(1);
    const execute = tools.tools.find((tool) => tool.name === "review_execute");
    expect(JSON.stringify(execute?.inputSchema)).not.toContain("decision.record");
    const capabilities = resultOf(await f.client.callTool({ name: "review_capabilities", arguments: {} })).result;
    expect(capabilities.operations.some((operation: { name: string }) => operation.name === "decision.record")).toBe(false);
    const initial = resultOf(await f.client.callTool({ name: "review_state", arguments: {} })).result;
    const request = { ...f.identity, version: 1, requestId: "capture", expectedVersion: initial.version, snapshotId: null, command: { op: "capture" } };
    const captured = resultOf(await f.client.callTool({ name: "review_execute", arguments: request })).result;
    expect(captured.result.operation).toBe("capture");
    const source = resultOf(await f.client.callTool({ name: "review_source", arguments: { snapshotId: captured.result.snapshotId, limit: 1 } })).result;
    expect(source.entries[0].file.path).toBe("a");
  });

  it("retries an exact envelope idempotently and applies its effect once", async () => {
    const f = await fixture();
    const capture = { ...f.identity, version: 1, requestId: "capture", expectedVersion: 1, snapshotId: null, command: { op: "capture" } };
    const first = resultOf(await f.client.callTool({ name: "review_execute", arguments: capture })).result;
    const comment = { ...f.identity, version: 1, requestId: "comment-once", expectedVersion: first.result.sequence, snapshotId: first.result.snapshotId, command: { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "once" } };
    const acknowledged = resultOf(await f.client.callTool({ name: "review_execute", arguments: comment })).result;
    const replay = resultOf(await f.client.callTool({ name: "review_execute", arguments: comment })).result;
    expect(replay).toEqual(acknowledged);
    expect(f.core.state(f.human).comments).toHaveLength(1);
  });

  it("keeps batch successes when an invalid transition fails one item", async () => {
    const f = await fixture();
    const capture = { ...f.identity, version: 1, requestId: "capture", expectedVersion: 1, snapshotId: null, command: { op: "capture" } };
    const snapshot = resultOf(await f.client.callTool({ name: "review_execute", arguments: capture })).result.result.snapshotId;
    const requests = [
      { ...f.identity, version: 1, requestId: "one", expectedVersion: 2, snapshotId: snapshot, command: { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "one" } },
      { ...f.identity, version: 1, requestId: "bad", expectedVersion: 3, snapshotId: snapshot, command: { op: "comment.reply", commentId: "missing", body: "missing" } },
      { ...f.identity, version: 1, requestId: "two", expectedVersion: 3, snapshotId: snapshot, command: { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "two" } },
    ];
    const batch = resultOf(await f.client.callTool({ name: "review_batch", arguments: { version: 1, mode: "per-item", requests } })).result;
    expect(batch.results.map((item: { ok: boolean }) => item.ok)).toEqual([true, false, true]);
    expect(batch.results[1].error.code).toBe("not_found");
    expect(f.core.state(f.human).comments.map(({ body }) => body)).toEqual(["one", "two"]);
  });

  it("returns typed errors for a human connection and rejected requests", async () => {
    const f = await fixture();
    const humanDirectory = await mkdtemp(join(tmpdir(), "diffing-human-connection-"));
    const humanFile = join(humanDirectory, "connection.json");
    cleanup.push(() => rm(humanDirectory, { recursive: true, force: true }));
    await writeFile(humanFile, JSON.stringify({ version: 1, origin: "http://127.0.0.1:3000/", identity: f.identity, actor: { id: "human", kind: "human" }, credential: f.human, headers: { [SESSION_TOKEN_HEADER]: "e".repeat(64) }, expiresAt: Date.now() + 60_000 }), { mode: 0o600 });
    const server = createReviewCoreMcpServer({ connectionFile: humanFile, version: "test", fetch: async (input, init) => f.app.request(String(input), init) });
    const client = new Client({ name: "human-test", version: "1.0.0" }, { capabilities: {} });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a);
    const denied = await client.callTool({ name: "review_state", arguments: {} });
    expect(denied.isError).toBe(true);
    expect(resultOf(denied).result).toMatchObject({ code: "forbidden", recovery: "request_permission" });
    await client.close(); await server.close();
    const malformed = await f.client.callTool({ name: "review_execute", arguments: { role: "human" } });
    expect(resultOf(malformed).result).toEqual({ code: "invalid_request", recovery: "fix_request" });
    const bad = await f.client.callTool({ name: "review_execute", arguments: { ...f.identity, version: 1, requestId: "bad", expectedVersion: 999, snapshotId: null, command: { op: "capture" } } });
    expect(bad.isError).toBe(true);
    expect(resultOf(bad).result).toMatchObject({ code: "version_conflict" });
  });
});
