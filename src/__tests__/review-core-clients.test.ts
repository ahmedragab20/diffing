// @vitest-environment node
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runReviewCoreCommand, runDurableAlias } from "../cli-review-core.js";
import { createReviewCoreApi, REVIEW_CREDENTIAL_HEADER } from "../lib/review-core-api.js";
import { ReviewAuthority } from "../lib/review-authority.js";
import { ReviewCore } from "../lib/review-core.js";
import { captureInspection } from "../lib/inspect-capture.js";
import { AgentDiffIndexCache } from "../lib/agent-diff-index.js";
import { DEFAULTS } from "../lib/diff-options.js";
import { ReviewStore } from "../lib/review-store.js";
import { reviewProtocolDocument } from "../lib/review-protocol.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "diffing-review-clients-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority();
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "capture", "comment", "handoff", "decide"]);
  const agent = authority.issue(identity, { id: "agent", kind: "agent" }, ["read", "capture", "comment", "work"]);
  const patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
  const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch, complete: true }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: null, indexDigest: "c".repeat(64), resolvedRevisions: [] }));
  const index = new AgentDiffIndexCache().getOrBuild(patch, true, undefined, captured.manifest);
  const capture = vi.fn(async () => index);
  const core = await ReviewCore.open(directory, identity, authority, { capture, get: (id: string) => id === index.manifest!.snapshotId ? index : undefined }, { openStore: (path) => ReviewStore.open(path) });
  cleanup.push(() => core.close());
  const app = new Hono().route("/api/review-core", createReviewCoreApi(core));
  let server!: ReturnType<typeof serve>;
  const port = await new Promise<number>((resolve) => { server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => resolve(info.port)); });
  const writeConnection = async (credential = agent, actor = { id: "agent", kind: "agent" }) => {
    const file = join(directory, `${actor.kind}.json`);
    await writeFile(file, JSON.stringify({ version: 1, origin: `http://127.0.0.1:${port}/`, identity, actor, credential, headers: { "x-diffing-token": "d".repeat(64) }, expiresAt: Date.now() + 60_000 }), { mode: 0o600 });
    await chmod(file, 0o600);
    return file;
  };
  cleanup.push(() => new Promise<void>((resolve, reject) => { if ("closeAllConnections" in server) server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }));
  return { directory, identity, authority, human, agent, core, app, capture, writeConnection, port };
}

async function cliJson(operation: string, connection: string, file?: string) {
  const output: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));
  try { await runReviewCoreCommand([operation, "--connection", connection, ...(file ? ["--file", file] : [])]); return JSON.parse(output.at(-1)!); }
  finally { log.mockRestore(); }
}

describe("CLI durable review clients", () => {
  it("matches JS CLI state, exact retry, and batch durability", async () => {
    const f = await fixture();
    const connection = await f.writeConnection();
    expect(await cliJson("state", connection)).toMatchObject({ identity: f.identity, version: 1, comments: [] });
    const requestFile = join(f.directory, "capture.json");
    await writeFile(requestFile, JSON.stringify({ ...f.identity, version: 1, requestId: "capture", expectedVersion: 1, snapshotId: null, command: { op: "capture" } }));
    const captured = await cliJson("execute", connection, requestFile);
    const commentFile = join(f.directory, "comment.json");
    await writeFile(commentFile, JSON.stringify({ ...f.identity, version: 1, requestId: "comment", expectedVersion: captured.sequence, snapshotId: captured.result.snapshotId, command: { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "cli" } }));
    const first = await cliJson("execute", connection, commentFile);
    const replay = await cliJson("execute", connection, commentFile);
    expect(replay).toEqual(first);
    expect(f.core.state(f.human).comments).toHaveLength(1);
    expect(f.capture).toHaveBeenCalledTimes(1);
    const batchFile = join(f.directory, "batch.json");
    await writeFile(batchFile, JSON.stringify({ version: 1, mode: "per-item", requests: [{ ...JSON.parse(await readFile(commentFile, "utf8")), requestId: "comment-again" }] }));
    const batch = await cliJson("batch", connection, batchFile);
    expect(batch.results[0].ok).toBe(false);
    expect(f.core.state(f.human).comments).toHaveLength(1);
  });

  it("keeps durable aliases read-only and matches the checked-in protocol document", async () => {
    const f = await fixture();
    const connection = await f.writeConnection();
    const error: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation((value) => error.push(String(value)));
    try {
      expect(await runDurableAlias("comments", [], connection)).toBe(0);
      expect(await runDurableAlias("reply", [], connection)).toBe(1);
      expect(await runDurableAlias("resolve", [], connection)).toBe(1);
    } finally { log.mockRestore(); stderr.mockRestore(); }
    expect(f.core.state(f.human).version).toBe(1);
    expect(error.map((entry) => JSON.parse(entry))).toEqual([
      expect.objectContaining({ code: "review_core_required", recovery: "use_review_core_operations" }),
      expect.objectContaining({ code: "review_core_required", recovery: "use_review_core_operations" }),
    ]);
    expect(JSON.parse(await readFile(join(process.cwd(), "docs/review-core-contract.json"), "utf8"))).toEqual(reviewProtocolDocument());
  });
});
