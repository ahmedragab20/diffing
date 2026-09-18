// Real Git/helper/core integration. Tests run serially because Git collectors use cwd.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { DEFAULTS, type DiffOptions } from "../src/lib/diff-options.js";
import { executeDiffWithMeta } from "../src/lib/diff-engine.js";
import { _resetRepoRootCache, getCommitSeriesSummary } from "../src/lib/git.js";
import { captureInspection, readInspectionIdentity } from "../src/lib/inspect-capture.js";
import { AgentDiffIndexCache } from "../src/lib/agent-diff-index.js";
import { createSourceAnchor, assessSourceAnchor } from "../src/lib/source-anchor.js";
import { ReviewAuthority } from "../src/lib/review-authority.js";
import { ReviewCore } from "../src/lib/review-core.js";
import { prepareReviewRequest } from "../src/lib/review-client.js";
import type { ReviewCommand } from "../src/lib/review-core-contract.js";
import { InMemoryCommentStore } from "../src/lib/comments.js";
import { InMemoryPlanStore } from "../src/lib/plans.js";
import { InMemoryPrSessionStore, type PrSession } from "../src/lib/pr-session.js";
import type { CapturedFilesPage } from "../src/lib/file-inspect-snapshots.js";
import { MAX_NATIVE_FILE_BYTES } from "../src/lib/native-fs.js";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function fixture(t: TestContext) {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "diffing-source-qualification-"));
  const repo = join(directory, "repo");
  const home = join(directory, "home");
  const originalHome = process.env.HOME;
  const originalProfile = process.env.USERPROFILE;
  t.after(async () => {
    _resetRepoRootCache();
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(repo);
  await mkdir(home);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "core.hooksPath=", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "user.name=Source Test", "-c", "user.email=source@example.invalid", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" } }).trim();
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "tracked.txt"), "base\n");
  git("add", "."); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  process.chdir(repo);
  _resetRepoRootCache();
  const capture = async (options: Partial<DiffOptions> = {}) => {
    const opts = { ...DEFAULTS, includeUntracked: false, ...options };
    const captured = await captureInspection(opts, async () => {
      const result = await executeDiffWithMeta(opts);
      return { patch: result.patch, complete: result.complete, layers: result.layers, ...(result.omittedPaths ? { omittedPaths: result.omittedPaths } : {}) };
    }, () => readInspectionIdentity(repo, opts));
    assert.equal(captured.manifest.sourceDigest, sha256(captured.patch));
    assert.deepEqual(captured.manifest.options, opts);
    assert.equal(captured.manifest.scopeDigest, sha256(JSON.stringify(opts)));
    assert.equal(captured.manifest.complete, captured.complete);
    const index = new AgentDiffIndexCache().getOrBuild(captured.patch, captured.complete, captured.omittedPaths, captured.manifest);
    assert.equal(index.files.length, captured.manifest.layers.reduce((n, layer) => n + layer.fileCount, 0));
    return { ...captured, index };
  };
  return { directory, repo, git, base, capture };
}

test("actual working, staged, untracked and range captures bind bytes to ordered source layers", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repo, "tracked.txt"), "staged\n");
  f.git("add", "tracked.txt");
  await writeFile(join(f.repo, "tracked.txt"), "working\n");
  await writeFile(join(f.repo, "new.txt"), "untracked\n");
  const working = await f.capture();
  assert.match(working.patch, /-staged\n\+working/);
  assert.deepEqual(working.manifest.layers.map((layer) => layer.kind), ["working"]);
  const staged = await f.capture({ staged: true, pathspecs: ["tracked.txt"] });
  assert.match(staged.patch, /-base\n\+staged/);
  assert.deepEqual(staged.manifest.layers.map((layer) => layer.kind), ["staged"]);
  const combined = await f.capture({ staged: true, includeUntracked: true });
  assert.deepEqual(combined.manifest.layers.map(({ kind, firstFile, fileCount }) => ({ kind, firstFile, fileCount })), [
    { kind: "working", firstFile: 0, fileCount: 1 }, { kind: "staged", firstFile: 1, fileCount: 1 }, { kind: "untracked", firstFile: 2, fileCount: 1 },
  ]);
  const anchors = combined.index.files.map((_, i) => createSourceAnchor(combined.index, combined.manifest.snapshotId, i));
  assert.notEqual(anchors[0].layer.id, anchors[1].layer.id);
  assert.notEqual(anchors[0].file.contentDigest, anchors[1].file.contentDigest);
  assert.equal(anchors[2].file.newPath, "new.txt");
  f.git("commit", "-qm", "staged commit");
  const head = f.git("rev-parse", "HEAD");
  const range = await f.capture({ revisions: [`${f.base}..${head}`] });
  assert.match(range.patch, /-base\n\+staged/);
  assert.deepEqual(range.manifest.resolvedRevisions, [head, `^${f.base}`]);
  assert.deepEqual(range.manifest.layers.map((layer) => layer.kind), ["revision"]);
  assert.equal(range.complete, true);
});

test("actual show and commit-series captures retain repeated paths and immutable revision parents", async (t) => {
  const f = await fixture(t);
  const commits: string[] = [];
  for (const text of ["second", "third"]) {
    await writeFile(join(f.repo, "tracked.txt"), `${text}\n`);
    f.git("add", "tracked.txt"); f.git("commit", "-qm", text);
    commits.push(f.git("rev-parse", "HEAD"));
  }
  const single = await f.capture({ showMode: true, showRevspecs: [commits[1]] });
  assert.deepEqual(single.manifest.layers.map(({ kind, revision, parents }) => ({ kind, revision, parents })), [{ kind: "commit", revision: commits[1], parents: [commits[0]] }]);
  const series = await f.capture({ showMode: true, showRevspecs: [`${f.base}..${commits[1]}`] });
  assert.deepEqual(series.manifest.layers.map(({ revision, parents, firstFile, fileCount }) => ({ revision, parents, firstFile, fileCount })), [
    { revision: commits[0], parents: [f.base], firstFile: 0, fileCount: 1 }, { revision: commits[1], parents: [commits[0]], firstFile: 1, fileCount: 1 },
  ]);
  assert.deepEqual(series.index.files.map((file) => file.newPath), ["tracked.txt", "tracked.txt"]);
  const anchors = series.index.files.map((_, i) => createSourceAnchor(series.index, series.manifest.snapshotId, i));
  assert.deepEqual(anchors.map((anchor) => anchor.layer.ordinal), [0, 1]);
  assert.notEqual(anchors[0].layer.id, anchors[1].layer.id);
  assert.equal(assessSourceAnchor(anchors[0], series.index).status, "current");
  assert.equal(assessSourceAnchor(anchors[1], series.index).status, "current");
  const summary = await getCommitSeriesSummary([`${f.base}..${commits[1]}`]);
  assert.deepEqual(summary.subjects, ["second", "third"]);
});

test("external edit, stage, commit and rebase remain possible while the durable review is closed", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repo, "tracked.txt"), "reviewed\n");
  const initial = await f.capture();
  const authority = new ReviewAuthority();
  const identity = { repositoryId: initial.manifest.repositoryId, workspaceId: initial.manifest.workspaceId, reviewId: randomUUID() };
  const token = authority.issue(identity, { id: "reviewer", kind: "human" }, ["read", "capture", "comment", "decide"]);
  const retained = new Map<string, typeof initial.index>();
  const sources = { capture: async () => { const captured = await f.capture(); retained.set(captured.manifest.snapshotId, captured.index); return captured.index; }, get: (id: string) => retained.get(id) };
  let core = await ReviewCore.open(join(f.directory, "review"), identity, authority, sources);
  t.after(() => core.close());
  const execute = (command: ReviewCommand) => core.execute(token, prepareReviewRequest(core.state(token), command));
  await execute({ op: "capture" });
  await execute({ op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "original concern" });
  const original = core.state(token).comments[0].sourceAnchor!;
  const config = await readFile(join(f.repo, ".git", "config"));
  await core.close(); retained.clear();
  await writeFile(join(f.repo, "tracked.txt"), "external edit\n");
  const edited = await f.capture();
  assert.deepEqual(assessSourceAnchor(original, edited.index), { status: "stale", reason: "source_changed" });
  f.git("add", "tracked.txt");
  const staged = await f.capture();
  assert.deepEqual(assessSourceAnchor(original, staged.index), { status: "stale", reason: "source_missing" });
  f.git("commit", "-qm", "external commit");
  const feature = f.git("rev-parse", "HEAD");
  f.git("switch", "-q", "-c", "upstream", f.base);
  await writeFile(join(f.repo, "other.txt"), "independent upstream change\n");
  f.git("add", "other.txt"); f.git("commit", "-qm", "upstream");
  const upstream = f.git("rev-parse", "HEAD");
  f.git("switch", "-q", "main"); f.git("rebase", "--onto", upstream, f.base);
  assert.notEqual(f.git("rev-parse", "HEAD"), feature);
  assert.deepEqual(await readFile(join(f.repo, ".git", "config")), config);
  core = await ReviewCore.open(join(f.directory, "review"), identity, authority, sources);
  assert.equal(core.state(token).commentFreshness[0].status, "unverified");
  await execute({ op: "capture" });
  assert.deepEqual(core.state(token).commentFreshness, [{ id: core.state(token).comments[0].id, status: "stale", reason: "revision_changed" }]);
  assert.deepEqual(core.state(token).comments[0].sourceAnchor, original);
  assert.equal(core.state(token).decisions.length, 0);
});

test("PR artifacts retain their own revisions and explicit omission state across cached updates", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repo, "tracked.txt"), "PR change\n");
  await writeFile(join(f.repo, "other.txt"), "second PR file\n");
  f.git("add", "."); f.git("commit", "-qm", "PR head");
  const head = f.git("rev-parse", "HEAD");
  const patch = execFileSync("git", ["-C", f.repo, "diff", "--no-ext-diff", "--no-textconv", "--no-color", f.base, head], { encoding: "utf8" });
  const artifact: PrSession = {
    ref: "1", owner: "fixture", repo: "review", pullNumber: 1, headSha: head, baseSha: f.base, mergeBaseSha: f.base,
    title: "Offline PR artifact", url: "https://github.com/fixture/review/pull/1", author: null,
    additions: 2, deletions: 1, changedFiles: 3, diff: patch, comments: [], existingComments: [],
    diffCompleteness: { listedFiles: 3, omittedPatches: 1 },
  };
  const store = new InMemoryPrSessionStore();
  await store.set(artifact);
  // Subscription delivery is outside this artifact-read fixture. Keep it from
  // retaining filesystem handles after the temporary repository is removed.
  const watch = t.mock.method(fs, "watch", () => Object.assign(new EventEmitter(), {
    close() {}, ref() { return this; }, unref() { return this; },
  }));
  syncBuiltinESMExports();
  t.after(() => { watch.mock.restore(); syncBuiltinESMExports(); });
  // Load server settings only after the fixture has selected its isolated home.
  const { createApp } = await import("../src/server.js");
  const app = createApp(f.directory, { ...DEFAULTS }, new InMemoryCommentStore(), new InMemoryPlanStore(), store, true);
  const firstResponse = await app.request("/api/diff/files?limit=1");
  assert.equal(firstResponse.status, 200);
  const first: CapturedFilesPage = await firstResponse.json();
  assert.ok(first.manifest);
  assert.equal(first.complete, false);
  assert.equal(first.manifest.complete, false);
  assert.deepEqual(first.manifest.layers.map(({ kind, revision, parents, fileCount }) => ({ kind, revision, parents, fileCount })), [{ kind: "pr", revision: head, parents: [f.base], fileCount: 2 }]);
  assert.equal(first.manifest.sourceDigest, sha256(patch));
  assert.ok(first.manifest.provenance);
  assert.equal(first.manifest.provenance.headSha, head);
  assert.equal(first.manifest.provenance.pullNumber, 1);
  assert.ok(first.nextContinuation);
  await store.update({ headSha: "f".repeat(40), diff: "", diffCompleteness: { listedFiles: 0, omittedPatches: 0 } });
  const historical: CapturedFilesPage = await (await app.request(`/api/diff/files?continuation=${encodeURIComponent(first.nextContinuation)}`)).json();
  assert.equal(historical.snapshotId, first.snapshotId);
  assert.equal(historical.files[0].index, 1);
  assert.equal(historical.complete, false);
  assert.deepEqual(historical.manifest, first.manifest);
  const refreshed: CapturedFilesPage = await (await app.request("/api/diff/files?limit=1")).json();
  assert.ok(refreshed.manifest);
  assert.notEqual(refreshed.snapshotId, first.snapshotId);
  assert.equal(refreshed.complete, true);
  assert.deepEqual(refreshed.files, []);
  assert.equal(refreshed.manifest.provenance?.headSha, "f".repeat(40));
});

test("a real rename invalidates the old path anchor and retains staged mode/blob metadata", async (t) => {
  const f = await fixture(t);
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i}\n`);
  await writeFile(join(f.repo, "tracked.txt"), lines.join(""));
  f.git("add", "tracked.txt"); f.git("commit", "-qm", "rename base");
  lines[25] = "reviewed change\n";
  await writeFile(join(f.repo, "tracked.txt"), lines.join(""));
  f.git("add", "tracked.txt");
  const options = { staged: true, pathspecs: ["."] };
  const before = await f.capture(options);
  const anchor = createSourceAnchor(before.index, before.manifest.snapshotId, 0, { side: "additions", start: 26, end: 26 });
  f.git("mv", "tracked.txt", "renamed.txt");
  f.git("update-index", "--chmod=+x", "renamed.txt");
  const after = await f.capture(options);
  assert.equal(after.index.files.length, 1);
  const file = after.index.files[0];
  assert.equal(file.oldPath, "tracked.txt");
  assert.equal(file.newPath, "renamed.txt");
  assert.equal(file.kind, "renamed");
  assert.equal(file.metadata.oldMode, "100644");
  assert.equal(file.metadata.newMode, "100755");
  assert.ok(file.metadata.oldBlob);
  assert.ok(file.metadata.newBlob);
  assert.notEqual(file.metadata.oldBlob, file.metadata.newBlob);
  assert.deepEqual(assessSourceAnchor(anchor, after.index), { status: "stale", reason: "source_missing" });
  assert.equal(before.index.files[0].newPath, "tracked.txt");
});

test("unavailable untracked content is explicitly incomplete instead of a successful empty diff", async (t) => {
  const f = await fixture(t);
  const large = join(f.repo, "oversized.bin");
  await writeFile(large, "");
  await truncate(large, MAX_NATIVE_FILE_BYTES + 1);
  const omitted = await f.capture({ includeUntracked: true });
  assert.equal(omitted.complete, false);
  assert.equal(omitted.manifest.complete, false);
  assert.deepEqual(omitted.omittedPaths, ["oversized.bin"]);
  assert.deepEqual(omitted.index.files, []);
  await rm(large);
  const empty = await f.capture({ includeUntracked: true });
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.index.files, []);
});

test("a failed real Git index read rejects capture without inventing an empty source", async (t) => {
  const f = await fixture(t);
  const indexPath = join(f.repo, ".git", "index");
  const index = await readFile(indexPath);
  await writeFile(indexPath, "invalid Git index");
  try { await assert.rejects(f.capture(), { code: "source_unavailable" }); }
  finally { await writeFile(indexPath, index); }
  assert.equal((await f.capture()).complete, true);
});
