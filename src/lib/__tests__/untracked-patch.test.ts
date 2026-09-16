// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const originalCwd = process.cwd();
let repo: string;

function git(args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (error) {
    const result = error as { status?: number; stdout?: string };
    if (result.status === 1) return result.stdout ?? "";
    throw error;
  }
}

function patchMetrics(patch: string) {
  const addedPayload = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
  return {
    hunkCount: (patch.match(/^@@ /gm) ?? []).length,
    addedCount: addedPayload.length,
    addedPayload,
    missingNewline: patch.includes("\\ No newline at end of file"),
  };
}

describe("untracked patch byte semantics against Git", () => {
  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "diffing-untracked-patch-"));
    git(["init", "-q"]);
    process.chdir(repo);
    const { _resetRepoRootCache } = await import("../git.js");
    _resetRepoRootCache();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    rmSync(repo, { recursive: true, force: true });
    const { _resetRepoRootCache } = await import("../git.js");
    _resetRepoRootCache();
  });

  it.each([
    ["lf", Buffer.from("one\ntwo\n")],
    ["crlf", Buffer.from("one\r\ntwo\r\n")],
    ["cr-only", Buffer.from("one\rtwo\r")],
    ["mixed", Buffer.from("one\r\ntwo\nthree\r\n")],
    ["missing-newline", Buffer.from("one\ntwo")],
    ["empty", Buffer.alloc(0)],
  ])("matches Git's added payload and metadata for %s content", async (_name, bytes) => {
    const file = join(repo, "fixture.txt");
    writeFileSync(file, bytes);
    const { getFilePatch } = await import("../git.js");
    const actual = patchMetrics(await getFilePatch("fixture.txt"));
    const expected = patchMetrics(git(["diff", "--no-index", "--", "/dev/null", file]));
    expect(actual).toEqual(expected);
  });
});
