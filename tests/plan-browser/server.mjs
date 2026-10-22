// Real diffing backend on an isolated throwaway repo + storage root, plus a
// Vite dev server for the UI that proxies /api to it. Nothing touches
// ~/.diffing/<real repo> or the user's settings.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = join(homedir(), ".diffing", "plan-browser");
const repo = join(root, "repo");
const storage = join(root, "storage");
const config = join(root, "config");
rmSync(root, { recursive: true, force: true });
for (const dir of [repo, storage, config]) mkdirSync(dir, { recursive: true });
writeFileSync(join(repo, "README.md"), "# plan browser fixture\n");
// The backend refuses to start without a client bundle; Vite serves the real UI.
mkdirSync(join(repo, "dist", "client"), { recursive: true });
writeFileSync(join(repo, "dist", "client", "index.html"), "<!doctype html>\n");
writeFileSync(join(repo, ".gitignore"), "dist/\n");
const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
git("init", "-q");
git("-c", "user.email=e2e@diffing.test", "-c", "user.name=e2e", "add", ".");
git("-c", "user.email=e2e@diffing.test", "-c", "user.name=e2e", "commit", "-qm", "init");

const pkg = resolve(import.meta.dirname, "..", "..");
const env = { ...process.env, DIFFING_STORAGE_ROOT: storage, DIFFING_CONFIG_DIR: config };
const children = [
  spawn(process.execPath, [join(pkg, "node_modules/tsx/dist/cli.mjs"), join(pkg, "src/cli.ts"),
    "--web", "--no-open", "--new-session", "--insecure-no-auth", "--port", "4194"], { cwd: repo, env, stdio: "inherit" }),
  spawn(process.execPath, [join(pkg, "node_modules/vite/bin/vite.js"), "--config", "tests/plan-browser/vite.config.ts"],
    { cwd: pkg, env, stdio: "inherit" }),
];
const stop = () => { for (const child of children) child.kill(); };
process.on("SIGTERM", () => { stop(); process.exit(0); });
process.on("SIGINT", () => { stop(); process.exit(0); });
for (const child of children) child.once("exit", code => { stop(); process.exit(code ?? 1); });
