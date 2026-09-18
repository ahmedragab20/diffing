import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const script = fileURLToPath(new URL("./postinstall.mjs", import.meta.url));

// Observe effects even when the installer catches the boundary error.
const guard = `
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import child from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import workers from 'node:worker_threads';
function deny(name) { return function () {
  appendFileSync(process.env.INSTALL_EFFECT_LOG, name + '\\n');
  throw new Error('Unexpected installation effect: ' + name);
}; }
for (const name of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawn', 'spawnSync', 'fork']) child[name] = deny('child.' + name);
net.Socket.prototype.connect = deny('net.connect');
net.Server.prototype.listen = deny('net.listen');
for (const [name, module] of [['http', http], ['https', https]]) {
  module.request = deny(name + '.request');
  module.get = deny(name + '.get');
}
dgram.Socket.prototype.bind = deny('dgram.bind');
dgram.Socket.prototype.send = deny('dgram.send');
workers.Worker = deny('worker');
globalThis.fetch = deny('fetch');
syncBuiltinESMExports();
Object.defineProperty(process.stdout, 'isTTY', { value: process.env.INSTALL_TEST_TTY === '1' });
`;
const preload = `data:text/javascript,${encodeURIComponent(guard)}`;

async function snapshot(root) {
  const entries = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const info = await stat(path);
      const rel = relative(root, path);
      if (info.isDirectory()) {
        entries.push([rel, "directory", info.mode & 0o777]);
        await visit(path);
      } else {
        entries.push([rel, "file", info.mode & 0o777, (await readFile(path)).toString("base64")]);
      }
    }
  }
  await visit(root);
  return entries;
}

test("postinstall is an isolated no-op for install and upgrade workspaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "diffing-postinstall-"));
  try {
    const home = join(root, "home");
    const repo = join(root, "repo");
    await mkdir(join(home, ".config"), { recursive: true });
    await mkdir(join(repo, ".git", "hooks"), { recursive: true });
    await mkdir(join(repo, ".github", "workflows"), { recursive: true });
    await writeFile(join(repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
    await writeFile(join(repo, ".github", "workflows", "ci.yml"), "name: ci\n");
    await writeFile(join(repo, "SECURITY.md"), "policy\n");
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "fixture", scripts: { postinstall: "sentinel" } }));
    const native = join(repo, "native-helper");
    await writeFile(native, "binary-placeholder");
    await chmod(native, 0o644);
    const effects = join(root, "effects.log");
    const env = { ...process.env, HOME: home, USERPROFILE: home, INSTALL_EFFECT_LOG: effects, npm_config_ignore_scripts: "", npm_config_user_agent: "isolated-test" };
    for (const key of ["CI", "CONTINUOUS_INTEGRATION", "BUILD_NUMBER", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "JENKINS_URL"]) delete env[key];
    // Positive controls ensure this observes named ESM imports and caught failures.
    await run(process.execPath, ["--import", preload, "--input-type=module", "--eval", "import { spawn } from 'node:child_process'; try { spawn('forbidden'); } catch {} try { await fetch('https://example.invalid'); } catch {}"], { cwd: repo, env });
    assert.equal(await readFile(effects, "utf8"), "child.spawn\nfetch\n");
    await rm(effects);
    const before = await snapshot(root);
    for (const scenario of [{ CI: "1", INSTALL_TEST_TTY: "1" }, { INSTALL_TEST_TTY: "0" }, { INSTALL_TEST_TTY: "1" }]) {
      // Repeating the lifecycle models installation and a subsequent upgrade.
      for (let iteration = 0; iteration < 2; iteration++) {
        const result = await run(process.execPath, ["--import", preload, script], { cwd: repo, env: { ...env, ...scenario } });
        assert.equal(result.stderr, "");
        if (scenario.CI || scenario.INSTALL_TEST_TTY === "0") assert.equal(result.stdout, "");
        else assert.match(result.stdout, /diffing/);
        await assert.rejects(readFile(effects), { code: "ENOENT" });
      }
    }
    assert.deepEqual(await snapshot(root), before);
    if (process.platform !== "win32") assert.equal((await stat(native)).mode & 0o777, 0o644);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
