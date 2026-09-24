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
import { ReviewClient } from "../review-client.js";
import type { AgentDiffIndex } from "../agent-diff-index.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

const patchFor = (suffix = "new") => `diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+${suffix}\n`;

async function fixture(patch = patchFor()) {
  const directory = await mkdtemp(join(tmpdir(), "diffing-review-source-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority();
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "capture", "comment", "handoff", "decide"]);
  const indexes = new Map<string, AgentDiffIndex>();
  let collected = patch;
  const capture = vi.fn(async () => {
    const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch: collected, complete: true }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: null, indexDigest: "c".repeat(64), resolvedRevisions: [] }));
    const index = new AgentDiffIndexCache().getOrBuild(collected, true, undefined, captured.manifest);
    indexes.set(index.manifest!.snapshotId, index);
    return index;
  });
  const sources = { capture, get: (id: string) => indexes.get(id) };
  const core = await ReviewCore.open(directory, identity, authority, sources, { openStore: (path) => ReviewStore.open(path) });
  cleanup.push(() => core.close());
  const app = new Hono().route("/api/review-core", createReviewCoreApi(core));
  const headers = (token = human) => ({ [REVIEW_CREDENTIAL_HEADER]: token, "Content-Type": "application/json" });
  const captureSource = async () => {
    const result = await core.execute(human, { ...identity, version: 1, requestId: randomUUID(), expectedVersion: core.state(human).version, snapshotId: null, command: { op: "capture" } });
    return result.result.snapshotId;
  };
  const transport = vi.fn<typeof fetch>(async (input, init) => app.request(String(input), init));
  const client = new ReviewClient({ origin: "http://127.0.0.1:3000", credential: human, identity, fetch: transport });
  return { identity, human, core, app, headers, indexes, capture, setPatch: (value: string) => { collected = value; }, captureSource, transport, client };
}

describe("review source pages", () => {
  it("paginates files and rows with stable indexes and one retained capture", async () => {
    const f = await fixture("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-old\n+other\n");
    const snapshotId = await f.captureSource();
    const files: number[] = [];
    for (let offset = 0;;) {
      const response = await f.app.request(`/api/review-core/source?snapshotId=${snapshotId}&offset=${offset}&limit=1`, { headers: f.headers() });
      expect(response.status).toBe(200);
      const page = await response.json();
      expect(page.snapshotId).toBe(snapshotId);
      files.push(...page.entries.map((entry: { index: number }) => entry.index));
      if (page.next === null) break;
      offset = page.next;
    }
    expect(files).toEqual([0, 1]);
    const rows: number[] = [];
    for (let offset = 0;;) {
      const page = await (await f.app.request(`/api/review-core/source?snapshotId=${snapshotId}&fileIndex=0&offset=${offset}&limit=1`, { headers: f.headers() })).json();
      rows.push(...page.entries.map((entry: { index: number }) => entry.index));
      if (page.next === null) break;
      offset = page.next;
    }
    expect(rows).toEqual([0, 1, 2, 3]);
    expect(f.core.state(f.human).currentSnapshotId).toBe(snapshotId);
    expect(f.capture).toHaveBeenCalledOnce();
  });

  it("keeps the captured source immutable when the collector changes", async () => {
    const f = await fixture();
    const snapshotId = await f.captureSource();
    f.setPatch(patchFor("changed-after-capture"));
    const page = await (await f.app.request(`/api/review-core/source?snapshotId=${snapshotId}&fileIndex=0&limit=20`, { headers: f.headers() })).json();
    expect(JSON.stringify(page)).toContain("new");
    expect(JSON.stringify(page)).not.toContain("changed-after-capture");
    expect(f.capture).toHaveBeenCalledOnce();
  });

  it("distinguishes unknown, evicted, malformed, and duplicate source queries", async () => {
    const f = await fixture();
    const snapshotId = await f.captureSource();
    const unknown = await f.app.request(`/api/review-core/source?snapshotId=${randomUUID()}`, { headers: f.headers() });
    expect(unknown.status).toBe(404);
    f.indexes.delete(snapshotId);
    const expired = await f.app.request(`/api/review-core/source?snapshotId=${snapshotId}`, { headers: f.headers() });
    expect(expired.status).toBe(410);
    for (const query of [`snapshotId=${snapshotId}&limit=1&limit=2`, `snapshotId=${snapshotId}&offset=-1`, `snapshotId=${snapshotId}&fileIndex=nope`]) {
      const response = await f.app.request(`/api/review-core/source?${query}`, { headers: f.headers() });
      expect(response.status, query).toBe(400);
    }
  });

  it("omits oversized rows explicitly, advances next, and stays within the response limit", async () => {
    const f = await fixture(`diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+${"x".repeat(17_000)}\n@@ -2,0 +3 @@\n+tail\n`);
    const snapshotId = await f.captureSource();
    const response = await f.app.request(`/api/review-core/source?snapshotId=${snapshotId}&fileIndex=0&limit=3`, { headers: f.headers() });
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(128 * 1024);
    const page = JSON.parse(text);
    expect(page.entries.map((entry: { index: number }) => entry.index)).toEqual([0, 1, 2]);
    expect(page.next).toBe(3);
    const omittedResponse = await f.app.request(`/api/review-core/source?snapshotId=${snapshotId}&fileIndex=0&offset=${page.next}&limit=1`, { headers: f.headers() });
    const omitted = await omittedResponse.json();
    expect(omitted.entries).toContainEqual({ index: 3, omitted: "row_too_large" });
    expect(omitted.next).toBe(4);
  });
});

describe("ReviewClient source validation", () => {
  it.each(["snapshot", "fileIndex", "position", "next", "order"])("rejects a response with the wrong %s", async (kind) => {
    const f = await fixture();
    const snapshotId = await f.captureSource();
    const client = new ReviewClient({ origin: "http://127.0.0.1:3000", credential: f.human, identity: f.identity, fetch: async (input, init) => {
      const response = await f.transport(input, init);
      const page = await response.json();
      if (kind === "snapshot") page.snapshotId = randomUUID();
      if (kind === "fileIndex") page.fileIndex = 1;
      if (kind === "position") page.entries[0].index++;
      if (kind === "next") page.next = page.next === null ? 0 : page.next + 1;
      if (kind === "order" && page.entries.length > 1) [page.entries[0], page.entries[1]] = [page.entries[1], page.entries[0]];
      return Response.json(page);
    } });
    await expect(client.source({ snapshotId, fileIndex: 0, offset: 0, limit: 20 })).rejects.toMatchObject({ code: "invalid_response" });
  });
});
