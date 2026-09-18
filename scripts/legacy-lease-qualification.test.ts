import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { withLegacyWriteLease } from "../src/lib/legacy-write-lease.js";

function discoverRustTestBinary(): string {
  const output = execFileSync("cargo", ["test", "--locked", "-p", "diffing-core", "--lib", "--no-run", "--message-format=json"], { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  for (const line of output.split("\n").filter(Boolean)) {
    const artifact = JSON.parse(line);
    if (artifact.reason === "compiler-artifact" && artifact.target?.name === "diffing_core" && artifact.profile?.test && typeof artifact.executable === "string") return artifact.executable;
  }
  throw new Error("Cargo did not return the core test executable");
}
const rustTestBinary = process.env.DIFFING_CORE_TEST_BIN ?? discoverRustTestBinary();
type Child = ChildProcessByStdio<null, Readable, Readable>;
const childFilter = "legacy_write_lease::tests::process_child";
const sourceModule = pathToFileURL(join(process.cwd(), "src/lib/comments.ts")).href;
const directories: string[] = [];

function waitForLine(child: Child, expected: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timed out waiting for ${expected}; output=${output}`)); }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.split(/\r?\n/).some((line) => line.trim() === expected)) { cleanup(); resolve(expected); }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => { cleanup(); reject(new Error(`child exited before ${expected}: code=${code} signal=${signal} output=${output}`)); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); child.stdout.off("data", onData); child.off("close", onExit); child.off("error", onError); };
    child.stdout.on("data", onData);
    child.once("close", onExit);
    child.once("error", onError);
    child.stderr.resume();
  });
}

function waitForExit(child: Child, timeoutMs = 5000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error("timed out waiting for child exit")); }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => { cleanup(); resolve({ code, signal }); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); child.off("exit", onExit); child.off("close", onClose); child.off("error", onError); };
    const onClose = () => { cleanup(); resolve({ code: child.exitCode, signal: child.signalCode }); };
    child.once("exit", onExit);
    child.once("close", onClose);
    child.once("error", onError);
    child.stderr.resume();
  });
}

function rustChild(directory: string, probe = false) {
  return spawn(rustTestBinary, [childFilter, "--exact", "--nocapture"], {
    cwd: process.cwd(),
    env: { ...process.env, DIFFING_LEGACY_LEASE_CHILD: directory, ...(probe ? { DIFFING_LEGACY_LEASE_PROBE: "1" } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopChild(child: Child) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  try { await waitForExit(child); } catch { if (child.exitCode === null) child.kill("SIGKILL"); await waitForExit(child); }
}

async function freshDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "diffing-cross-language-lease-"));
  directories.push(directory);
  return directory;
}

test.afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("TS-held lease blocks Rust probe, then Rust acquires after release", async () => {
  const directory = await freshDirectory();
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>((resolve) => { ready = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const owner = withLegacyWriteLease(directory, async () => { ready(); await released; }, 0);
  await held;
  const ownerPath = join(directory, "legacy-write-lease", "owner.json");
  const before = await readFile(ownerPath);
  const blocked = rustChild(directory, true);
  try {
    await waitForLine(blocked, "LEGACY_BUSY");
    assert.equal((await waitForExit(blocked)).code, 0);
    release();
    await owner;
    const acquired = rustChild(directory, true);
    try { await waitForLine(acquired, "LEGACY_ACQUIRED"); assert.equal((await waitForExit(acquired)).code, 0); }
    finally { if (acquired.exitCode === null) await stopChild(acquired); }
    assert.deepEqual(await readFile(ownerPath), before);
  } finally { if (blocked.exitCode === null) await stopChild(blocked); release(); await owner.catch(() => {}); }
});

test("Rust-held lease blocks TS, then process death releases the unchanged owner record", async () => {
  const directory = await freshDirectory();
  const held = rustChild(directory);
  try {
    await waitForLine(held, "LEGACY_READY");
    const ownerPath = join(directory, "legacy-write-lease", "owner.json");
    const before = await readFile(ownerPath);
    await assert.rejects(() => withLegacyWriteLease(directory, async () => "blocked", 0), { code: "legacy_store_busy" });
    held.kill("SIGKILL");
    const exit = await waitForExit(held);
    assert.ok((exit.code !== null && exit.code !== 0) || exit.signal === "SIGKILL");
    await expectReacquire(directory);
    assert.deepEqual(await readFile(ownerPath), before);
  } finally { if (held.exitCode === null) await stopChild(held); }
});

async function expectReacquire(directory: string) {
  await assert.doesNotReject(() => withLegacyWriteLease(directory, async () => "reacquired", 0));
}

test("two TS child writers preserve distinct comments in one store", async () => {
  const directory = await freshDirectory();
  const childCode = `const { FileCommentStore } = await import(${JSON.stringify(sourceModule)}); await new FileCommentStore(process.env.DIFFING_STORE).add({ id: process.env.DIFFING_COMMENT_ID, filePath: "src/example.ts", side: "additions", lineNumber: 1, lineContent: "added", body: process.env.DIFFING_COMMENT_ID, status: "open", createdAt: 1, replies: [] });`;
  const spawnWriter = (id: string) => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childCode], { cwd: process.cwd(), env: { ...process.env, DIFFING_STORE: directory, DIFFING_COMMENT_ID: id }, stdio: ["ignore", "pipe", "pipe"] });
  const first = spawnWriter("child-first");
  const second = spawnWriter("child-second");
  try {
    const [a, b] = await Promise.all([waitForExit(first), waitForExit(second)]);
    assert.equal(a.code, 0);
    assert.equal(b.code, 0);
    const { FileCommentStore } = await import("../src/lib/comments.js");
    const comments = await new FileCommentStore(directory).getAll();
    assert.deepEqual(comments.map(({ id }) => id).sort(), ["child-first", "child-second"]);
  } finally {
    if (first.exitCode === null) await stopChild(first);
    if (second.exitCode === null) await stopChild(second);
  }
});
