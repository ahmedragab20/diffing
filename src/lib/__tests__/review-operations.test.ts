// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ReviewCore } from "../review-core.js";
import { ReviewAuthority } from "../review-authority.js";
import { createReviewCoreApi, REVIEW_CREDENTIAL_HEADER } from "../review-core-api.js";
import { captureInspection } from "../inspect-capture.js";
import { AgentDiffIndexCache } from "../agent-diff-index.js";
import { DEFAULTS } from "../diff-options.js";
import { ReviewStore } from "../review-store.js";
import { reviewCommandSchema } from "../review-core-contract.js";
import { reviewOperations, REVIEW_BATCH_LIMIT } from "../review-operations.js";
import { ReviewClient, prepareReviewRequest } from "../review-client.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "diffing-review-operations-"));
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
  const headers = (token: string) => ({ [REVIEW_CREDENTIAL_HEADER]: token, "Content-Type": "application/json" });
  const request = (requestId: string, command: Parameters<typeof prepareReviewRequest>[1], token = human, expectedVersion = core.state(token).version, snapshotId = core.state(token).currentSnapshotId) => prepareReviewRequest({ identity, version: expectedVersion, currentSnapshotId: snapshotId }, command, { requestId });
  const post = (body: unknown, token = human) => app.request("/api/review-core/operations", { method: "POST", headers: headers(token), body: JSON.stringify(body) });
  const transport = vi.fn<typeof fetch>(async (input, init) => app.request(String(input), init));
  const client = (credential = human, fetcher: typeof fetch = transport) => new ReviewClient({ origin: "http://127.0.0.1:3000", credential, identity, fetch: fetcher });
  return { identity, authority, human, agent, core, app, headers, request, post, transport, client };
}

describe("review operation catalog and derived actions", () => {
  it("catalogs every review command and filters decision authority by actor", async () => {
    const f = await fixture();
    const names = reviewCommandSchema.options.map((command) => command.shape.op.value);
    expect(Object.keys(reviewOperations).sort()).toEqual(names.sort());
    expect(f.core.capabilities(f.human).operations.map(({ name }) => name).sort()).toEqual(names.filter((name) => reviewOperations[name].permission !== "work").sort());
    expect(f.core.capabilities(f.human).operations.find(({ name }) => name === "decision.record")?.permission).toBe("decide");
    expect(f.core.capabilities(f.agent).operations.map(({ name }) => name)).not.toContain("decision.record");
  });

  it("rejects unauthenticated capability reads and derives capture then review actions", async () => {
    const f = await fixture();
    expect((await f.app.request("/api/review-core/capabilities")).status).toBe(401);
    expect((await f.app.request("/api/review-core/next-actions", { headers: f.headers(f.agent) })).status).toBe(200);
    const before = await (await f.app.request("/api/review-core/next-actions", { headers: f.headers(f.agent) })).json();
    expect(before.actions.map((action: { operation: string }) => action.operation)).toContain("capture");
    const captured = await (await f.post(f.request("capture", { op: "capture" }))).json();
    const after = await (await f.app.request("/api/review-core/next-actions", { headers: f.headers(f.agent) })).json();
    expect(after.version).toBe(captured.sequence);
    expect(after.actions.map((action: { operation: string }) => action.operation)).toContain("comment.add");
    expect(after.actions.map((action: { operation: string }) => action.operation)).not.toContain("decision.record");
    const stale = f.request("stale-hint", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "stale" }, f.agent, before.version, null);
    const rejected = await f.post(stale, f.agent);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "version_conflict" });
  });
});

describe("review operation batches", () => {
  it("processes sequential versions, continues after a forbidden item, and replays idempotently", async () => {
    const f = await fixture();
    const human = f.client(f.human);
    await human.execute(f.request("capture", { op: "capture" }));
    const snapshotId = f.core.state(f.human).currentSnapshotId;
    const first = f.request("batch-one", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "one" }, f.agent, 2, snapshotId);
    const forbidden = f.request("batch-decision", { op: "decision.record", decision: "approved", rationale: "agent" }, f.agent, 3, snapshotId);
    const second = f.request("batch-two", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "two" }, f.agent, 3, snapshotId);
    const agent = f.client(f.agent);
    const body = { version: 1 as const, mode: "per-item" as const, requests: [first, forbidden, second] };
    const result = await agent.batch(body);
    expect(result.results.map((item) => item.requestId)).toEqual(["batch-one", "batch-decision", "batch-two"]);
    expect(result.results.map((item) => item.ok)).toEqual([true, false, true]);
    expect(f.core.state(f.human).comments.map(({ body: text }) => text)).toEqual(["one", "two"]);
    expect(f.core.state(f.human).version).toBe(4);
    expect(await agent.batch(body)).toEqual(result);
    expect(f.core.state(f.human).comments).toHaveLength(2);
    const changed = { ...body, requests: [{ ...first, command: { ...first.command, body: "changed" } }, forbidden, second] };
    const changedResult = await agent.batch(changed);
    expect(changedResult.results[0]).toMatchObject({ requestId: "batch-one", ok: false, error: { code: "idempotency_conflict" } });
    expect(f.core.state(f.human).comments).toHaveLength(2);
  });

  it("rejects oversized and invalid batches before any item is written", async () => {
    const f = await fixture();
    const base = f.request("too-many-0", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "x" }, f.human, 1, null);
    const oversized = { version: 1, mode: "per-item", requests: Array.from({ length: REVIEW_BATCH_LIMIT + 1 }, (_, index) => ({ ...base, requestId: `too-many-${index}` })) };
    const response = await f.app.request("/api/review-core/batch", { method: "POST", headers: f.headers(f.human), body: JSON.stringify(oversized) });
    expect(response.status).toBe(400);
    expect(f.core.state(f.human).version).toBe(1);
    expect(f.core.state(f.human).comments).toHaveLength(0);
    const invalid = await f.app.request("/api/review-core/batch", { method: "POST", headers: f.headers(f.human), body: JSON.stringify({ version: 1, mode: "wrong", requests: [base] }) });
    expect(invalid.status).toBe(400);
    expect(f.core.state(f.human).version).toBe(1);
  });

  it("validates returned batch request IDs and order in the client", async () => {
    const f = await fixture();
    const request = f.request("malformed", { op: "capture" }, f.human, 1, null);
    const client = f.client(f.human, async (input, init) => {
      const response = await f.transport(input, init);
      const payload = await response.json();
      payload.results[0].requestId = "different";
      return Response.json(payload);
    });
    await expect(client.batch({ version: 1, mode: "per-item", requests: [request] })).rejects.toMatchObject({ code: "outcome_unknown", recovery: "retry_same_request" });
    expect(f.core.state(f.human).version).toBe(2);
  });
});


describe("review protocol compatibility", () => {
  it("negotiates explicit versions and gives typed recovery without changing legacy errors", async () => {
    const f = await fixture();
    const modern = { ...f.headers(f.agent), "X-Diffing-Review-Protocol": "1" };
    const future = await f.app.request("/api/review-core/capabilities", { headers: { ...modern, "X-Diffing-Review-Protocol": "2" } });
    expect(future.status).toBe(409);
    expect(await future.json()).toEqual({ code: "unsupported_version", recovery: "upgrade_client" });
    const noGrant = await f.app.request("/api/review-core/state", { headers: { "X-Diffing-Review-Protocol": "1" } });
    expect(await noGrant.json()).toEqual({ code: "unauthenticated", recovery: "reconnect" });
    const invalid = await f.app.request("/api/review-core/operations", { method: "POST", headers: modern, body: "{}" });
    expect(await invalid.json()).toEqual({ code: "invalid_request", recovery: "fix_request" });
    const legacy = await f.app.request("/api/review-core/state");
    expect(await legacy.json()).toEqual({ code: "unauthenticated" });
    const contract = await f.app.request("/api/review-core/contract", { headers: modern });
    expect(contract.headers.get("X-Diffing-Review-Protocol")).toBe("1");
    expect((await contract.json()).nativeSubset.mutations).toEqual([]);
    expect(f.core.state(f.human).version).toBe(1);
  });
  it("rejects explicit incompatible responses, retaining mutation uncertainty", async () => {
    const f = await fixture();
    const client = f.client(f.human, async (input, init) => {
      const response = await f.transport(input, init);
      response.headers.set("X-Diffing-Review-Protocol", "2");
      return response;
    });
    await expect(client.state()).rejects.toMatchObject({ code: "unsupported_version", recovery: "upgrade_client" });
    await expect(client.execute(f.request("incompatible-ack", { op: "capture" }))).rejects.toMatchObject({ code: "outcome_unknown", recovery: "retry_same_request" });
    expect(f.core.state(f.human).version).toBe(2);
  });
});
