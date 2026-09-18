import { z } from "zod";

export const LEGACY_FILES = ["comments.json", "plans.json", "viewed.json"] as const;
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const LEGACY_CHUNK_BYTES = 48 * 1024;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const legacySourceSchema = z.object({
  name: z.enum(LEGACY_FILES), bytes: z.number().int().nonnegative().max(MAX_SOURCE_BYTES), sha256,
  // Original UTF-8 bytes, including whitespace and unknown fields, are backed up.
  base64: z.string().max(Math.ceil(MAX_SOURCE_BYTES / 3) * 4),
}).strict();
export const legacyArchiveSchema = z.object({ version: z.literal(1), sources: z.array(legacySourceSchema).max(3) }).strict();
export type LegacyArchive = z.infer<typeof legacyArchiveSchema>;
export interface LegacySummary {
  id: string;
  sources: Array<{ name: typeof LEGACY_FILES[number]; bytes: number; sha256: string }>;
  comments: number;
  plans: number;
  viewedScopes: number;
  provenance: "legacy-unverified";
  history: "not-persisted-by-legacy-session";
}

export const legacyChunkSchema = z.object({
  type: z.literal("legacy.chunk"), id: sha256,
  index: z.number().int().nonnegative().max(700), total: z.number().int().positive().max(700),
  base64: z.string().max(LEGACY_CHUNK_BYTES / 3 * 4),
}).strict();
export const legacyCommitSchema = z.object({ type: z.literal("legacy.committed"), id: sha256 }).strict();
