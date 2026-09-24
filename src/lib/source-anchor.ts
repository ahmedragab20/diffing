import { z } from "zod";
import type { AgentDiffIndex } from "./agent-diff-index.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const position = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Persisted source identity. A file index is used only while creating it. */
export const sourceAnchorSchema = z.object({
  version: z.literal(1),
  snapshotId: z.uuid(),
  repositoryId: digest,
  workspaceId: digest,
  scopeDigest: digest,
  head: z.string().max(64).nullable(),
  resolvedRevisions: z.array(z.string().max(65)).max(1000),
  layer: z.object({
    id: digest,
    kind: z.enum(["working", "staged", "untracked", "revision", "commit", "pr", "mixed"]),
    ordinal: position,
    revision: z.string().max(256).optional(),
  }).strict(),
  file: z.object({
    oldPath: z.string().max(4096).nullable(),
    newPath: z.string().max(4096).nullable(),
    occurrence: position,
    contentDigest: digest,
  }).strict(),
  range: z.object({
    side: z.enum(["additions", "deletions"]),
    start: position,
    end: position,
  }).strict().refine((range) => range.start <= range.end).optional(),
}).strict();
export type SourceAnchor = z.infer<typeof sourceAnchorSchema>;
export type AnchorFreshness = {
  status: "current" | "stale" | "unverified";
  reason: "same_source" | "workspace_changed" | "scope_changed" | "revision_changed" | "source_changed" | "source_missing" | "incomplete_capture" | "legacy_anchor";
};

export class SourceAnchorError extends Error {
  readonly code = "invalid_anchor";
}

export function createSourceAnchor(index: AgentDiffIndex, snapshotId: string, fileIndex: number, range?: SourceAnchor["range"]): SourceAnchor {
  const manifest = index.manifest;
  const file = index.files[fileIndex];
  if (!manifest || manifest.snapshotId !== snapshotId || !Number.isSafeInteger(fileIndex) || !file?.source) throw new SourceAnchorError("A matching captured manifest and an existing file are required.");
  const ordinal = manifest.layers.findIndex((layer) => layer.id === file.source!.layerId);
  const layer = manifest.layers[ordinal];
  if (!layer) throw new SourceAnchorError("The file is outside the captured layers.");
  if (range && range.end !== 0) {
    const lines = new Set<number>();
    for (let row = 0; row < file.rows.length; row++) {
      const line = file.rows.lineNumber(row, range.side);
      if (line !== null) lines.add(line);
    }
    if (range.end - range.start > 1000 || range.start < 1) throw new SourceAnchorError("The source range must be bounded within captured lines.");
    for (let line = range.start; line <= range.end; line++) {
      if (!lines.has(line)) throw new SourceAnchorError("The range includes a line absent from this capture.");
    }
  }
  const occurrence = index.files.slice(layer.firstFile, fileIndex).filter((candidate) => candidate.oldPath === file.oldPath && candidate.newPath === file.newPath).length;
  const parsed = sourceAnchorSchema.safeParse({
    version: 1, snapshotId, repositoryId: manifest.repositoryId,
    workspaceId: manifest.workspaceId, scopeDigest: manifest.scopeDigest,
    head: manifest.head, resolvedRevisions: [...manifest.resolvedRevisions],
    layer: { id: layer.id, kind: layer.kind, ordinal, ...(layer.revision ? { revision: layer.revision } : {}) },
    file: { oldPath: file.oldPath, newPath: file.newPath, occurrence, contentDigest: file.source.contentDigest },
    ...(range ? { range } : {}),
  });
  if (!parsed.success) throw new SourceAnchorError("Invalid source anchor coordinates.");
  return parsed.data;
}

/** Historical anchors are never rewritten or carried onto another revision. */
export function assessSourceAnchor(anchor: SourceAnchor | undefined, current: AgentDiffIndex): AnchorFreshness {
  if (!anchor || !sourceAnchorSchema.safeParse(anchor).success || !current.manifest) return { status: "unverified", reason: "legacy_anchor" };
  const manifest = current.manifest;
  if (manifest.workspaceId !== anchor.workspaceId || manifest.repositoryId !== anchor.repositoryId) return { status: "stale", reason: "workspace_changed" };
  if (manifest.scopeDigest !== anchor.scopeDigest) return { status: "stale", reason: "scope_changed" };
  if (manifest.head !== anchor.head || JSON.stringify(manifest.resolvedRevisions) !== JSON.stringify(anchor.resolvedRevisions)) return { status: "stale", reason: "revision_changed" };
  const layer = manifest.layers[anchor.layer.ordinal];
  if (!layer || layer.kind !== anchor.layer.kind || layer.revision !== anchor.layer.revision) return { status: "stale", reason: "revision_changed" };
  const candidates = current.files.slice(layer.firstFile, layer.firstFile + layer.fileCount).filter((file) => file.oldPath === anchor.file.oldPath && file.newPath === anchor.file.newPath);
  const file = candidates[anchor.file.occurrence];
  if (!file) return { status: manifest.complete ? "stale" : "unverified", reason: manifest.complete ? "source_missing" : "incomplete_capture" };
  if (file.source?.contentDigest !== anchor.file.contentDigest) return { status: "stale", reason: "source_changed" };
  // A partial capture cannot rule out omitted dependencies or comparison layers.
  if (!manifest.complete) return { status: "unverified", reason: "incomplete_capture" };
  return { status: "current", reason: "same_source" };
}
