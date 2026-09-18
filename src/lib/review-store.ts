import { createHash, randomUUID } from "node:crypto";
import { open, readFile, stat, copyFile, rename, link, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ReviewOwner, syncDirectory } from "./review-owner.js";
import { REVIEW_STORE_LIMITS, reviewEventSchema as eventSchema, reviewTransactionSchema, type ReviewEvent, type ReviewTransaction } from "./review-store-contract.js";
export { REVIEW_STORE_LIMITS, reviewEventSchema, reviewTransactionSchema, type ReviewEvent, type ReviewTransaction } from "./review-store-contract.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const transactionSchema = reviewTransactionSchema;
type Json = z.infer<ReturnType<typeof z.json>>;

export class ReviewStoreError extends Error {
  constructor(
    readonly code: "invalid_request" | "version_conflict" | "idempotency_conflict" | "corrupt_store" | "unsupported_version" | "recovery_required" | "store_limit" | "outcome_unknown" | "store_closed" | "owner_busy" | "io_error" | "native_unavailable" | "migration_required" | "missing_store",
    readonly sequence?: number,
  ) { super(code); }
}

/** Stable payload identity independent of object property insertion order. */
export function canonicalReviewJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalReviewJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalReviewJson(value[key])}`).join(",")}}`;
}

export interface ReviewWrite {
  key: string;
  expectedVersion: number;
  input: Json;
}

/**
 * Versioned journal driver. Only complete, flushed transactions are acknowledged.
 * No application JSON mirror is writable. The producer runs after deduplication
 * and version checks, and must have no external side effects.
 */
export class ReviewStore {
  private records: ReviewTransaction[] = [];
  private keys = new Map<string, ReviewTransaction>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private poisoned = false;
  private bytes = 0;
  private readonly journal: string;
  readonly recovery: { backup: string; discardedBytes: number } | null;

  private constructor(
    private readonly directory: string,
    private readonly owner: ReviewOwner,
    recovery: ReviewStore["recovery"],
    private readonly io: {
      beforeAppend?: () => Promise<void>; beforeFlush?: () => Promise<void>; afterFlush?: () => Promise<void>;
      afterCompactFlush?: () => Promise<void>; beforeCompactRename?: () => Promise<void>; afterCompactRename?: () => Promise<void>;
    },
  ) {
    this.journal = join(directory, "review.jsonl");
    this.recovery = recovery;
  }

  static async open(directory: string, options: {
    repairTornTail?: boolean;
    /** Deterministic fault boundaries for durability qualification. */
    io?: ReviewStore["io"];
  } = {}): Promise<ReviewStore> {
    const owner = await ReviewOwner.acquire(directory);
    try {
      const journal = join(directory, "review.jsonl");
      const marker = join(directory, "store.json");
      let initialized = false;
      try {
        const header: unknown = JSON.parse(await readFile(marker, "utf8"));
        if (header && typeof header === "object" && "version" in header && header.version !== 1) throw new ReviewStoreError("unsupported_version");
        if (!z.object({ version: z.literal(1) }).strict().safeParse(header).success) throw new ReviewStoreError("corrupt_store");
        initialized = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          if (error instanceof SyntaxError) throw new ReviewStoreError("corrupt_store");
          throw error;
        }
      }
      let bytes = Buffer.alloc(0);
      let exists = true;
      try {
        const info = await stat(journal);
        if (info.size > REVIEW_STORE_LIMITS.journalBytes) throw new ReviewStoreError("store_limit");
        bytes = await readFile(journal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (initialized) throw new ReviewStoreError("corrupt_store");
        exists = false;
      }
      const tail = bytes.length && bytes.at(-1) !== 10 ? bytes.lastIndexOf(10) + 1 : bytes.length;
      // Validate all complete records before making any recovery writes.
      const records: ReviewTransaction[] = [];
      const keys = new Set<string>();
      for (const line of bytes.subarray(0, tail).toString("utf8").split("\n").slice(0, -1)) {
        if (Buffer.byteLength(line) > REVIEW_STORE_LIMITS.recordBytes) throw new ReviewStoreError("store_limit");
        let value: unknown;
        try { value = JSON.parse(line); } catch { throw new ReviewStoreError("corrupt_store", records.length); }
        if (value && typeof value === "object" && "version" in value && value.version !== 1) throw new ReviewStoreError("unsupported_version", records.length);
        const parsed = transactionSchema.safeParse(value);
        if (!parsed.success) throw new ReviewStoreError("corrupt_store", records.length);
        const { checksum, ...record } = parsed.data;
        if (hash(canonicalReviewJson(record)) !== checksum || record.previous !== (records.at(-1)?.checksum ?? null) || record.sequence !== records.length + 1 || keys.has(record.key)) throw new ReviewStoreError("corrupt_store", records.length);
        records.push(parsed.data);
        keys.add(record.key);
        if (records.length > REVIEW_STORE_LIMITS.records) throw new ReviewStoreError("store_limit");
      }
      let recovery: ReviewStore["recovery"] = null;
      if (tail !== bytes.length) {
        // Even without a terminator, recognizable newer state is never repaired
        // by an older driver. Its original bytes remain authoritative.
        let trailing: unknown;
        try { trailing = JSON.parse(bytes.subarray(tail).toString("utf8")); } catch { /* torn JSON */ }
        if (trailing && typeof trailing === "object" && "version" in trailing && trailing.version !== 1) throw new ReviewStoreError("unsupported_version", records.length);
        if (!options.repairTornTail) throw new ReviewStoreError("recovery_required", records.length);
        const backup = join(directory, `review.recovery-${randomUUID()}.jsonl`);
        await copyFile(journal, backup, constants.COPYFILE_EXCL);
        const backupFile = await open(backup, "r+");
        try { await backupFile.sync(); } finally { await backupFile.close(); }
        await syncDirectory(directory);
        const handle = await open(journal, "r+");
        try { await handle.truncate(tail); await handle.sync(); } finally { await handle.close(); }
        recovery = { backup, discardedBytes: bytes.length - tail };
      }
      // Reconcile complete records left by a lost flush/response before exposing
      // their committed results. New journal creation also flushes its directory.
      const handle = await open(journal, exists ? "r+" : "wx", 0o600);
      try { await handle.sync(); } finally { await handle.close(); }
      await syncDirectory(directory);
      if (!initialized) {
        const header = await open(marker, "wx", 0o600);
        try { await header.writeFile('{"version":1}'); await header.sync(); } finally { await header.close(); }
        await syncDirectory(directory);
      }
      const store = new ReviewStore(directory, owner, recovery, options.io ?? {});
      store.records = records;
      store.keys = new Map(records.map((record) => [record.key, record]));
      store.bytes = tail;
      return store;
    } catch (error) {
      await owner.close();
      throw error;
    }
  }

  get version(): number { return this.records.length; }

  read(after = 0, limit = 100): { records: ReviewTransaction[]; latest: number; next: number | null } {
    this.assertOpen();
    if (!Number.isSafeInteger(after) || after < 0 || after > this.version || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ReviewStoreError("invalid_request");
    const result: ReviewTransaction[] = [];
    for (const record of this.records.slice(after, after + limit)) {
      const end = after + result.length + 1;
      if (Buffer.byteLength(JSON.stringify({ records: [...result, record], latest: this.version, next: end < this.version ? end : null })) > REVIEW_STORE_LIMITS.replayBytes) break;
      result.push(record);
    }
    const end = after + result.length;
    return { records: structuredClone(result), latest: this.version, next: end < this.version ? end : null };
  }

  transact(request: ReviewWrite, produce: (history: readonly ReviewTransaction[]) => { events: ReviewEvent[]; result: Json } | Promise<{ events: ReviewEvent[]; result: Json }>): Promise<ReviewTransaction> {
    return this.enqueue(async () => {
      this.assertOpen();
      const valid = z.object({ key: z.string().min(1).max(200), expectedVersion: z.number().int().nonnegative(), input: z.json() }).strict().safeParse(request);
      if (!valid.success) throw new ReviewStoreError("invalid_request");
      const write = structuredClone(valid.data);
      const input = canonicalReviewJson({ expectedVersion: write.expectedVersion, input: write.input });
      if (Buffer.byteLength(input) > REVIEW_STORE_LIMITS.recordBytes) throw new ReviewStoreError("store_limit");
      const requestHash = hash(input);
      const previous = this.keys.get(write.key);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ReviewStoreError("idempotency_conflict", this.version);
        return structuredClone(previous);
      }
      if (write.expectedVersion !== this.version) throw new ReviewStoreError("version_conflict", this.version);
      const effect = z.object({ events: z.array(eventSchema).max(100), result: z.json() }).strict().safeParse(await produce(structuredClone(this.records)));
      if (!effect.success) throw new ReviewStoreError("invalid_request");
      const record = {
        version: 1 as const, sequence: this.version + 1, previous: this.records.at(-1)?.checksum ?? null,
        key: write.key, requestHash, events: effect.data.events, result: effect.data.result,
      };
      const parsed = transactionSchema.safeParse({ ...record, checksum: hash(canonicalReviewJson(record)) });
      if (!parsed.success) throw new ReviewStoreError("invalid_request");
      const line = JSON.stringify(parsed.data) + "\n";
      const size = Buffer.byteLength(line);
      if (size > REVIEW_STORE_LIMITS.recordBytes || this.bytes + size > REVIEW_STORE_LIMITS.journalBytes || this.version >= REVIEW_STORE_LIMITS.records) throw new ReviewStoreError("store_limit");
      await this.io.beforeAppend?.();
      this.owner.assertOwned();
      const handle = await open(this.journal, constants.O_WRONLY | constants.O_APPEND);
      try {
        if ((await handle.stat()).size !== this.bytes) throw new ReviewStoreError("corrupt_store");
        await handle.writeFile(line);
        await this.io.beforeFlush?.();
        await handle.sync();
        await this.io.afterFlush?.();
      } catch {
        // No retries within this instance after an uncertain filesystem effect.
        this.poisoned = true;
        throw new ReviewStoreError("outcome_unknown", this.version);
      } finally { await handle.close(); }
      this.records.push(parsed.data);
      this.keys.set(write.key, parsed.data);
      this.bytes += size;
      return structuredClone(parsed.data);
    });
  }

  /**
   * Rewrite verified canonical records while preserving every idempotency key
   * and event. The old inode remains available as a flushed recovery backup.
   * Retention/pruning belongs to the review core and is not inferred here.
   */
  compact(): Promise<{ backup: string }> {
    return this.enqueue(async () => {
      this.assertOpen();
      const temporary = join(this.directory, `.review-${randomUUID()}.jsonl`);
      const backup = join(this.directory, `review.backup-${randomUUID()}.jsonl`);
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(this.records.map((record) => JSON.stringify(record) + "\n").join(""));
          await handle.sync();
          await this.io.afterCompactFlush?.();
        } finally { await handle.close(); }
        await link(this.journal, backup);
        await syncDirectory(this.directory);
        await this.io.beforeCompactRename?.();
        await rename(temporary, this.journal);
        await this.io.afterCompactRename?.();
        await syncDirectory(this.directory);
      } catch {
        this.poisoned = true;
        throw new ReviewStoreError("outcome_unknown", this.version);
      } finally { await unlink(temporary).catch(() => {}); }
      return { backup };
    });
  }

  close(): Promise<void> {
    return this.enqueue(async () => { this.closed = true; await this.owner.close(); });
  }

  private assertOpen(): void {
    if (this.closed) throw new ReviewStoreError("store_closed");
    if (this.poisoned) throw new ReviewStoreError("outcome_unknown", this.version);
    this.owner.assertOwned();
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
