// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAgentDiffIndex } from "../agent-diff-index.js";
import { FileInspectSnapshots, type CapturedFilesPage, type FileInspectError } from "../file-inspect-snapshots.js";
import type { InspectScopeError } from "../inspect-scope.js";

const tempRepos: string[] = [];

afterEach(() => {
  for (const repo of tempRepos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" });
}

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "file-inspect-snapshots-"));
  tempRepos.push(repo);
  git(repo, "init", "--quiet");
  git(repo, "config", "user.email", "tests@example.com");
  git(repo, "config", "user.name", "Snapshot Tests");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "b.ts"), "export const b = 1;\n");
  git(repo, "add", "a.ts", "b.ts");
  git(repo, "commit", "--quiet", "-m", "initial");
  writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
  writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
  return repo;
}

function indexFor(...paths: string[]) {
  const patch = paths
    .map((path) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`)
    .join("");
  return buildAgentDiffIndex(patch);
}

function decodeToken(token: string): { payload: Record<string, unknown>; signature: string } {
  const [payload, signature] = token.split(".");
  return { payload: JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), signature };
}

function encodePayload(payload: Record<string, unknown>, signature: string): string {
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
}

function requirePage(result: CapturedFilesPage | FileInspectError | InspectScopeError): CapturedFilesPage {
  if (!("files" in result)) throw new Error(`Expected a captured files page, received ${"code" in result ? result.code : result.error}`);
  return result;
}

describe("FileInspectSnapshots", () => {
  it("retains a continuation on the old Git snapshot while fresh traversal sees an intent-to-add file", () => {
    const repo = createRepo();
    const initialDiff = git(repo, "diff", "--no-ext-diff", "--no-color");
    const snapshots = new FileInspectSnapshots();
    const initial = requirePage(snapshots.start(buildAgentDiffIndex(initialDiff), 0, 1));
    expect(initial.files.map((file) => file.path)).toEqual(["a.ts"]);
    expect(initial.nextContinuation).toBeTruthy();

    writeFileSync(join(repo, "0.ts"), "export const zero = 0;\n");
    git(repo, "add", "-N", "0.ts");
    const fresh = requirePage(snapshots.start(buildAgentDiffIndex(git(repo, "diff", "--no-ext-diff", "--no-color")), 0, 1));
    const continued = requirePage(snapshots.continue(initial.nextContinuation!));

    expect(continued.files.map((file) => file.path)).toEqual(["b.ts"]);
    expect(continued.snapshotId).toBe(initial.snapshotId);
    expect(continued.generation).toBe(initial.generation);
    expect(fresh.files.map((file) => file.path)).toEqual(["0.ts"]);
    expect(fresh.snapshotId).not.toBe(initial.snapshotId);
  });

  it("retains the path filter, page size, complete flag, and omitted paths across pages", () => {
    const index = buildAgentDiffIndex(
      `${[
        "src/a.ts",
        "src/b.ts",
        "docs/readme.md",
      ].map((path) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`).join("")}`,
      undefined,
      { complete: false, omittedPaths: ["vendor/**"] },
    );
    const snapshots = new FileInspectSnapshots();
    const pages: CapturedFilesPage[] = [];
    let page = requirePage(snapshots.start(index, 0, 1, "src/*.ts"));
    pages.push(page);
    while (page.nextContinuation) {
      page = requirePage(snapshots.continue(page.nextContinuation));
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(pages.map((entry) => "files" in entry ? entry.files[0]?.path : null)).toEqual(["src/a.ts", "src/b.ts"]);
    for (const entry of pages) {
      expect(entry.path).toBe("src/*.ts");
      expect(entry.complete).toBe(false);
      expect(entry.omittedPaths).toEqual(["vendor/**"]);
      expect(entry.returned).toBe(1);
    }
    expect(pages.at(-1)?.nextContinuation).toBeNull();
  });

  it("replays the same token identically and rejects it in another snapshot session", () => {
    const index = indexFor("a.ts", "b.ts");
    const snapshots = new FileInspectSnapshots();
    const first = requirePage(snapshots.start(index, 0, 1));
    const replay = requirePage(snapshots.continue(first.nextContinuation!));
    const replayAgain = requirePage(snapshots.continue(first.nextContinuation!));
    const cachedStart = requirePage(snapshots.start(index, 0, 1));
    const otherSession = new FileInspectSnapshots().continue(first.nextContinuation!);

    expect(replayAgain).toEqual(replay);
    expect(cachedStart.snapshotId).toBe(first.snapshotId);
    expect(otherSession).toMatchObject({ status: 410, code: "snapshot_expired" });
  });

  it("expires at the TTL boundary, evicts by capture count, and rejects an oversized single capture", () => {
    let now = 100;
    const timed = new FileInspectSnapshots({ now: () => now, ttlMs: 10 });
    const first = requirePage(timed.start(indexFor("a.ts", "b.ts"), 0, 1));
    now = 110;
    expect(timed.continue(first.nextContinuation!)).toMatchObject({ status: 410, code: "snapshot_expired" });

    const limited = new FileInspectSnapshots({ maxCaptures: 1 });
    const firstCapture = requirePage(limited.start(indexFor("a.ts", "b.ts"), 0, 1));
    limited.start(indexFor("b.ts"), 0, 1);
    expect(limited.continue(firstCapture.nextContinuation!)).toMatchObject({ status: 410, code: "snapshot_expired" });

    const index = indexFor("large.ts");
    const tooSmall = new FileInspectSnapshots({ maxBytes: Buffer.byteLength(JSON.stringify(index)) - 1 });
    expect(tooSmall.start(index)).toMatchObject({ status: 413, code: "snapshot_too_large" });
  });

  it("rejects malformed, tampered, and schema-invalid continuations", () => {
    const snapshots = new FileInspectSnapshots();
    const first = requirePage(snapshots.start(indexFor("a.ts", "b.ts"), 0, 1));
    const token = first.nextContinuation!;
    const { payload, signature } = decodeToken(token);
    const alteredCursor = encodePayload({ ...payload, cursor: 2 }, signature);
    const alteredPath = encodePayload({ ...payload, path: "other.ts" }, signature);
    const alteredVersion = encodePayload({ ...payload, v: 2 }, signature);
    const alteredSignature = `${token.slice(0, token.lastIndexOf("."))}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

    for (const candidate of ["malformed", alteredCursor, alteredPath, alteredVersion, alteredSignature]) {
      expect(snapshots.continue(candidate)).toMatchObject({ status: 400, code: "invalid_continuation" });
    }
  });

  it("evicts older captures when their combined representation exceeds the byte budget", () => {
    const firstIndex = indexFor("a.ts", "b.ts");
    const secondIndex = indexFor("c.ts", "d.ts");
    const snapshots = new FileInspectSnapshots({
      maxBytes: Math.max(...[firstIndex, secondIndex].map((index) => Buffer.byteLength(JSON.stringify(index)))),
    });
    const first = requirePage(snapshots.start(firstIndex, 0, 1));
    const second = requirePage(snapshots.start(secondIndex, 0, 1));
    expect(snapshots.continue(first.nextContinuation!)).toMatchObject({ status: 410, code: "snapshot_expired" });
    expect(requirePage(snapshots.continue(second.nextContinuation!)).files[0].path).toBe("d.ts");
  });

  it("returns a normal empty page when the cursor is beyond the matched files", () => {
    const page = requirePage(new FileInspectSnapshots().start(indexFor("a.ts"), 5, 1));
    expect(page).toMatchObject({ returned: 0, files: [], nextContinuation: null });
    expect(page).not.toHaveProperty("status");
  });
});
