import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { z } from "zod";
import { findReviewStoreTuiBinary, nativeFileEnvironment } from "./find-tui-binary.js";
import { canonicalReviewJson, ReviewStoreError, REVIEW_STORE_LIMITS, reviewEventSchema, reviewTransactionSchema, type ReviewStore, type ReviewTransaction, type ReviewWrite } from "./review-store.js";

const FRAME_BYTES = 512 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const errorSchema = z.object({ code: z.enum(["invalid_request", "version_conflict", "idempotency_conflict", "corrupt_store", "unsupported_version", "store_limit", "outcome_unknown", "owner_busy", "io_error", "migration_required", "missing_store"]) }).strict();
const pageSchema = z.object({ records: z.array(reviewTransactionSchema).max(1000), latest: z.number().int().nonnegative().max(REVIEW_STORE_LIMITS.records), next: z.number().int().positive().nullable() }).strict();
const readySchema = z.object({ protocol: z.literal(1), ok: z.literal(true), version: z.number().int().nonnegative().max(REVIEW_STORE_LIMITS.records), sqliteVersion: z.string().min(1).max(100) }).strict();
const failedSchema = z.object({ protocol: z.literal(1), ok: z.literal(false), error: errorSchema }).strict();
const replySchema = z.discriminatedUnion("ok", [
  z.object({ protocol: z.literal(1), id: z.number().int().positive(), ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ protocol: z.literal(1), id: z.number().int().positive(), ok: z.literal(false), error: errorSchema }).strict(),
]);

/** One request at a time, bounded frames/deadlines, no retry after uncertain I/O. */
class StoreRpc {
  private buffer = Buffer.alloc(0);
  private nextId = 0;
  private failed = false;
  private spawned = false;
  private pending?: { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly closed: Promise<void>;
  readonly ready: Promise<unknown>;

  constructor(binary: string, directory: string, private readonly timeoutMs: number) {
    this.child = spawn(binary, ["--review-store-rpc", directory], { stdio: "pipe", windowsHide: true, env: nativeFileEnvironment() });
    this.ready = this.wait();
    this.child.stdout.on("data", (chunk: Buffer) => {
      if (this.failed) return;
      if (this.buffer.length + chunk.length > FRAME_BYTES) { this.fail(); return; }
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const newline = this.buffer.indexOf(10);
      if (newline < 0) return;
      // There can be no unsolicited second reply: requests are serialized.
      if (newline !== this.buffer.length - 1 || !this.pending) { this.fail(); return; }
      try {
        const value: unknown = JSON.parse(this.buffer.subarray(0, newline).toString("utf8"));
        this.buffer = Buffer.alloc(0);
        const pending = this.pending;
        this.pending = undefined;
        clearTimeout(pending.timer);
        pending.resolve(value);
      } catch { this.fail(); }
    });
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.fail());
    this.child.stdout.on("error", () => this.fail());
    this.child.once("spawn", () => { this.spawned = true; });
    // A process that never started cannot have committed a mutation. Preserve
    // unknown outcomes for failures after launch, where writes may have run.
    this.child.on("error", () => this.fail(this.spawned ? "outcome_unknown" : "native_unavailable"));
    this.closed = new Promise((resolve) => this.child.once("close", () => { this.fail(); resolve(); }));
  }

  private wait(): Promise<unknown> {
    if (this.failed || this.pending) return Promise.reject(new ReviewStoreError("outcome_unknown"));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => this.fail(), this.timeoutMs) };
    });
  }

  async request(op: unknown): Promise<unknown> {
    const id = ++this.nextId;
    const frame = JSON.stringify({ id, op }) + "\n";
    if (Buffer.byteLength(frame) > FRAME_BYTES || !Number.isSafeInteger(id)) throw new ReviewStoreError("invalid_request");
    const reply = this.wait();
    if (!this.failed) this.child.stdin.write(frame, (error) => { if (error) this.fail(); });
    const parsed = replySchema.safeParse(await reply);
    if (!parsed.success || parsed.data.id !== id) { this.fail(); throw new ReviewStoreError("outcome_unknown"); }
    if (!parsed.data.ok) throw new ReviewStoreError(parsed.data.error.code);
    return parsed.data.result;
  }

  private fail(code: "outcome_unknown" | "native_unavailable" = "outcome_unknown") {
    this.failed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new ReviewStoreError(code));
      this.pending = undefined;
    }
    this.child.kill();
  }

  assertOpen() { if (this.failed) throw new ReviewStoreError("outcome_unknown"); }
  async close() { this.fail(); await this.closed; }
}

/** SQLite driver under qualification; no legacy store is converted implicitly. */
export class SqliteReviewStore {
  private records: ReviewTransaction[] = [];
  private keys = new Map<string, ReviewTransaction>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private poisoned = false;
  private bytes = 0;
  readonly recovery = null;

  private constructor(private readonly rpc: StoreRpc, private readonly directory: string, readonly sqliteVersion: string, private readonly io: { beforeAppend?: () => Promise<void>; afterFlush?: () => Promise<void> }) {}

  static async open(directory: string, options: { binary?: string; timeoutMs?: number; io?: SqliteReviewStore["io"] } = {}): Promise<SqliteReviewStore> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new ReviewStoreError("invalid_request");
    const binary = options.binary ?? await findReviewStoreTuiBinary(import.meta.url);
    if (!binary) throw new ReviewStoreError("native_unavailable");
    const rpc = new StoreRpc(binary, resolve(directory), timeoutMs);
    try {
      const startup = await rpc.ready;
      const failure = failedSchema.safeParse(startup);
      if (failure.success) throw new ReviewStoreError(failure.data.error.code);
      const ready = readySchema.safeParse(startup);
      if (!ready.success) throw new ReviewStoreError("native_unavailable");
      const store = new SqliteReviewStore(rpc, resolve(directory), ready.data.sqliteVersion, options.io ?? {});
      do {
        const page = pageSchema.parse(await rpc.request({ kind: "read", after: store.version, limit: 1000 }));
        if (page.latest !== ready.data.version || (!page.records.length && store.version !== page.latest)) throw new ReviewStoreError("corrupt_store");
        for (const record of page.records) store.accept(record);
        if (page.next !== (store.version < page.latest ? store.version : null)) throw new ReviewStoreError("corrupt_store");
      } while (store.version < ready.data.version);
      return store;
    } catch (error) { await rpc.close(); throw error; }
  }

  get version() { return this.records.length; }

  private accept(record: ReviewTransaction) {
    const { checksum, ...body } = record;
    const bytes = Buffer.byteLength(JSON.stringify(record)) + 1;
    if (hash(canonicalReviewJson(body)) !== checksum || record.sequence !== this.version + 1 || record.previous !== (this.records.at(-1)?.checksum ?? null) || this.keys.has(record.key)) throw new ReviewStoreError("corrupt_store");
    if (bytes > REVIEW_STORE_LIMITS.recordBytes || this.bytes + bytes > REVIEW_STORE_LIMITS.journalBytes || this.version >= REVIEW_STORE_LIMITS.records) throw new ReviewStoreError("store_limit");
    this.records.push(record);
    this.keys.set(record.key, record);
    this.bytes += bytes;
  }

  read(after = 0, limit = 100): ReturnType<ReviewStore["read"]> {
    this.assertOpen();
    if (!Number.isSafeInteger(after) || after < 0 || after > this.version || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ReviewStoreError("invalid_request");
    const records: ReviewTransaction[] = [];
    for (const record of this.records.slice(after, after + limit)) {
      const end = after + records.length + 1;
      if (Buffer.byteLength(JSON.stringify({ records: [...records, record], latest: this.version, next: end < this.version ? end : null })) > REVIEW_STORE_LIMITS.replayBytes) break;
      records.push(record);
    }
    const end = after + records.length;
    return { records: structuredClone(records), latest: this.version, next: end < this.version ? end : null };
  }

  transact(request: ReviewWrite, produce: Parameters<ReviewStore["transact"]>[1]): Promise<ReviewTransaction> {
    return this.enqueue(async () => {
      this.assertOpen();
      const parsed = z.object({ key: z.string().min(1).max(200), expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), input: z.json() }).strict().safeParse(request);
      if (!parsed.success) throw new ReviewStoreError("invalid_request");
      const write = structuredClone(parsed.data);
      const input = canonicalReviewJson({ expectedVersion: write.expectedVersion, input: write.input });
      if (Buffer.byteLength(input) > REVIEW_STORE_LIMITS.recordBytes) throw new ReviewStoreError("store_limit");
      const requestHash = hash(input);
      const existing = this.keys.get(write.key);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ReviewStoreError("idempotency_conflict", this.version);
        return structuredClone(existing);
      }
      if (write.expectedVersion !== this.version) throw new ReviewStoreError("version_conflict", this.version);
      const effect = z.object({ events: z.array(reviewEventSchema).max(100), result: z.json() }).strict().safeParse(await produce(structuredClone(this.records)));
      if (!effect.success) throw new ReviewStoreError("invalid_request");
      const body = { version: 1 as const, sequence: this.version + 1, previous: this.records.at(-1)?.checksum ?? null, key: write.key, requestHash, ...effect.data };
      const record = reviewTransactionSchema.parse({ ...body, checksum: hash(canonicalReviewJson(body)) });
      const bytes = Buffer.byteLength(JSON.stringify(record)) + 1;
      if (bytes > REVIEW_STORE_LIMITS.recordBytes || this.bytes + bytes > REVIEW_STORE_LIMITS.journalBytes || this.version >= REVIEW_STORE_LIMITS.records) throw new ReviewStoreError("store_limit");
      await this.io.beforeAppend?.();
      try {
        const stored = reviewTransactionSchema.parse(await this.rpc.request({ kind: "append", record }));
        if (canonicalReviewJson(stored) !== canonicalReviewJson(record)) throw new Error("Mismatched acknowledgement");
        await this.io.afterFlush?.();
        this.accept(stored);
        return structuredClone(stored);
      } catch {
        this.poisoned = true;
        throw new ReviewStoreError("outcome_unknown", this.version);
      }
    });
  }

  compact(): Promise<{ backup: string }> {
    return this.enqueue(async () => {
      this.assertOpen();
      try {
        const result = z.object({ backup: z.string().regex(/^review\.backup-[a-f0-9]{64}\.sqlite$/) }).strict().parse(await this.rpc.request({ kind: "compact" }));
        return { backup: join(this.directory, result.backup) };
      } catch { this.poisoned = true; throw new ReviewStoreError("outcome_unknown", this.version); }
    });
  }

  close(): Promise<void> { return this.enqueue(async () => { this.closed = true; await this.rpc.close(); }); }
  private assertOpen() {
    if (this.closed) throw new ReviewStoreError("store_closed");
    if (this.poisoned) throw new ReviewStoreError("outcome_unknown", this.version);
    this.rpc.assertOpen();
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
