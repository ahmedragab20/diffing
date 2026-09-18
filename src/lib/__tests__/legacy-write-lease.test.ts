// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileCommentStore } from "../comments.js";
import { FilePlanStore } from "../plans.js";
import { FileViewedStore } from "../viewed-files.js";
import { withLegacyWriteLease } from "../legacy-write-lease.js";

const directories: string[] = [];
const comment = (id: string) => ({
  id, filePath: "src/example.ts", side: "additions" as const, lineNumber: 1,
  lineContent: "added", body: id, status: "open" as const, createdAt: 1, replies: [],
});

async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "diffing-legacy-lease-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("legacy write lease and authority fence", () => {
  it("merges viewed progress and plan writes across independent instances", async () => {
    const shared = await directory();
    const first = new FileViewedStore(shared);
    const second = new FileViewedStore(shared);
    await first.toggle("local", "first.ts", true);
    await second.toggle("local", "second.ts", true);
    expect(await first.list("local")).toEqual(["first.ts", "second.ts"]);
    await first.toggle("local", "first.ts", false);
    expect(await second.list("local")).toEqual(["second.ts"]);
    const a = new FilePlanStore(shared);
    const b = new FilePlanStore(shared);
    await Promise.all([a.upsert({ title: "first", body: "one" }), b.upsert({ title: "second", body: "two" })]);
    expect((await a.getAll()).map((plan) => plan.title).sort()).toEqual(["first", "second"]);
  });

  it("serializes concurrent comment writers and keeps independent stores separate", async () => {
    const shared = await directory();
    const first = new FileCommentStore(shared);
    const second = new FileCommentStore(shared);
    await Promise.all([first.add(comment("first")), second.add(comment("second"))]);
    await expect(first.getAll()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "first" }), expect.objectContaining({ id: "second" })]));

    const leftDir = await directory();
    const rightDir = await directory();
    await Promise.all([new FileCommentStore(leftDir).add(comment("left")), new FileCommentStore(rightDir).add(comment("right"))]);
    await expect(new FileCommentStore(leftDir).getAll()).resolves.toEqual([expect.objectContaining({ id: "left" })]);
    await expect(new FileCommentStore(rightDir).getAll()).resolves.toEqual([expect.objectContaining({ id: "right" })]);
  });

  it("rejects classic reads and writes after any review authority marker, preserving original bytes", async () => {
    const dir = await directory();
    const commentsBytes = JSON.stringify([comment("existing")]);
    const plansBytes = JSON.stringify([]);
    const viewedBytes = JSON.stringify({ local: { files: { "src/example.ts": "fp" } } });
    await Promise.all([
      writeFile(join(dir, "comments.json"), commentsBytes),
      writeFile(join(dir, "plans.json"), plansBytes),
      writeFile(join(dir, "viewed.json"), viewedBytes),
      writeFile(join(dir, "review-authority.json"), JSON.stringify({ version: 999, unknown: true })),
    ]);
    const before = await Promise.all([readFile(join(dir, "comments.json")), readFile(join(dir, "plans.json")), readFile(join(dir, "viewed.json"))]);
    const comments = new FileCommentStore(dir);
    const plans = new FilePlanStore(dir);
    const viewed = new FileViewedStore(dir);
    await expect(comments.getAll()).rejects.toMatchObject({ code: "review_core_required" });
    await expect(comments.add(comment("new"))).rejects.toMatchObject({ code: "review_core_required" });
    await expect(plans.getAll()).rejects.toMatchObject({ code: "review_core_required" });
    await expect(plans.upsert({ title: "new", body: "new" })).rejects.toMatchObject({ code: "review_core_required" });
    await expect(viewed.list("local")).rejects.toMatchObject({ code: "review_core_required" });
    await expect(viewed.toggle("local", "src/new.ts", true, "new-fp")).rejects.toMatchObject({ code: "review_core_required" });
    await expect(readFile(join(dir, "comments.json"))).resolves.toEqual(before[0]);
    await expect(readFile(join(dir, "plans.json"))).resolves.toEqual(before[1]);
    await expect(readFile(join(dir, "viewed.json"))).resolves.toEqual(before[2]);
  });

  it("enforces exclusive lease ownership, releases after callback failure, and reacquires after release", async () => {
    const dir = await directory();
    let release!: () => void;
    let held!: () => void;
    const heldReady = new Promise<void>((resolve) => { held = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const first = withLegacyWriteLease(dir, async () => {
      held();
      await released;
      return "held";
    }, 0);
    await heldReady;
    await expect(withLegacyWriteLease(dir, async () => "blocked", 0)).rejects.toMatchObject({ code: "legacy_store_busy" });
    release();
    await expect(first).resolves.toBe("held");
    await expect(withLegacyWriteLease(dir, async () => "reacquired", 0)).resolves.toBe("reacquired");
    await expect(withLegacyWriteLease(dir, async () => { throw new Error("callback failed"); }, 0)).rejects.toThrow("callback failed");
    await expect(withLegacyWriteLease(dir, async () => "after failure", 0)).resolves.toBe("after failure");
  });
});
