import { z } from "zod";
import type { DiffOptions } from "./diff-options.js";
import type { DiffLayer } from "./git.js";

export interface InspectionIdentity {
  repositoryId: string;
  workspaceId: string;
  head: string | null;
  indexDigest: string;
  resolvedRevisions: string[];
}

export interface InspectionPatch {
  patch: string;
  complete: boolean;
  omittedPaths?: string[];
  layers?: DiffLayer[];
  /** Identity supplied by an immutable provider artifact, e.g. PR base/head. */
  provenance?: Record<string, string | number>;
}

export interface InspectionManifest extends InspectionIdentity {
  version: 1;
  snapshotId: string;
  scopeDigest: string;
  sourceDigest: string;
  capturedAt: number;
  consistency: "optimistic-validated";
  complete: boolean;
  options: DiffOptions;
  provenance?: Record<string, string | number>;
  layers: Array<{
    id: string;
    kind: DiffLayer["kind"];
    revision?: string;
    parents?: string[];
    sourceDigest: string;
    firstFile: number;
    fileCount: number;
  }>;
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const gitRevision = z.string().regex(/^\^?(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const safeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Validate retained/persisted manifests independently of TypeScript clients. */
export const inspectionManifestSchema = z.object({
  version: z.literal(1), snapshotId: z.uuid(), repositoryId: sha256, workspaceId: sha256,
  head: gitRevision.nullable(), indexDigest: sha256, resolvedRevisions: z.array(gitRevision).max(1000),
  scopeDigest: sha256, sourceDigest: sha256, capturedAt: safeCount,
  consistency: z.literal("optimistic-validated"), complete: z.boolean(),
  options: z.record(z.string().max(64), z.union([z.boolean(), z.string().max(8192), z.number().finite(), z.array(z.string().max(8192)).max(1000)])),
  provenance: z.record(z.string().max(100), z.union([z.string().max(8192), z.number().finite()])).optional(),
  layers: z.array(z.object({
    id: sha256, kind: z.enum(["working", "staged", "untracked", "revision", "commit", "pr", "mixed"]),
    revision: z.string().max(256).optional(), parents: z.array(z.string().max(256)).max(1000).optional(),
    sourceDigest: sha256, firstFile: safeCount, fileCount: safeCount,
  }).strict()).max(10000),
}).strict().superRefine((manifest, ctx) => {
  let firstFile = 0;
  for (const [index, layer] of manifest.layers.entries()) {
    if (layer.firstFile !== firstFile) ctx.addIssue({ code: "custom", path: ["layers", index, "firstFile"], message: "Layer inventories must be contiguous." });
    firstFile += layer.fileCount;
  }
});
