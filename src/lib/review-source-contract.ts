import { z } from "zod";
import { reviewIdentitySchema } from "./review-identity.js";
import { sourceAnchorSchema } from "./source-anchor.js";

export const REVIEW_SOURCE_LIMITS = Object.freeze({ pageBytes: 128 * 1024, entryBytes: 16 * 1024, entries: 200 });

const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const reviewSourceQuerySchema = z.object({ snapshotId: z.uuid(), fileIndex: uint.optional(), offset: uint.default(0), limit: z.number().int().min(1).max(REVIEW_SOURCE_LIMITS.entries).default(100) }).strict();
export type ReviewSourceQuery = z.input<typeof reviewSourceQuerySchema>;
const fileSchema = z.object({
  index: uint, path: z.string().max(4096), oldPath: z.string().max(4096).nullable(), newPath: z.string().max(4096).nullable(),
  kind: z.enum(["modified", "added", "deleted", "renamed", "untracked", "binary"]),
  binary: z.boolean(), rows: uint, additions: uint, deletions: uint,
  anchor: sourceAnchorSchema.optional(),
}).strict();
export const reviewSourceRowSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fileHeader"), fileIndex: uint, path: z.string(), kind: z.string(), binary: z.boolean() }).strict(),
  z.object({ type: z.literal("hunkHeader"), hunkIndex: uint, oldStart: uint, oldLines: uint, newStart: uint, newLines: uint, heading: z.string() }).strict(),
  z.object({ type: z.literal("line"), hunkIndex: uint, kind: z.enum(["context", "add", "del"]), oldLineno: uint.nullable(), newLineno: uint.nullable(), content: z.string() }).strict(),
  z.object({ type: z.literal("noNewline"), hunkIndex: uint }).strict(),
]);
export const reviewSourcePageSchema = z.object({
  identity: reviewIdentitySchema, snapshotId: z.uuid(), fileIndex: uint.nullable(),
  offset: uint, next: uint.nullable(), total: uint, complete: z.boolean(), freshness: z.literal("not-checked"),
  entries: z.array(z.union([
    z.object({ index: uint, file: fileSchema }).strict(),
    z.object({ index: uint, row: reviewSourceRowSchema }).strict(),
    z.object({ index: uint, omitted: z.literal("row_too_large") }).strict(),
  ])).max(REVIEW_SOURCE_LIMITS.entries),
}).strict();
