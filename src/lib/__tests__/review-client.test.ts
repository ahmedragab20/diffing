// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewClient, prepareReviewRequest } from "../review-client.js";
import { ReviewCore } from "../review-core.js";
import { ReviewAuthority } from "../review-authority.js";
import { ReviewStore, REVIEW_STORE_LIMITS } from "../review-store.js";
import { createReviewCoreApi, REVIEW_CREDENTIAL_HEADER } from "../review-core-api.js";
import { captureInspection } from "../inspect-capture.js";
import { AgentDiffIndexCache } from "../agent-diff-index.js";
import { DEFAULTS } from "../diff-options.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "diffing-review-client-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority();
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "capture", "comment", "handoff", "decide"]);
  const agent = authority.issue(identity, { id: "agent", kind: "agent" }, ["read", "capture", "comment", "work"]);
  const patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+café\n";
  const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch, complete: true, layers: [{ kind: "working", patch }] }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: null, indexDigest: "c".repeat(64), resolvedRevisions: [] }));
  const index = new AgentDiffIndexCache().getOrBuild(patch, true, undefined, captured.manifest);
  const sources = { capture: async () => index, get: (id: string) => id === index.manifest!.snapshotId ? index : undefined };
  let core: ReviewCore;
  let app: Hono;
  const open = async () => {
    core = await ReviewCore.open(directory, identity, authority, sources, { openStore: (path) => ReviewStore.open(path) });
    const owned = core;
    cleanup.push(() => owned.close());
    app = new Hono().route("/api/review-core", createReviewCoreApi(core));
  };
  await open();
  const transport = vi.fn<typeof fetch>(async (input, init) => app.request(String(input), init));
  const client = (credential = human, fetcher: typeof fetch = transport) => new ReviewClient({ origin: "http://127.0.0.1:3000", credential, identity, fetch: fetcher });
  return { identity, human, agent, authority, transport, client, core: () => core, reopen: async () => { await core.close(); await open(); } };
}

describe("review client", () => {
  it("exports original migrated bytes across restart without inventing plan history or approval authority", async () => {
    const f = await fixture();
    const bytes = Buffer.from(JSON.stringify([{ id: "original", title: "Plan", body: "محفوظ".repeat(12_000), createdAt: 1, decision: "approved", version: 4 }], null, 2));
    const source = { name: "plans.json" as const, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), base64: bytes.toString("base64") };
    await f.core().importLegacy(f.human, { version: 1, sources: [source] });
    await f.reopen();
    const recovered = await f.client(f.agent).exportLegacySource("plans.json");
    expect(Buffer.from(recovered.bytes)).toEqual(bytes);
    expect(recovered).toMatchObject({ identity: f.identity, provenance: "legacy-unverified", source: { name: source.name, bytes: source.bytes, sha256: source.sha256 } });
    expect(JSON.parse(new TextDecoder().decode(recovered.bytes))[0].versions).toBeUndefined();
    expect((await f.client().state()).decisions).toEqual([]);
    expect(f.transport.mock.calls.filter(([url]) => String(url).includes("/legacy/sources/")).length).toBeGreaterThan(1);
  });

  it.each(["digest", "changed-source", "offset", "continuation", "base64"])("rejects %s corruption while exporting a migrated source", async (kind) => {
    const f = await fixture();
    const bytes = Buffer.from(JSON.stringify([{ id: "original", title: "Plan", body: "x".repeat(60_000), createdAt: 1, decision: "pending" }]));
    await f.core().importLegacy(f.human, { version: 1, sources: [{ name: "plans.json", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), base64: bytes.toString("base64") }] });
    const client = f.client(f.agent, async (url, init) => {
      const page = await (await f.transport(url, init)).json();
      if (kind === "digest") page.source.sha256 = "f".repeat(64);
      if (kind === "changed-source" && page.offset > 0) page.source.sha256 = "f".repeat(64);
      if (kind === "offset") page.offset++;
      if (kind === "continuation") page.next = 0;
      if (kind === "base64") page.base64 = "!";
      return Response.json(page);
    });
    await expect(client.exportLegacySource("plans.json")).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.transport.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("reconciles a dropped committed reply by sending the exact original request after reopen", async () => {
    const f = await fixture();
    let drop = false;
    const client = f.client(f.human, async (input, init) => {
      const response = await f.transport(input, init);
      if (drop) { drop = false; throw new TypeError("connection closed after commit"); }
      return response;
    });
    await client.execute(prepareReviewRequest(await client.state(), { op: "capture" }));
    const request = prepareReviewRequest(await client.state(), { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "café — محفوظ" });
    f.transport.mockClear();
    drop = true;
    await expect(client.execute(request)).rejects.toMatchObject({ code: "outcome_unknown", recovery: "retry_same_request" });
    expect(f.core().state(f.human).comments).toHaveLength(1);
    await f.reopen();
    const acknowledged = await client.execute(JSON.parse(JSON.stringify(request)));
    expect(acknowledged.sequence).toBe(request.expectedVersion + 1);
    expect(f.transport.mock.calls.map(([, init]) => init?.body)).toEqual([JSON.stringify(request), JSON.stringify(request)]);
    expect(f.core().state(f.human).comments).toHaveLength(1);
    await expect(client.execute({ ...request, command: { ...request.command, body: "different" } } as typeof request)).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    await expect(client.execute({ ...request, requestId: randomUUID() })).rejects.toMatchObject({ code: "version_conflict", sequence: acknowledged.sequence });
    expect(f.core().state(f.human).comments[0].body).toBe("café — محفوظ");
  });

  it("reads typed state, original handoff context and ordered reconnect pages through the same adapter", async () => {
    const f = await fixture();
    const client = f.client();
    await client.execute(prepareReviewRequest(await client.state(), { op: "capture" }));
    const comment = await client.execute(prepareReviewRequest(await client.state(), { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "original concern" }));
    const handoff = await client.execute(prepareReviewRequest(await client.state(), { op: "handoff.create", recipient: "agent", instructions: "address the concern", commentIds: [comment.result.id!] }));
    await client.execute(prepareReviewRequest(await client.state(), { op: "comment.delete", commentId: comment.result.id! }));
    const historical = await client.handoff(handoff.result.id!);
    expect(historical.sent.comments[0].body).toBe("original concern");
    expect((await client.state()).comments).toEqual([]);
    const sequences: number[] = [];
    let after = 0;
    for (;;) {
      const page = await client.events({ ...f.identity, after }, 2);
      sequences.push(...page.records.map((record) => record.sequence));
      if (page.next === null) break;
      after = page.next;
    }
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
    for (const [input, init] of f.transport.mock.calls) {
      expect(String(input)).not.toContain(f.human);
      expect(new Headers(init?.headers).get(REVIEW_CREDENTIAL_HEADER)).toBe(f.human);
      expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
    }
  });

  it("does not mint decision authority or retry rejected operations", async () => {
    const f = await fixture();
    const client = f.client(f.agent);
    await client.execute(prepareReviewRequest(await client.state(), { op: "capture" }));
    const input = prepareReviewRequest(await client.state(), { op: "decision.record", decision: "approved", rationale: "self approval" });
    f.transport.mockClear();
    await expect(client.execute(input)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.core().state(f.human).decisions).toEqual([]);
    f.authority.revoke(f.agent);
    await expect(client.state()).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
  });

  it.each(["malformed", "internal-error", "wrong-review", "wrong-operation", "wrong-sequence"])("treats a %s acknowledgement as unknown, with no automatic replay", async (kind) => {
    const f = await fixture();
    const state = await f.client().state();
    const input = prepareReviewRequest(state, { op: "capture" });
    const client = f.client(f.human, async (url, init) => {
      const response = await f.transport(url, init);
      if (kind === "malformed") return new Response("{", { status: 200 });
      if (kind === "internal-error") return Response.json({ code: "internal_error" }, { status: 500 });
      const body = await response.json();
      if (kind === "wrong-review") body.result.identity.reviewId = randomUUID();
      if (kind === "wrong-operation") body.result.operation = "comment.add";
      if (kind === "wrong-sequence") body.sequence = body.result.sequence = body.sequence + 1;
      return Response.json(body);
    });
    f.transport.mockClear();
    await expect(client.execute(input)).rejects.toMatchObject({ code: "outcome_unknown", recovery: "retry_same_request" });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.core().state(f.human).version).toBe(2);
    expect((await f.client().execute(input)).sequence).toBe(2);
  });

  it.each(["identity", "sequence", "continuation", "empty-progress"])("rejects an invalid %s reconnect page", async (kind) => {
    const f = await fixture();
    const client = f.client(f.human, async (url, init) => {
      const response = await f.transport(url, init);
      const page = await response.json();
      if (kind === "identity") page.identity.reviewId = randomUUID();
      if (kind === "sequence") page.records[0].sequence++;
      if (kind === "continuation") page.next = 0;
      if (kind === "empty-progress") { page.records = []; page.next = 0; }
      return Response.json(page);
    });
    await expect(client.events({ ...f.identity, after: 0 })).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it("rejects a different review before sending an operation and rejects a switched read identity", async () => {
    const f = await fixture();
    const client = f.client();
    const state = await client.state();
    const request = prepareReviewRequest({ ...state, identity: { ...state.identity, reviewId: randomUUID() } }, { op: "capture" });
    f.transport.mockClear();
    await expect(client.execute(request)).rejects.toMatchObject({ code: "wrong_review" });
    expect(f.transport).not.toHaveBeenCalled();
    const switched = f.client(f.human, async (url, init) => {
      const response = await f.transport(url, init);
      const payload = await response.json();
      payload.identity.workspaceId = "d".repeat(64);
      return Response.json(payload);
    });
    await expect(switched.state()).rejects.toMatchObject({ code: "wrong_review" });
  });

  it("rejects oversized UTF-8 requests before transport", async () => {
    const f = await fixture();
    const state = await f.client().state();
    // UTF-16 length remains valid while JSON encoding exceeds the byte ceiling.
    const request = prepareReviewRequest(state, { op: "handoff.create", recipient: "agent", instructions: "é".repeat(64 * 1024), commentIds: Array.from({ length: 1000 }, (_, i) => `${i}`.padEnd(200, "x")) });
    f.transport.mockClear();
    await expect(f.client().execute(request)).rejects.toMatchObject({ code: "request_too_large" });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("cancels an oversized streamed response and preserves an explicit historical snapshot in prepared work", async () => {
    const f = await fixture();
    const state = await f.client().state();
    const originalSnapshot = randomUUID();
    const request = prepareReviewRequest(state, { op: "handoff.result", handoffId: randomUUID(), claimId: randomUUID(), epoch: 1, resultSnapshotId: randomUUID(), body: "result" }, { snapshotId: originalSnapshot });
    expect(request.snapshotId).toBe(originalSnapshot);
    const cancelled = vi.fn();
    const client = f.client(f.human, async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(REVIEW_STORE_LIMITS.replayBytes + 1)); }, cancel: cancelled })));
    await expect(client.state()).rejects.toMatchObject({ code: "invalid_response" });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
