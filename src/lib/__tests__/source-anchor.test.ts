// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DEFAULTS } from "../diff-options.js";
import { AgentDiffIndexCache } from "../agent-diff-index.js";
import {
  captureInspection,
  type InspectionIdentity,
  type InspectionPatch,
} from "../inspect-capture.js";
import {
  assessSourceAnchor,
  createSourceAnchor,
  sourceAnchorSchema,
  SourceAnchorError,
} from "../source-anchor.js";

const REPOSITORY = "a".repeat(64);
const WORKSPACE = "b".repeat(64);
const HEAD = "c".repeat(40);
const SNAPSHOT = "00000000-0000-4000-8000-000000000001";

const identity = (overrides: Partial<InspectionIdentity> = {}): (() => Promise<InspectionIdentity>) => {
  const value: InspectionIdentity = {
    repositoryId: REPOSITORY,
    workspaceId: WORKSPACE,
    head: HEAD,
    indexDigest: "d".repeat(64),
    resolvedRevisions: [],
    ...overrides,
  };
  return async () => value;
};

async function capture(
  layers: Array<{ kind: "working" | "staged" | "revision"; patch: string; revision?: string }>,
  complete = true,
  identityOverrides: Partial<InspectionIdentity> = {},
) {
  const patch = layers.map((layer) => layer.patch).join("\n");
  const result = await captureInspection(
    { ...DEFAULTS },
    async (): Promise<InspectionPatch> => ({ patch, complete, layers }),
    identity(identityOverrides),
    { now: () => 123 },
  );
  result.manifest.snapshotId = SNAPSHOT;
  return new AgentDiffIndexCache().getOrBuild(result.patch, result.complete, undefined, result.manifest);
}

function filePatch(path: string, oldText = "old", newText = "new") {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${oldText}\n+${newText}\n`;
}

function anchorFor(index: Awaited<ReturnType<typeof capture>>, fileIndex = 0, range?: { side: "additions" | "deletions"; start: number; end: number }) {
  return createSourceAnchor(index, SNAPSHOT, fileIndex, range);
}

describe("source anchors", () => {
  it("creates a valid source range anchor", async () => {
    const index = await capture([{ kind: "working", patch: filePatch("src/a.ts") }]);
    const anchor = anchorFor(index, 0, { side: "additions", start: 1, end: 1 });
    expect(anchor).toMatchObject({
      version: 1,
      snapshotId: SNAPSHOT,
      scopeDigest: index.manifest?.scopeDigest,
      head: HEAD,
      resolvedRevisions: [],
      layer: { kind: "working", ordinal: 0 },
      file: { oldPath: "src/a.ts", newPath: "src/a.ts", occurrence: 0 },
      range: { side: "additions", start: 1, end: 1 },
    });
  });

  it("allows a zero range for a mode-only file", async () => {
    const patch = "diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n";
    const index = await capture([{ kind: "working", patch }]);
    expect(anchorFor(index, 0, { side: "additions", start: 0, end: 0 }).file.newPath).toBe("script.sh");
  });

  it.each([
    ["range absent in capture", { side: "additions", start: 2, end: 2 }],
    ["oversized range", { side: "additions", start: 1, end: 1002 }],
  ] as const)("rejects %s", async (_name, range) => {
    const index = await capture([{ kind: "working", patch: filePatch("src/a.ts") }]);
    expect(() => anchorFor(index, 0, range)).toThrow(SourceAnchorError);
  });

  it("rejects an invalid file index", async () => {
    const index = await capture([{ kind: "working", patch: filePatch("src/a.ts") }]);
    expect(() => anchorFor(index, 1)).toThrow(SourceAnchorError);
    expect(() => createSourceAnchor(index, "00000000-0000-4000-8000-000000000002", 0)).toThrow(SourceAnchorError);
  });

  it("marks invalid schema and cross-workspace anchors unverified", async () => {
    const index = await capture([{ kind: "working", patch: filePatch("src/a.ts") }]);
    const anchor = anchorFor(index);
    expect(assessSourceAnchor({ ...anchor, version: 2 } as never, index)).toEqual({ status: "unverified", reason: "legacy_anchor" });
    const otherWorkspace = await capture([{ kind: "working", patch: filePatch("src/a.ts") }], true, { workspaceId: "e".repeat(64) });
    expect(assessSourceAnchor(anchor, otherWorkspace)).toEqual({ status: "stale", reason: "workspace_changed" });
  });

  it("stays current when a preceding file is added", async () => {
    const original = await capture([{ kind: "working", patch: filePatch("target.ts") }]);
    const anchor = anchorFor(original);
    const current = await capture([{ kind: "working", patch: filePatch("prefix.ts") + filePatch("target.ts") }]);
    expect(assessSourceAnchor(anchor, current)).toEqual({ status: "current", reason: "same_source" });
  });

  it("distinguishes same-path working and staged layers", async () => {
    const working = filePatch("same.ts", "old", "working");
    const staged = filePatch("same.ts", "working", "staged");
    const original = await capture([
      { kind: "working", patch: working },
      { kind: "staged", patch: staged },
    ]);
    const workingAnchor = anchorFor(original, 0);
    const stagedAnchor = anchorFor(original, 1);
    const current = await capture([
      { kind: "working", patch: working },
      { kind: "staged", patch: filePatch("same.ts", "working", "changed") },
    ]);
    expect(assessSourceAnchor(workingAnchor, current)).toEqual({ status: "current", reason: "same_source" });
    expect(assessSourceAnchor(stagedAnchor, current)).toEqual({ status: "stale", reason: "source_changed" });
  });

  it("marks a renamed source missing after the rename disappears", async () => {
    const rename = "diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n";
    const original = await capture([{ kind: "working", patch: rename }]);
    const anchor = anchorFor(original);
    const current = await capture([{ kind: "working", patch: filePatch("new.ts") }]);
    expect(assessSourceAnchor(anchor, current)).toEqual({ status: "stale", reason: "source_missing" });
  });

  it("marks head and resolved revision changes stale", async () => {
    const original = await capture([{ kind: "working", patch: filePatch("src/a.ts") }]);
    const anchor = anchorFor(original);
    const rebased = await capture([{ kind: "working", patch: filePatch("src/a.ts") }], true, { head: "f".repeat(40) });
    const resolved = await capture([{ kind: "working", patch: filePatch("src/a.ts") }], true, { resolvedRevisions: ["e".repeat(40)] });
    expect(assessSourceAnchor(anchor, rebased)).toEqual({ status: "stale", reason: "revision_changed" });
    expect(assessSourceAnchor(anchor, resolved)).toEqual({ status: "stale", reason: "revision_changed" });
  });

  it("marks an incomplete capture unverified", async () => {
    const original = await capture([{ kind: "working", patch: filePatch("src/a.ts") }]);
    const anchor = anchorFor(original);
    const incomplete = await capture([{ kind: "working", patch: filePatch("src/a.ts") }], false);
    expect(assessSourceAnchor(anchor, incomplete)).toEqual({ status: "unverified", reason: "incomplete_capture" });
  });

  it("marks CR and mode changes source-changed", async () => {
    const originalPatch = filePatch("src/a.ts");
    const original = await capture([{ kind: "working", patch: originalPatch }]);
    const anchor = anchorFor(original);
    const crChanged = await capture([{ kind: "working", patch: originalPatch.replace("+new\n", "+new\r\n") }]);
    const modeChanged = await capture([{ kind: "working", patch: originalPatch.replace("--- a/src/a.ts", "old mode 100644\nnew mode 100755\n--- a/src/a.ts") }]);
    expect(assessSourceAnchor(anchor, crChanged)).toEqual({ status: "stale", reason: "source_changed" });
    expect(assessSourceAnchor(anchor, modeChanged)).toEqual({ status: "stale", reason: "source_changed" });
  });

  it("preserves exact fields through serialization and parsing", async () => {
    const index = await capture([{ kind: "working", patch: filePatch("src/a.ts") }]);
    const anchor = anchorFor(index, 0, { side: "deletions", start: 1, end: 1 });
    expect(sourceAnchorSchema.parse(JSON.parse(JSON.stringify(anchor)))).toEqual(anchor);
  });
});
