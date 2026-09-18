import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { persistedReviewCommentsSchema } from "./comment-schema.js";
import { persistedViewedSchema } from "./viewed-schema.js";
import { persistedPlansSchema } from "./plan-schema.js";
import { ReviewStoreError } from "./review-store.js";
import {
  LEGACY_CHUNK_BYTES,
  LEGACY_FILES,
  MAX_SOURCE_BYTES,
  legacyArchiveSchema,
  legacyChunkSchema,
  legacyCommitSchema,
  type LegacyArchive,
  type LegacySummary,
} from "./review-legacy-contract.js";

export {
  LEGACY_CHUNK_BYTES,
  LEGACY_FILES,
  MAX_SOURCE_BYTES,
  legacyArchiveSchema,
  legacyChunkSchema,
  legacyCommitSchema,
  legacySourceSchema,
  type LegacyArchive,
  type LegacySummary,
} from "./review-legacy-contract.js";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Validate without backfilling history, assigning actors, or guessing approvals. */
export function decodeLegacyArchive(input: unknown) {
  const archive = legacyArchiveSchema.parse(input);
  if (new Set(archive.sources.map((source) => source.name)).size !== archive.sources.length) throw new ReviewStoreError("invalid_request");
  let comments: z.infer<typeof persistedReviewCommentsSchema> = [];
  let importedPlans: z.infer<typeof persistedPlansSchema> = [];
  let importedViewed: z.infer<typeof persistedViewedSchema> = {};
  for (const source of archive.sources) {
    const bytes = Buffer.from(source.base64, "base64");
    if (bytes.toString("base64") !== source.base64 || bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw new ReviewStoreError("corrupt_store");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const data: unknown = JSON.parse(text);
    if (source.name === "comments.json") comments = persistedReviewCommentsSchema.parse(data);
    if (source.name === "plans.json") importedPlans = persistedPlansSchema.parse(data);
    if (source.name === "viewed.json") importedViewed = persistedViewedSchema.parse(data);
  }
  return { archive, comments, plans: importedPlans, viewed: importedViewed };
}

/** Read only named stores; failures and malformed existing state are never empty. */
export async function readLegacyArchive(directory: string): Promise<LegacyArchive> {
  const sources: LegacyArchive["sources"] = [];
  for (const name of LEGACY_FILES) {
    let file;
    try { file = await open(join(directory, name), "r"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_SOURCE_BYTES) throw new ReviewStoreError("store_limit");
      const buffer = Buffer.alloc(MAX_SOURCE_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = await file.read(buffer, size, buffer.length - size, size);
        if (read.bytesRead === 0) break;
        size += read.bytesRead;
      }
      if (size > MAX_SOURCE_BYTES) throw new ReviewStoreError("store_limit");
      const bytes = buffer.subarray(0, size);
      sources.push({ name, bytes: size, sha256: digest(bytes), base64: bytes.toString("base64") });
    } finally { await file.close(); }
  }
  const archive: LegacyArchive = { version: 1, sources };
  decodeLegacyArchive(archive);
  return archive;
}

export function encodeLegacyArchive(input: unknown) {
  const { archive } = decodeLegacyArchive(input);
  const bytes = Buffer.from(JSON.stringify(archive));
  const id = digest(bytes);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += LEGACY_CHUNK_BYTES) chunks.push(bytes.subarray(offset, offset + LEGACY_CHUNK_BYTES).toString("base64"));
  return { id, chunks };
}

/** Staged chunks are inert until a checked commit event makes the import visible. */
export class LegacyProjection {
  private chunks: string[] = [];
  private id?: string;
  private total = 0;
  private committed = false;
  summary: LegacySummary | null = null;
  archive: LegacyArchive | null = null;

  apply(effect: z.infer<typeof legacyChunkSchema> | z.infer<typeof legacyCommitSchema>) {
    if (effect.type === "legacy.chunk") {
      if (this.committed || effect.index !== this.chunks.length || effect.index >= effect.total || (this.id && (this.id !== effect.id || this.total !== effect.total))) throw new ReviewStoreError("corrupt_store");
      const bytes = Buffer.from(effect.base64, "base64");
      if (bytes.toString("base64") !== effect.base64 || bytes.length === 0 || (effect.index < effect.total - 1 && bytes.length !== LEGACY_CHUNK_BYTES)) throw new ReviewStoreError("corrupt_store");
      this.id = effect.id;
      this.total = effect.total;
      this.chunks.push(effect.base64);
      return;
    }
    if (this.committed || effect.id !== this.id || this.chunks.length !== this.total) throw new ReviewStoreError("corrupt_store");
    const bytes = Buffer.concat(this.chunks.map((chunk) => Buffer.from(chunk, "base64")));
    if (digest(bytes) !== this.id) throw new ReviewStoreError("corrupt_store");
    const decoded = decodeLegacyArchive(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    this.archive = decoded.archive;
    this.summary = { id: effect.id, sources: decoded.archive.sources.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), comments: decoded.comments.length, plans: decoded.plans.length, viewedScopes: Object.keys(decoded.viewed).length, provenance: "legacy-unverified", history: "not-persisted-by-legacy-session" };
    this.committed = true;
  }
}
