import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createSourceAnchor, type SourceAnchor } from "./source-anchor.js";
import {
  indexFiles,
  indexHunks,
  indexSlice,
  indexSearch,
  resolveInspectFile,
  type AgentDiffIndex,
  type FilesPage,
} from "./agent-diff-index.js";

const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const readQuerySchema = z.object({
  file: uint.optional(),
  path: z.string().max(4096).optional(),
  cursor: uint.optional(),
  limit: uint.optional(),
  start: uint.optional(),
  maxLines: uint.optional(),
  maxBytes: uint.optional(),
  row: uint.optional(),
  q: z.string().max(4096).optional(),
  generation: uint.optional(),
}).strict();
export type SnapshotReadQuery = z.infer<typeof readQuerySchema>;
export type SnapshotReadOperation = "hunks" | "slice" | "search";
const readCursorSchema = z.object({
  v: z.literal(1),
  owner: z.uuid(),
  snapshot: z.uuid(),
  operation: z.enum(["hunks", "slice", "search"]),
  query: readQuerySchema,
}).strict();

const cursorSchema = z.object({
  v: z.literal(1),
  owner: z.uuid(),
  snapshot: z.uuid(),
  cursor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(1000),
  path: z.string().max(4096).optional(),
  maxBytes: z.number().int().min(512).max(4 * 1024 * 1024).optional(),
}).strict();

export interface FileInspectError {
  status: 400 | 409 | 410 | 413;
  code:
    | "invalid_continuation"
    | "snapshot_expired"
    | "snapshot_too_large"
    | "continuation_required"
    | "stale_generation"
    | "response_too_large";
  error: string;
  recovery: "restart_files";
}

export function fileInspectError(
  status: FileInspectError["status"],
  code: FileInspectError["code"],
  error: string,
): FileInspectError {
  return { status, code, error, recovery: "restart_files" };
}

interface Capture {
  id: string;
  sourceIndex: AgentDiffIndex;
  index: AgentDiffIndex;
  bytes: number;
  expiresAt: number;
}

export interface CapturedFilesPage extends FilesPage {
  manifest?: AgentDiffIndex["manifest"];
  omitted?: { reason: "row_too_large"; count: number; fileIndex: number };
  snapshotId: string;
  nextContinuation: string | null;
  expiresAt: number;
  /** Retained bytes are not a claim that the workspace is still unchanged. */
  freshness: "not-checked";
  complete: boolean;
  omittedPaths?: string[];
}

/** Session-local immutable index retention. No writes, inference or Git collection. */
export class FileInspectSnapshots {
  private readonly owner = randomUUID();
  private readonly key = randomBytes(32);
  private readonly captures = new Map<string, Capture>();
  private bytes = 0;

  constructor(private readonly options: {
    now?: () => number;
    ttlMs?: number;
    maxCaptures?: number;
    maxBytes?: number;
  } = {}) {
    for (const value of [options.ttlMs, options.maxCaptures, options.maxBytes]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new RangeError("File snapshot retention limits must be positive safe integers.");
      }
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private prune(): void {
    for (const [id, capture] of this.captures) {
      if (capture.expiresAt <= this.now()) this.remove(id);
    }
  }

  private remove(id: string): void {
    const capture = this.captures.get(id);
    if (capture) this.bytes -= capture.bytes;
    this.captures.delete(id);
  }

  start(index: AgentDiffIndex, cursor = 0, limit = 100, path?: string, maxBytes = 256 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 512 || maxBytes > 4 * 1024 * 1024) {
      return fileInspectError(400, "invalid_continuation", "maxBytes must be between 512 and 4194304 bytes, including metadata.");
    }
    const page = indexFiles(index, cursor, limit, path);
    if ("status" in page) return page;
    this.prune();
    let capture = [...this.captures.values()].find((entry) => entry.sourceIndex === index);
    if (!capture) {
      // Bound the retained representation, including parsed rows and metadata.
      const bytes = Buffer.byteLength(JSON.stringify(index));
      const maxBytes = this.options.maxBytes ?? 64 * 1024 * 1024;
      if (bytes > maxBytes) {
        return fileInspectError(
          413,
          "snapshot_too_large",
          "File snapshot exceeds retention capacity; narrow the review scope and restart files.",
        );
      }
      while (this.captures.size >= (this.options.maxCaptures ?? 8) || this.bytes + bytes > maxBytes) {
        this.remove(this.captures.keys().next().value!);
      }
      const id = randomUUID();
      capture = {
        id,
        sourceIndex: index,
        index: index.manifest ? { ...index, manifest: { ...index.manifest, snapshotId: id } } : index,
        bytes,
        expiresAt: this.now() + (this.options.ttlMs ?? 5 * 60_000),
      };
      this.captures.set(capture.id, capture);
      this.bytes += bytes;
    }
    return this.page(capture, page, limit, path, maxBytes);
  }

  continue(token: string): CapturedFilesPage | FileInspectError {
    const invalid = () => fileInspectError(
      400,
      "invalid_continuation",
      "Invalid file continuation; restart files without a continuation.",
    );
    if (token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return invalid();
    const [payload, signature] = token.split(".");
    let decoded: z.infer<typeof cursorSchema>;
    try {
      decoded = cursorSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    } catch {
      return invalid();
    }
    // A different server incarnation cannot resume this session's retained data.
    if (decoded.owner !== this.owner) return this.expired();
    const expected = createHmac("sha256", this.key).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return invalid();
    this.prune();
    const capture = this.captures.get(decoded.snapshot);
    if (!capture) return this.expired();
    const page = indexFiles(capture.index, decoded.cursor, decoded.limit, decoded.path);
    if ("status" in page) return invalid();
    return this.page(capture, page, decoded.limit, decoded.path, decoded.maxBytes);
  }

  files(snapshotId: string, cursor = 0, limit = 100, path?: string, maxBytes = 256 * 1024, generation?: number) {
    if (!z.uuid().safeParse(snapshotId).success) return this.invalidRead();
    this.prune();
    const capture = this.captures.get(snapshotId);
    if (!capture) return this.expired();
    if (generation !== undefined && generation !== capture.index.generation) return fileInspectError(409, "stale_generation", "Generation does not match the retained snapshot.");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 512 || maxBytes > 4 * 1024 * 1024) return this.invalidRead();
    const page = indexFiles(capture.index, cursor, limit, path);
    return "status" in page ? page : this.page(capture, page, limit, path, maxBytes);
  }

  /** Inspect the same retained source selected by a files page. */
  get(snapshotId: string): AgentDiffIndex | undefined {
    this.prune();
    return this.captures.get(snapshotId)?.index;
  }

  anchor(snapshotId: string, fileIndex: number, range?: SourceAnchor["range"]) {
    this.prune();
    const capture = this.captures.get(snapshotId);
    if (!capture) return this.expired();
    return createSourceAnchor(capture.index, snapshotId, fileIndex, range);
  }

  read(operation: SnapshotReadOperation, snapshotId: string, query: SnapshotReadQuery) {
    const parsed = readQuerySchema.safeParse(query);
    if (!parsed.success || !z.uuid().safeParse(snapshotId).success) return this.invalidRead();
    if ([query.path, query.q].some((value) => value !== undefined && Buffer.byteLength(JSON.stringify(value)) > 4096)) return this.invalidRead();
    this.prune();
    const capture = this.captures.get(snapshotId);
    if (!capture) return this.expired();
    return structuredClone(this.readPage(operation, capture, parsed.data));
  }

  continueRead(operation: SnapshotReadOperation, token: string) {
    if (token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return this.invalidRead();
    const [payload, signature] = token.split(".");
    let decoded: z.infer<typeof readCursorSchema>;
    try {
      decoded = readCursorSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    } catch {
      return this.invalidRead();
    }
    if (decoded.operation !== operation) return this.invalidRead();
    if (decoded.owner !== this.owner) return this.expired();
    const expected = createHmac("sha256", this.key).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return this.invalidRead();
    return this.read(operation, decoded.snapshot, decoded.query);
  }

  private invalidRead() {
    return fileInspectError(400, "invalid_continuation", "Invalid retained inspect request; pass its continuation alone or restart files.");
  }

  private readPage(operation: SnapshotReadOperation, capture: Capture, query: SnapshotReadQuery) {
    const index = capture.index;
    if (query.generation !== undefined && query.generation !== index.generation) {
      return fileInspectError(409, "stale_generation", "Generation does not match the retained snapshot.");
    }
    const resolved = operation === "search" ? null : resolveInspectFile(index, query.file, query.path);
    if (resolved && "status" in resolved) return resolved;
    const file = resolved?.fileIndex ?? 0;
    const result = operation === "hunks"
      ? indexHunks(index, file, query.cursor, query.limit)
      : operation === "slice"
        ? indexSlice(index, file, query.start, query.maxLines, query.maxBytes)
        : indexSearch(index, query.q ?? "", query.file, query.row, query.limit, query.maxBytes, undefined, query.path);
    if ("status" in result) return result;
    const budget = query.maxBytes ?? 256 * 1024;
    if (budget < 512 || budget > 4 * 1024 * 1024) {
      return fileInspectError(400, "invalid_continuation", "maxBytes must be between 512 and 4194304 bytes, including metadata.");
    }
    const length = "hunks" in result ? result.hunks.length : "rows" in result ? result.rows.length : result.hits.length;
    const assemble = (count: number, omit = false) => {
      const consumed = omit ? 1 : count;
      let next: SnapshotReadQuery | null = null;
      let page = result;
      if ("hunks" in result) {
        const cursor = Math.min(query.cursor ?? 0, result.total) + consumed;
        const nextCursor = cursor < result.total ? cursor : null;
        page = { ...result, hunks: result.hunks.slice(0, count), returned: count, nextCursor };
        if (nextCursor !== null) next = { ...query, cursor: nextCursor };
      } else if ("rows" in result) {
        const cursor = result.startRow + consumed;
        const nextRow = cursor < result.totalRows ? cursor : null;
        page = { ...result, rows: result.rows.slice(0, count), truncated: nextRow !== null || omit, nextRow };
        if (nextRow !== null) next = { ...query, start: nextRow };
      } else {
        const excluded = result.hits[consumed];
        const nextFile = excluded?.fileIndex ?? result.nextFile;
        const nextRow = excluded?.row ?? result.nextRow;
        page = { ...result, hits: result.hits.slice(0, count), truncated: nextFile !== null || omit, nextFile, nextRow };
        if (nextFile !== null) next = { ...query, file: nextFile, row: nextRow ?? 0 };
      }
      let nextContinuation: string | null = null;
      if (next) {
        const payload = Buffer.from(JSON.stringify({ v: 1, owner: this.owner, snapshot: capture.id, operation, query: next })).toString("base64url");
        nextContinuation = `${payload}.${createHmac("sha256", this.key).update(payload).digest("base64url")}`;
      }
      const response = {
        ...page,
        ...(index.manifest ? { manifest: structuredClone(index.manifest) } : {}),
        snapshotId: capture.id,
        nextContinuation,
        expiresAt: capture.expiresAt,
        freshness: "not-checked" as const,
        complete: index.complete,
        ...(index.omittedPaths ? { omittedPaths: [...index.omittedPaths] } : {}),
        ...(omit ? { omitted: { reason: "row_too_large" as const, count: 1 } } : {}),
      };
      if ("estimatedBytes" in response) {
        // Include the size field itself, tokens, UTF-8 encoding and JSON escaping.
        response.estimatedBytes = 0;
        for (;;) {
          const size = Buffer.byteLength(JSON.stringify(response));
          if (response.estimatedBytes === size) break;
          response.estimatedBytes = size;
        }
      }
      return response;
    };
    const full = assemble(length);
    if (Buffer.byteLength(JSON.stringify(full)) <= budget) return full;
    let best: ReturnType<typeof assemble> | undefined;
    let low = 1;
    let high = length - 1;
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const candidate = assemble(count);
      if (Buffer.byteLength(JSON.stringify(candidate)) <= budget) {
        best = candidate;
        low = count + 1;
      } else high = count - 1;
    }
    if (best) return best;
    const omission = assemble(0, length > 0);
    if (Buffer.byteLength(JSON.stringify(omission)) <= budget) return omission;
    return fileInspectError(413, "response_too_large", "Snapshot metadata exceeds maxBytes; increase the budget or narrow the filter.");
  }

  private expired(): FileInspectError {
    return fileInspectError(
      410,
      "snapshot_expired",
      "File snapshot expired or belongs to another session; restart files without a continuation.",
    );
  }

  private page(
    capture: Capture,
    page: FilesPage,
    limit: number,
    path?: string,
    maxBytes = 256 * 1024,
  ): CapturedFilesPage | FileInspectError {
    const start = (page.nextCursor ?? page.matched) - page.returned;
    const assemble = (count: number, omit = false): CapturedFilesPage => {
      const cursor = start + (omit ? 1 : count);
      const nextCursor = cursor < page.matched ? cursor : null;
      let nextContinuation: string | null = null;
      if (nextCursor !== null) {
      const payload = Buffer.from(JSON.stringify({
        v: 1,
        owner: this.owner,
        snapshot: capture.id,
        cursor: nextCursor,
        limit: Math.min(1000, Math.max(1, limit)),
        path,
        maxBytes,
      })).toString("base64url");
      nextContinuation = `${payload}.${createHmac("sha256", this.key).update(payload).digest("base64url")}`;
      }
      return {
      ...page,
      ...(capture.index.manifest ? { manifest: structuredClone(capture.index.manifest) } : {}),
      files: page.files.slice(0, count),
      returned: count,
      nextCursor,
      snapshotId: capture.id,
      nextContinuation,
      expiresAt: capture.expiresAt,
      freshness: "not-checked",
      complete: capture.index.complete,
      ...(capture.index.omittedPaths ? { omittedPaths: [...capture.index.omittedPaths] } : {}),
      ...(omit ? { omitted: { reason: "row_too_large", count: 1, fileIndex: page.files[0].index } } : {}),
      };
    };
    const full = assemble(page.returned);
    if (Buffer.byteLength(JSON.stringify(full)) <= maxBytes) return full;
    let best: CapturedFilesPage | undefined;
    let low = 1;
    let high = page.returned - 1;
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const candidate = assemble(count);
      if (Buffer.byteLength(JSON.stringify(candidate)) <= maxBytes) {
        best = candidate;
        low = count + 1;
      } else high = count - 1;
    }
    if (best) return best;
    const omission = assemble(0, page.returned > 0);
    if (Buffer.byteLength(JSON.stringify(omission)) <= maxBytes) return omission;
    return fileInspectError(413, "response_too_large", "Snapshot metadata exceeds maxBytes; increase the budget or narrow the filter.");
  }
}
