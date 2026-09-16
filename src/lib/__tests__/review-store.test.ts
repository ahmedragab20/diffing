// @vitest-environment node
import { mkdtemp, readFile, writeFile, appendFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REVIEW_STORE_LIMITS, ReviewStore } from "../review-store.js";

const directories: string[] = [];
const stores: ReviewStore[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "diffing-review-store-"));
  directories.push(path);
  return path;
}
async function open(path: string, options?: Parameters<typeof ReviewStore.open>[1]) {
  const store = await ReviewStore.open(path, options);
  stores.push(store);
  return store;
}
const write = (store: ReviewStore, key = "one", expectedVersion = 0) => store.transact(
  { key, expectedVersion, input: { body: "review this" } },
  () => ({ events: [{ type: "concern.recorded", data: { id: "concern-1", body: "review this" } }], result: { id: "concern-1" } }),
);

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("review journal durability gate", () => {
  it("replays committed transactions and deduplicates after restart without calling the producer", async () => {
    const path = await directory();
    const first = await open(path);
    const transaction = await write(first);
    await first.close();
    const second = await open(path);
    expect(second.read()).toEqual({ records: [transaction], latest: 1, next: null });
    const producer = vi.fn(() => ({ events: [], result: null }));
    expect(await second.transact({ key: "one", expectedVersion: 0, input: { body: "review this" } }, producer)).toEqual(transaction);
    expect(producer).not.toHaveBeenCalled();
    expect(second.version).toBe(1);
  });

  it("binds idempotency to normalized payload and rejects stale versions", async () => {
    const store = await open(await directory());
    const effect = () => ({ events: [], result: { committed: true } });
    const first = await store.transact({ key: "key", expectedVersion: 0, input: { a: 1, b: 2 } }, effect);
    expect(await store.transact({ key: "key", expectedVersion: 0, input: { b: 2, a: 1 } }, effect)).toEqual(first);
    await expect(store.transact({ key: "key", expectedVersion: 0, input: { a: 2, b: 2 } }, effect)).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(write(store, "other", 0)).rejects.toMatchObject({ code: "version_conflict", sequence: 1 });
    expect(store.version).toBe(1);
  });

  it("serializes competing expected-version writes and isolates returned objects", async () => {
    const store = await open(await directory());
    const results = await Promise.allSettled([write(store, "a"), write(store, "b")]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(results[1]).toMatchObject({ reason: { code: "version_conflict" } });
    const records = store.read().records;
    records[0].events.length = 0;
    expect(store.read().records[0].events).toHaveLength(1);
  });

  it.each(["ENOSPC", "EACCES"])("does not acknowledge a %s failure before append", async (code) => {
    const path = await directory();
    const store = await open(path, { io: { beforeAppend: async () => { throw Object.assign(new Error(code), { code }); } } });
    await expect(write(store)).rejects.toMatchObject({ code });
    expect(store.version).toBe(0);
    expect(await readFile(join(path, "review.jsonl"), "utf8")).toBe("");
  });

  it.each(["beforeFlush", "afterFlush"] as const)("fences an uncertain %s result, then reconciles by request key on reopen", async (boundary) => {
    const path = await directory();
    const store = await open(path, { io: { [boundary]: async () => { throw new Error("simulated I/O failure or lost acknowledgement"); } } });
    await expect(write(store)).rejects.toMatchObject({ code: "outcome_unknown" });
    await expect(write(store)).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(() => store.read()).toThrow("outcome_unknown");
    await store.close();
    const reopened = await open(path);
    const recovered = await write(reopened);
    expect(recovered.sequence).toBe(1);
    expect(reopened.read().records).toHaveLength(1);
    expect((await readFile(join(path, "review.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("requires explicit torn-tail repair, preserves original bytes, and retains preceding transactions", async () => {
    const path = await directory();
    const first = await open(path);
    const record = await write(first);
    await first.close();
    await appendFile(join(path, "review.jsonl"), '{"version":1,"partial":');
    const original = await readFile(join(path, "review.jsonl"));
    await expect(open(path)).rejects.toMatchObject({ code: "recovery_required", sequence: 1 });
    expect(await readFile(join(path, "review.jsonl"))).toEqual(original);
    const repaired = await open(path, { repairTornTail: true });
    expect(repaired.recovery?.discardedBytes).toBeGreaterThan(0);
    expect(await readFile(repaired.recovery!.backup)).toEqual(original);
    expect(repaired.read().records).toEqual([record]);
    expect((await write(repaired, "two", 1)).sequence).toBe(2);
  });

  it.each(["checksum", "middle", "blank", "newer", "newer-tail"])("refuses %s corruption without rewriting the journal", async (kind) => {
    const path = await directory();
    const store = await open(path);
    await write(store);
    await write(store, "two", 1);
    await store.close();
    const journal = join(path, "review.jsonl");
    let bytes = await readFile(journal, "utf8");
    if (kind === "checksum") bytes = bytes.replace("review this", "tampered text");
    if (kind === "middle") bytes = bytes.replace("\n", "\nnot-json\n");
    if (kind === "blank") bytes = bytes.replace("\n", "\n\n");
    if (kind === "newer") bytes = bytes.replace('"version":1', '"version":999');
    if (kind === "newer-tail") bytes += '{"version":999}';
    await writeFile(journal, bytes);
    await expect(open(path, { repairTornTail: true })).rejects.toMatchObject({ code: kind.startsWith("newer") ? "unsupported_version" : "corrupt_store" });
    expect(await readFile(journal, "utf8")).toBe(bytes);
  });

  it("does not reinterpret a missing initialized journal as a fresh review", async () => {
    const path = await directory();
    const store = await open(path);
    await write(store);
    await store.close();
    await unlink(join(path, "review.jsonl"));
    await expect(open(path)).rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("compacts with a preserved backup and replays ordered pages and deduplication", async () => {
    const path = await directory();
    const store = await open(path);
    const first = await write(store);
    const second = await write(store, "two", 1);
    const original = await readFile(join(path, "review.jsonl"));
    const { backup } = await store.compact();
    expect(await readFile(backup)).toEqual(original);
    await write(store, "three", 2);
    expect(await readFile(backup)).toEqual(original);
    await store.close();
    const reopened = await open(path);
    expect(reopened.read(0, 1)).toEqual({ records: [first], latest: 3, next: 1 });
    expect(reopened.read(1, 1)).toEqual({ records: [second], latest: 3, next: 2 });
    expect(await write(reopened)).toEqual(first);
    expect(reopened.version).toBe(3);
  });

  it("bounds replay pages by serialized bytes while returning every large record once", async () => {
    const store = await open(await directory());
    const payload = "x".repeat(160 * 1024);
    for (let sequence = 0; sequence < 5; sequence++) {
      await store.transact(
        { key: `large-${sequence}`, expectedVersion: sequence, input: { sequence } },
        () => ({ events: [{ type: "large.record", data: { sequence } }], result: { sequence, payload } }),
      );
    }
    const records = [] as number[];
    let after = 0;
    while (true) {
      const page = store.read(after, 1000);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(REVIEW_STORE_LIMITS.replayBytes);
      records.push(...page.records.map((record) => record.sequence));
      if (page.next === null) break;
      after = page.next;
    }
    expect(records).toEqual([1, 2, 3, 4, 5]);
  });
});
