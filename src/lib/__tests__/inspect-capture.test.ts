// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULTS } from "../diff-options.js";
import {
  captureInspection,
  readInspectionIdentity,
  type InspectionIdentity,
  type InspectionPatch,
} from "../inspect-capture.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" },
  );
}

function createRepo(commits = 1): string {
  const root = mkdtempSync(join(tmpdir(), "inspect-capture-"));
  tempRoots.push(root);
  git(root, "init", "--quiet");
  git(root, "-c", "user.email=tests@example.com", "-c", "user.name=Capture Tests", "config", "user.email", "tests@example.com");
  git(root, "-c", "user.email=tests@example.com", "-c", "user.name=Capture Tests", "config", "user.name", "Capture Tests");
  writeFileSync(join(root, "tracked.txt"), "one\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "--quiet", "-m", "initial");
  for (let i = 1; i < commits; i++) {
    writeFileSync(join(root, "tracked.txt"), `${i + 1}\n`);
    git(root, "add", "tracked.txt");
    git(root, "commit", "--quiet", "-m", `commit ${i + 1}`);
  }
  return root;
}

async function diffPatch(root: string): Promise<string> {
    return execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "diff", "--no-ext-diff", "--no-color"], {
      cwd: root,
      encoding: "utf8",
    });
}

function workingCollect(root: string, mutate?: () => void): () => Promise<InspectionPatch> {
  return async () => {
    const patch = await diffPatch(root);
    mutate?.();
    return { patch, complete: true, layers: [{ kind: "working", patch }] };
  };
}

function identity(root: string): () => Promise<InspectionIdentity> {
  return () => readInspectionIdentity(root, { ...DEFAULTS });
}

describe("inspect capture", () => {
  it("keeps repository identity stable while linked detached worktrees get distinct workspace identities", async () => {
    const root = createRepo();
    const linked = join(root, "linked");
    git(root, "worktree", "add", "--detach", "--quiet", linked, "HEAD");

    const main = await readInspectionIdentity(root, { ...DEFAULTS });
    const worktree = await readInspectionIdentity(linked, { ...DEFAULTS });

    expect(worktree.repositoryId).toBe(main.repositoryId);
    expect(worktree.workspaceId).not.toBe(main.workspaceId);
    expect(worktree.head).toBe(main.head);
  });

  it("resolves both revisions and reports null HEAD for an unborn branch", async () => {
    const root = createRepo(2);
    const revisions = await readInspectionIdentity(root, { ...DEFAULTS, revisions: ["HEAD~1", "HEAD"] });
    const hashes = git(root, "rev-parse", "HEAD~1", "HEAD").trim().split("\n");
    expect(revisions.resolvedRevisions).toEqual(hashes);
    expect(revisions.resolvedRevisions).toHaveLength(2);
    const range = await readInspectionIdentity(root, { ...DEFAULTS, revisions: ["HEAD~1..HEAD"] });
    expect(range.resolvedRevisions).toEqual([hashes[1], `^${hashes[0]}`]);

    const unborn = mkdtempSync(join(tmpdir(), "inspect-capture-unborn-"));
    tempRoots.push(unborn);
    git(unborn, "init", "--quiet");
    expect((await readInspectionIdentity(unborn, { ...DEFAULTS })).head).toBeNull();
  });

  it("retries after one mutation and returns an optimistic validated capture", async () => {
    const root = createRepo();
    let collections = 0;
    const collect = workingCollect(root, () => {
      collections++;
      if (collections === 1) writeFileSync(join(root, "tracked.txt"), "two\n");
    });
    const result = await captureInspection({ ...DEFAULTS }, collect, identity(root), { now: () => 123 });

    expect(collections).toBe(4);
    expect(result.patch).toContain("+two");
    expect(result.manifest).toMatchObject({ consistency: "optimistic-validated", capturedAt: 123, complete: true });
  });

  it("rejects continuous mutation after exactly three attempts and six collections", async () => {
    const root = createRepo();
    let collections = 0;
    const collect = workingCollect(root, () => {
      collections++;
      writeFileSync(join(root, "tracked.txt"), `${collections}\n`);
    });

    await expect(captureInspection({ ...DEFAULTS }, collect, identity(root))).rejects.toMatchObject({ code: "inconsistent_capture" });
    expect(collections).toBe(6);
  });

  it("rejects Git collection and identity failures as source unavailable", async () => {
    const root = createRepo();
    const sourceError = await captureInspection({ ...DEFAULTS }, async () => {
      throw new Error("git diff failed");
    }, identity(root)).catch((error) => error);
    expect(sourceError).toBeInstanceOf(Error);
    expect(sourceError).toMatchObject({ code: "source_unavailable" });
    expect(sourceError).not.toHaveProperty("manifest");

    const identityError = await captureInspection({ ...DEFAULTS }, async () => ({ patch: "", complete: true }), async () => {
      throw new Error("git probe failed");
    }).catch((error) => error);
    expect(identityError).toBeInstanceOf(Error);
    expect(identityError).toMatchObject({ code: "source_unavailable" });
    expect(identityError).not.toHaveProperty("manifest");
  });

  it("records distinct ordered manifest layers for an incomplete immutable commit series", async () => {
    const root = createRepo(2);
    const firstPatch = "diff --git a/tracked.txt b/tracked.txt\n--- a/tracked.txt\n+++ b/tracked.txt\n@@ -1 +1 @@\n-one\n+two\n";
    const secondPatch = "diff --git a/tracked.txt b/tracked.txt\n--- a/tracked.txt\n+++ b/tracked.txt\n@@ -1 +1 @@\n-two\n+three\n";
    const result = await captureInspection({ ...DEFAULTS }, async () => ({
      patch: [firstPatch, secondPatch].join("\n"),
      complete: false,
      layers: [
        { kind: "revision", revision: "rev-1", parents: ["parent-1"], patch: firstPatch },
        { kind: "revision", revision: "rev-2", parents: ["parent-2"], patch: secondPatch },
      ],
    }), identity(root));

    expect(result.manifest.complete).toBe(false);
    expect(result.manifest.layers).toMatchObject([
      { kind: "revision", revision: "rev-1", parents: ["parent-1"], firstFile: 0, fileCount: 1 },
      { kind: "revision", revision: "rev-2", parents: ["parent-2"], firstFile: 1, fileCount: 1 },
    ]);
    expect(result.manifest.layers[0].id).not.toBe(result.manifest.layers[1].id);
  });

  it.each([
    ["textconv", { textconv: true }],
    ["outputFile", { outputFile: "capture.patch" }],
    ["noPrefix", { noPrefix: true }],
  ] as const)("rejects unsupported %s options before collection", async (_name, override) => {
    const root = mkdtempSync(join(tmpdir(), "inspect-capture-unused-"));
    tempRoots.push(root);
    let collected = false;
    await expect(captureInspection({ ...DEFAULTS, ...override }, async () => {
      collected = true;
      return { patch: "", complete: true };
    }, identity(root))).rejects.toMatchObject({ code: "unsupported_capture" });
    expect(collected).toBe(false);
  });
});
