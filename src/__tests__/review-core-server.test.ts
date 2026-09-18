// @vitest-environment node
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewAuthority } from "../lib/review-authority.js";
import { ReviewCore } from "../lib/review-core.js";
import { ReviewStore } from "../lib/review-store.js";
import { withLegacyWriteLease } from "../lib/legacy-write-lease.js";

const cleanup: Array<() => Promise<unknown>> = [];

const testState = vi.hoisted(() => ({
  home: "",
  repo: "",
  storage: "",
  serve: vi.fn(),
}));

vi.mock("@hono/node-server", () => ({ serve: testState.serve }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => testState.home };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: () => ({ close: vi.fn() }) };
});
vi.mock("../lib/git.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/git.js")>();
  return { ...actual, getRepoRoot: () => testState.repo, getProjectStorageDir: () => testState.storage };
});

function fakeServer(startupError?: Error) {
  const nodeServer = new EventEmitter() as EventEmitter & {
    close: (callback: (error?: Error) => void) => void;
    closeAllConnections?: () => void;
  };
  nodeServer.close = (callback) => callback();
  nodeServer.closeAllConnections = vi.fn();
  queueMicrotask(() => startupError ? nodeServer.emit("error", startupError) : testState.serve.mock.calls.at(-1)?.[1]({ port: 43123 }));
  return nodeServer;
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "diffing-server-lifecycle-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  testState.home = join(root, "home");
  testState.repo = join(root, "repo");
  testState.storage = join(root, "storage");
  await Promise.all([mkdir(testState.home, { recursive: true }), mkdir(testState.repo), mkdir(testState.storage)]);
  const clientDir = join(root, "client");
  await mkdir(clientDir);
  await writeFile(join(clientDir, "index.html"), "<!doctype html><html><body>Review</body></html>");
  const authority = new ReviewAuthority();
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const sources = { capture: async (): Promise<never> => { throw new Error("Unexpected source capture"); }, get: () => undefined };
  return { root, clientDir, authority, identity, sources };
}

async function openCore(directory: string, setupState: Awaited<ReturnType<typeof setup>>) {
  const core = await ReviewCore.open(directory, setupState.identity, setupState.authority, setupState.sources, {
    openStore: (path) => ReviewStore.open(path),
  });
  cleanup.push(() => core.close());
  return core;
}

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  testState.serve.mockReset();
});

describe("startServer review core lifecycle", () => {
  it("preserves durable and busy stores during classic cleanup and keeps the immutable coordination record", async () => {
    const state = await setup();
    const base = join(testState.home, ".diffing");
    const durable = join(base, "durable");
    const classic = join(base, "classic");
    for (const directory of [durable, classic]) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "repo_path.txt"), join(state.root, "deleted-repo"));
      await writeFile(join(directory, "comments.json"), "[]");
    }
    await writeFile(join(durable, "review.initialized"), "preserve unknown recovery marker");
    await writeFile(join(classic, "unknown-backup"), "preserve");
    const { cleanupStaleProjects } = await import("../server.js");
    await withLegacyWriteLease(classic, async () => {
      await cleanupStaleProjects();
      expect(await readFile(join(classic, "comments.json"), "utf8")).toBe("[]");
      expect(await readFile(join(durable, "review.initialized"), "utf8")).toBe("preserve unknown recovery marker");
    });
    const owner = await readFile(join(classic, "legacy-write-lease", "owner.json"));
    await cleanupStaleProjects();
    await expect(stat(join(classic, "comments.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(classic, "legacy-write-lease", "owner.json"))).toEqual(owner);
    expect(await readFile(join(classic, "unknown-backup"), "utf8")).toBe("preserve");
    expect(await readFile(join(durable, "comments.json"), "utf8")).toBe("[]");
  });
  it("awaits a factory before serving and releases its core ownership on close", async () => {
    const state = await setup();
    const directory = join(state.root, "factory-review");
    let resolveFactory!: (core: ReviewCore) => void;
    const factoryReady = new Promise<ReviewCore>((resolve) => { resolveFactory = resolve; });
    let entered!: () => void;
    const factoryEntered = new Promise<void>((resolve) => { entered = resolve; });
    testState.serve.mockImplementation(() => fakeServer());
    const { startServer } = await import("../server.js");
    const starting = startServer({ port: 0, host: "127.0.0.1", clientDir: state.clientDir, security: { bindHost: "127.0.0.1", authToken: null, insecureNoAuth: true }, reviewCore: async () => { entered(); return factoryReady; } });
    await factoryEntered;
    expect(testState.serve).not.toHaveBeenCalled();
    resolveFactory(await openCore(directory, state));
    const server = await starting;
    expect(testState.serve).toHaveBeenCalledTimes(1);
    await expect(ReviewStore.open(directory)).rejects.toMatchObject({ code: "owner_busy" });
    await server.close!();
    const reopened = await ReviewStore.open(directory);
    await reopened.close();
  });

  it("releases a factory-created core when startup fails to bind", async () => {
    const state = await setup();
    const directory = join(state.root, "bind-failure-review");
    const core = await openCore(directory, state);
    const startupError = Object.assign(new Error("address in use"), { code: "EADDRINUSE" });
    testState.serve.mockImplementation(() => fakeServer(startupError));
    const { startServer } = await import("../server.js");
    await expect(startServer({ port: 43123, host: "127.0.0.1", clientDir: state.clientDir, security: { bindHost: "127.0.0.1", authToken: null, insecureNoAuth: true }, reviewCore: async () => core })).rejects.toMatchObject({ code: "EADDRINUSE" });
    const reopened = await ReviewStore.open(directory);
    await reopened.close();
  });

  it("leaves supplied cores caller-owned and never serves when the factory rejects", async () => {
    const state = await setup();
    const directory = join(state.root, "caller-review");
    const core = await openCore(directory, state);
    testState.serve.mockImplementation(() => fakeServer());
    const { startServer } = await import("../server.js");
    const server = await startServer({ port: 0, host: "127.0.0.1", clientDir: state.clientDir, security: { bindHost: "127.0.0.1", authToken: null, insecureNoAuth: true }, reviewCore: core });
    await server.close!();
    await expect(ReviewStore.open(directory)).rejects.toMatchObject({ code: "owner_busy" });
    await core.close();
    const rejected = await startServer({ port: 0, host: "127.0.0.1", clientDir: state.clientDir, security: { bindHost: "127.0.0.1", authToken: null, insecureNoAuth: true }, reviewCore: async () => { throw new Error("factory rejected"); } }).catch((error) => error);
    expect(rejected).toMatchObject({ message: "factory rejected" });
    expect(testState.serve).toHaveBeenCalledTimes(1);
  });
});
