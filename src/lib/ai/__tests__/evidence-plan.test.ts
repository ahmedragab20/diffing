// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAiPrompt } from "../context.js";
import { captureLocalOriginals } from "../local-originals.js";
import { resolveDiffSnapshot } from "../diff-snapshot.js";
import {
  evidenceBatches,
  mergeEvidenceRanges,
  planDiffEvidence,
} from "../evidence-plan.js";
import { sourceHash, ReviewSnapshot } from "../snapshots.js";
import type { AiDiffContext } from "../types.js";
import type { EvidenceRange } from "../snapshot-prompt.js";

const identity = {
  kind: "local" as const,
  repositoryId: "repo",
  mode: "working" as const,
  baseSha: null,
  headSha: null,
  indexHash: null,
  patchHash: "",
};
const context: AiDiffContext = { kind: "diff", patch: "" };
function patch(path: string, body: string, newPath = path): string {
  return `diff --git a/${path} b/${newPath}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${newPath}\n${body}`;
}
function resolved(text: string, originals: Parameters<typeof resolveDiffSnapshot>[1]["originals"] = []) {
  return resolveDiffSnapshot(context, {
    identity: { ...identity, patchHash: sourceHash(text) },
    patch: text,
    omissions: [],
    originals,
  }, "/repo").snapshot;
}
function original(key: string, path: string, side: "old" | "new", content: string) {
  return { key, path, side, revision: side === "old" ? "HEAD" : "worktree", content, complete: true, provenance: "recorded" as const, representation: "original" as const };
}
function lines(count: number, value: (line: number) => string = (line) => `line-${line}`) {
  return Array.from({ length: count }, (_, i) => value(i + 1)).join("\n");
}

const runRequest = (snapshotReader: ReviewSnapshot) => ({
  trigger: "user" as const,
  conversationId: "test",
  modelId: "test-model",
  surface: "diff" as const,
  action: "review-risks" as const,
  context,
  snapshotReader,
});

describe("evidence planning and scoping regressions", () => {
  it("uses hunk line coordinates for large originals without issuing planning evidence", () => {
    const body = "@@ -3990 +3990 @@\n-old-3990\n+changed-3990\n";
    const text = patch("file.ts", body);
    const oldText = lines(4000, (line) => line === 3990 ? "old-3990" : line === 1 ? "source-prefix" : `old-${line}`);
    const newText = lines(4000, (line) => line === 3990 ? "changed-3990" : line === 1 ? "source-prefix" : `new-${line}`);
    const snapshot = resolved(text, [original("old:file.ts", "file.ts", "old", oldText), original("new:file.ts", "file.ts", "new", newText)]);
    const plan = planDiffEvidence(snapshot);
    const ranges = plan.units[0].ranges;
    expect(ranges.some((range) => range.key === "new:file.ts" && range.startLine <= 3990 && range.endLine >= 3990)).toBe(true);
    expect(ranges.find((range) => range.key === "new:file.ts")?.startLine).toBeGreaterThan(3900);
    expect(snapshot.coverage().returnedLines).toBe(0);
    const built = buildAiPrompt(runRequest(snapshot));
    expect(built.prompt).toContain("changed-3990");
    expect(built.prompt).not.toContain("source-prefix");
  });

  it("keeps distinct IDs for repeated patch occurrences", () => {
    const text = patch("same.ts", "@@ -1 +1 @@\n-a\n+b\n") + patch("same.ts", "@@ -4 +4 @@\n-c\n+d\n");
    const plan = planDiffEvidence(resolved(text));
    expect(new Set(plan.units.map((unit) => unit.id)).size).toBe(2);
    expect(new Set(plan.units.map((unit) => unit.hunkId)).size).toBe(2);
  });

  it("partitions a 500-line hunk with complete patch-row coverage", () => {
    const rows = Array.from({ length: 500 }, (_, i) => `+added-${i + 1}`).join("\n");
    const text = patch("large.ts", `@@ -1,0 +1,500 @@\n${rows}\n`);
    const plan = planDiffEvidence(resolved(text));
    const patchRanges = plan.units.flatMap((unit) => unit.ranges).filter((range) => range.key === "patch:0");
    for (let row = 6; row <= 505; row++)
      expect(patchRanges.some((range) => range.startLine <= row && range.endLine >= row)).toBe(true);
    expect(plan.units.length).toBeGreaterThan(1);
  });

  it("maps rename originals to their own old and new paths", () => {
    const text = patch("old.ts", "@@ -10 +10 @@\n-old\n+new\n", "new.ts");
    const snapshot = resolved(text, [original("old:old.ts", "old.ts", "old", lines(30)), original("new:new.ts", "new.ts", "new", lines(30))]);
    const ranges = planDiffEvidence(snapshot).units[0].ranges;
    expect(ranges.some((range) => range.key === "old:old.ts")).toBe(true);
    expect(ranges.some((range) => range.key === "new:new.ts")).toBe(true);
    expect(ranges.some((range) => range.key === "old:new.ts")).toBe(false);
  });

  it("excludes oversized patch lines without empty units and continues planning", () => {
    const text = patch("huge.ts", `@@ -1,3 +1,3 @@\n-${"x".repeat(13 * 1024)}\n+valid\n tail\n`);
    const plan = planDiffEvidence(resolved(text));
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "evidence_excluded")).toBe(true);
    expect(plan.units.every((unit) => unit.ranges.length > 0 && unit.estimatedBytes > 0)).toBe(true);
    expect(plan.units.some((unit) => unit.ranges.some((range) => range.key === "patch:0" && range.endLine >= 7))).toBe(true);
  });

  it("merges only same-key ranges and batches every unit once in order", () => {
    const ranges: EvidenceRange[] = [
      { key: "a", startLine: 1, endLine: 2 }, { key: "a", startLine: 3, endLine: 5 },
      { key: "b", startLine: 2, endLine: 4 }, { key: "a", startLine: 5, endLine: 7 },
    ];
    expect(mergeEvidenceRanges(ranges)).toEqual([
      { key: "a", startLine: 1, endLine: 7 }, { key: "b", startLine: 2, endLine: 4 },
    ]);
    const units = [1, 2, 3].map((n) => ({ id: `${n}`, hunkId: `${n}`, path: `${n}.ts`, ranges: [], estimatedBytes: 100 }));
    expect(evidenceBatches(units, 150).flat().map((unit) => unit.id)).toEqual(["1", "2", "3"]);
  });

  it("scopes local originals before the file limit", async () => {
    const text = Array.from({ length: 25 }, (_, i) => patch(`f${i}.ts`, "@@ -1 +1 @@\n-old\n+new\n")).join("");
    const blobReads: string[] = [];
    const worktreeReads: string[] = [];
    const result = await captureLocalOriginals({ patch: text, mode: "working", baseSha: null, headSha: null, paths: ["f24.ts"], maxFiles: 20, onExcess: "omit" }, async (_revision, path) => { blobReads.push(path); return "old\n"; }, async (path) => { worktreeReads.push(path); return "new\n"; });
    expect(blobReads).toEqual(["f24.ts"]);
    expect(worktreeReads).toEqual(["f24.ts"]);
    expect(result.omissions).not.toContain(expect.stringContaining("further path"));
    expect(result.sources.map((source) => source.path)).toEqual(["f24.ts", "f24.ts"]);
  });
});
