import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ReviewClient, prepareReviewRequest } from "../src/lib/review-client.js";
import { SESSION_TOKEN_HEADER } from "../src/lib/session-token.js";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url));
const roots: string[] = [];
type Child = ChildProcessByStdio<null, Readable, Readable>;
const children: Array<{ child: Child; exited: Promise<number | null> }> = [];

function launch(repo: string, home: string, adopt = false, port?: number) {
  // IPC is only the test harness's portable signal delivery. The real CLI
  // receives SIGTERM, including on Windows where kill() bypasses JS handlers.
  const code = `process.on("message", () => process.emit("SIGTERM")); process.argv = ${JSON.stringify([process.execPath, cli, "review-core", "serve", ...(adopt ? ["--adopt"] : []), ...(port === undefined ? [] : ["--port", String(port)])])}; await import(${JSON.stringify(new URL("../src/cli.ts", import.meta.url).href)});`;
  const child = spawn(process.execPath, ["--import", tsx, "--input-type=module", "-e", code], { cwd: repo, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ["ignore", "pipe", "pipe", "ipc"] }) as Child;
  const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  void exited.catch(() => {});
  let output = "";
  let diagnostics = "";
  child.stderr.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4096).replace(/[A-Za-z0-9_-]{43,}/g, "[redacted]"); });
  const ready = new Promise<{ origin: string; identity: import("../src/lib/review-identity.js").ReviewIdentity; humanConnectionFile: string; agentConnectionFile: string }>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 64 * 1024) { reject(new Error("Unexpected oversized launch output")); child.kill(); return; }
      for (const line of output.split(/\r?\n/)) {
        try { const value = JSON.parse(line); if (value && typeof value.origin === "string" && value.identity) resolve(value); } catch { /* incomplete line */ }
      }
    });
    exited.then((code) => reject(new Error(`CLI exited before readiness (${code}): ${diagnostics}`)), reject);
  });
  void ready.catch(() => {});
  child.stderr.resume();
  const handle = { child, exited, ready, output: () => output, diagnostics: () => diagnostics };
  children.push(handle);
  return handle;
}

async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("CLI condition timeout")), 15_000); })]); }
  finally { clearTimeout(timer); }
}

async function stop(handle: ReturnType<typeof launch>) {
  if (handle.child.exitCode === null && handle.child.signalCode === null) handle.child.send("stop");
  assert.equal(await bounded(handle.exited), 0);
}

async function setupRepo() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "diffing-review-launch-")));
  roots.push(root);
  const home = join(root, "home");
  const repo = join(root, "repo");
  await mkdir(home);
  await mkdir(repo);
  await writeFile(join(repo, "example.ts"), "export const value = 1;\n");
  await new Promise<void>((resolve, reject) => execFile("git", ["init", "-q"], { cwd: repo }, (error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => execFile("git", ["add", "."], { cwd: repo }, (error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => execFile("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "initial"], { cwd: repo }, (error) => error ? reject(error) : resolve()));
  await writeFile(join(repo, "example.ts"), "export const value = 2;\n");
  // Use the same Git spelling as production (not native Windows separators).
  const gitRoot = await new Promise<string>((resolve, reject) => execFile("git", ["rev-parse", "--show-toplevel"], { cwd: repo, encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
  const storage = join(home, ".diffing", `${basename(gitRoot)}-${createHash("sha256").update(gitRoot).digest("hex").slice(0, 8)}`);
  return { root, home, repo: gitRoot, storage };
}

async function connection(path: string) { return JSON.parse(await readFile(path, "utf8")); }

test.afterEach(async () => {
  for (const { child, exited } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await bounded(exited).catch(() => {});
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("CLI durable review launch enforces adoption, credentials, lifecycle, and restart identity", async () => {
  const { home, repo, storage } = await setupRepo();
  const first = launch(repo, home);
  assert.notEqual(await bounded(first.exited), 0);
  assert.match(first.diagnostics(), /First adoption requires --adopt/);
  await assert.rejects(stat(join(storage, "review.sqlite")), { code: "ENOENT" });

  const server = launch(repo, home, true);
  const launched = await bounded(server.ready);
  const humanFile = await connection(launched.humanConnectionFile);
  const agentFile = await connection(launched.agentConnectionFile);
  const competing = launch(repo, home);
  assert.notEqual(await bounded(competing.exited), 0);
  assert.match(competing.diagnostics(), /owns this workspace/);
  assert.notEqual(humanFile.credential, agentFile.credential);
  assert.equal(server.output().includes(humanFile.credential), false);
  assert.equal(server.output().includes(agentFile.credential), false);
  if (process.platform !== "win32") {
    assert.equal((await stat(launched.humanConnectionFile)).mode & 0o777, 0o600);
    assert.equal((await stat(launched.agentConnectionFile)).mode & 0o777, 0o600);
  }
  const agent = new ReviewClient({ origin: launched.origin, credential: agentFile.credential, identity: launched.identity, headers: agentFile.headers });
  const human = new ReviewClient({ origin: launched.origin, credential: humanFile.credential, identity: launched.identity, headers: humanFile.headers });
  await agent.execute(prepareReviewRequest(await agent.state(), { op: "capture" }));
  const agentState = await agent.state();
  const request = prepareReviewRequest(agentState, { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "durable" });
  const added = await agent.execute(request);
  await assert.rejects(async () => agent.execute(prepareReviewRequest(await agent.state(), { op: "decision.record", decision: "approved", rationale: "agent cannot decide" })), { code: "forbidden" });
  const humanState = await human.state();
  assert.equal(humanState.comments.some((comment) => comment.id === added.result.id), true);
  await human.execute(prepareReviewRequest(humanState, { op: "decision.record", decision: "approved", rationale: "human decision" }));
  const ordinary = await fetch(`${launched.origin}/api/review-core/state`, { headers: { [SESSION_TOKEN_HEADER]: humanFile.headers[SESSION_TOKEN_HEADER] } });
  assert.equal(ordinary.status, 401);
  assert.deepEqual(await ordinary.json(), { code: "unauthenticated" });
  const blocked = await fetch(`${launched.origin}/api/edit-save`, { method: "POST", headers: { ...agentFile.headers, "Content-Type": "application/json" }, body: JSON.stringify({ filePath: "example.ts", content: "forbidden" }) });
  assert.equal(blocked.status, 409);
  assert.deepEqual(await blocked.json(), { code: "headless_review", recovery: "use_review_core_operations" });
  assert.equal(await readFile(join(repo, "example.ts"), "utf8"), "export const value = 2;\n");
  assert.equal((await fetch(launched.origin)).headers.get("content-type")?.startsWith("text/html") ?? false, false);
  await stop(server);
  assert.equal((await Promise.all([launched.humanConnectionFile, launched.agentConnectionFile].map(async (path) => { try { await readFile(path); return true; } catch { return false; } }))).some(Boolean), false);

  const restarted = launch(repo, home, false);
  const relaunched = await bounded(restarted.ready);
  assert.equal(relaunched.identity.reviewId, launched.identity.reviewId);
  assert.notEqual(relaunched.humanConnectionFile, launched.humanConnectionFile);
  const newHumanFile = await connection(relaunched.humanConnectionFile);
  const oldCredential = new ReviewClient({ origin: relaunched.origin, credential: humanFile.credential, identity: launched.identity, headers: newHumanFile.headers });
  await assert.rejects(() => oldCredential.state(), { code: "unauthenticated" });
  const currentHuman = new ReviewClient({ origin: relaunched.origin, credential: newHumanFile.credential, identity: relaunched.identity, headers: newHumanFile.headers });
  const currentState = await currentHuman.state();
  assert.equal(currentState.decisions.length, 1);
  assert.equal(currentState.decisions[0].decision, "approved");
  assert.equal(currentState.comments[0].body, "durable");
  const newAgentFile = await connection(relaunched.agentConnectionFile);
  const currentAgent = new ReviewClient({ ...newAgentFile });
  assert.deepEqual(await currentAgent.execute(request), added);
  assert.equal((await currentAgent.state()).comments.length, 1);
  await stop(restarted);
});

test("failed bind releases both core and startup ownership so the committed migration can reopen", async () => {
  const { home, repo } = await setupRepo();
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => { occupied.once("error", reject); occupied.listen(0, "127.0.0.1", resolve); });
  try {
    const address = occupied.address();
    assert.ok(address && typeof address !== "string");
    const failed = launch(repo, home, true, address.port);
    assert.notEqual(await bounded(failed.exited), 0);
    assert.match(failed.diagnostics(), /EADDRINUSE|address already in use/);
    const restarted = launch(repo, home);
    const opened = await bounded(restarted.ready);
    const client = new ReviewClient(await connection(opened.agentConnectionFile));
    assert.equal((await client.state()).migrationPending, false);
    await stop(restarted);
  } finally { await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve())); }
});

test("a registered classic owner must stop before adoption creates a database", async () => {
  const { home, repo, storage } = await setupRepo();
  await mkdir(storage, { recursive: true });
  await writeFile(join(storage, "server.json"), JSON.stringify({ repoRoot: repo, pid: process.pid, port: 0, host: "127.0.0.1", startedAt: Date.now(), version: "fixture", mode: "web" }));
  const failed = launch(repo, home, true);
  assert.notEqual(await bounded(failed.exited), 0);
  assert.match(failed.diagnostics(), /Stop existing diffing sessions/);
  await assert.rejects(stat(join(storage, "review.sqlite")), { code: "ENOENT" });
});

test("malformed legacy plans block adoption and preserve source bytes without creating a database", async () => {
  const { home, repo, storage } = await setupRepo();
  await mkdir(storage, { recursive: true });
  const legacy = Buffer.from("{\n", "utf8");
  await writeFile(join(storage, "plans.json"), legacy);
  const server = launch(repo, home, true);
  assert.notEqual(await bounded(server.exited), 0);
  assert.match(server.diagnostics(), /JSON|property name/);
  assert.deepEqual(await readFile(join(storage, "plans.json")), legacy);
  await assert.rejects(stat(join(storage, "review.sqlite")), { code: "ENOENT" });
});
