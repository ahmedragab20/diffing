import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  indexFiles,
  type AgentDiffIndex,
  type FilesPage,
} from "./agent-diff-index.js";

const cursorSchema = z.object({
  v: z.literal(1),
  owner: z.uuid(),
  snapshot: z.uuid(),
  cursor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(1000),
  path: z.string().max(4096).optional(),
}).strict();

export interface FileInspectError {
  status: 400 | 409 | 410 | 413;
  code:
    | "invalid_continuation"
    | "snapshot_expired"
    | "snapshot_too_large"
    | "continuation_required"
    | "stale_generation";
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
  index: AgentDiffIndex;
  bytes: number;
  expiresAt: number;
}

export interface CapturedFilesPage extends FilesPage {
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

  start(index: AgentDiffIndex, cursor = 0, limit = 100, path?: string) {
    const page = indexFiles(index, cursor, limit, path);
    if ("status" in page) return page;
    this.prune();
    let capture = [...this.captures.values()].find((entry) => entry.index === index);
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
      capture = {
        id: randomUUID(),
        index,
        bytes,
        expiresAt: this.now() + (this.options.ttlMs ?? 5 * 60_000),
      };
      this.captures.set(capture.id, capture);
      this.bytes += bytes;
    }
    return this.page(capture, page, limit, path);
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
    return this.page(capture, page, decoded.limit, decoded.path);
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
  ): CapturedFilesPage {
    let nextContinuation: string | null = null;
    if (page.nextCursor !== null) {
      const payload = Buffer.from(JSON.stringify({
        v: 1,
        owner: this.owner,
        snapshot: capture.id,
        cursor: page.nextCursor,
        limit: Math.min(1000, Math.max(1, limit)),
        path,
      })).toString("base64url");
      nextContinuation = `${payload}.${createHmac("sha256", this.key).update(payload).digest("base64url")}`;
    }
    return {
      ...page,
      snapshotId: capture.id,
      nextContinuation,
      expiresAt: capture.expiresAt,
      freshness: "not-checked",
      complete: capture.index.complete,
      ...(capture.index.omittedPaths ? { omittedPaths: capture.index.omittedPaths } : {}),
    };
  }
}
