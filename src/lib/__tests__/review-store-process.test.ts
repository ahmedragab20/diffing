// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewStore } from "../review-store.js";

const children: ChildProcess[] = [];
const directories: string[] = [];
const stores: ReviewStore[] = [];
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Child shutdown timed out")), 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.kill("SIGKILL");
  });
}
afterEach(async () => {
  for (const child of children.splice(0)) await stop(child);
  for (const store of stores.splice(0)) await store.close();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("real-process review journal recovery", () => {
  it.each(["beforeAppend", "beforeFlush", "afterFlush"] as const)("recovers once after owner death at %s", async (boundary) => {
    const directory = await mkdtemp(join(tmpdir(), "diffing-review-crash-"));
    directories.push(directory);
    const module = new URL("../review-store.ts", import.meta.url).href;
    const code = `import { ReviewStore } from ${JSON.stringify(module)};
const store = await ReviewStore.open(process.argv[1], { io: {
  ${boundary}: async () => { process.stdout.write('BOUNDARY\\n'); await new Promise(() => {}); }
}});
await store.transact({key:'request', expectedVersion:0, input:{body:'kept'}}, () => ({events:[{type:'concern.recorded', data:{body:'kept'}}],result:{id:'record-1'}}));`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, directory], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      let output = "";
      let errors = "";
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Boundary timed out: ${errors}`)); }, 5000);
      const onExit = () => { cleanup(); reject(new Error(`Child exited before boundary: ${errors}`)); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("BOUNDARY\n")) { cleanup(); resolve(); }
      };
      const onStderr = (chunk: Buffer) => { errors += chunk.toString(); };
      function cleanup() {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        child.stdout!.off("data", onData);
        child.stderr!.off("data", onStderr);
      }
      child.once("exit", onExit);
      child.once("error", onError);
      child.stdout!.on("data", onData);
      child.stderr!.on("data", onStderr);
    });
    await expect(ReviewStore.open(directory)).rejects.toMatchObject({ code: "owner_busy" });
    await stop(child);
    const store = await ReviewStore.open(directory);
    stores.push(store);
    expect(store.version).toBe(boundary === "beforeAppend" ? 0 : 1);
    const request = { key: "request", expectedVersion: 0, input: { body: "kept" } };
    const transaction = await store.transact(request, () => ({ events: [{ type: "concern.recorded", data: { body: "kept" } }], result: { id: "record-1" } }));
    expect(transaction.sequence).toBe(1);
    expect(await store.transact(request, () => { throw new Error("Duplicate producer ran"); })).toEqual(transaction);
    expect((await readFile(join(directory, "review.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it.each(["afterCompactFlush", "beforeCompactRename", "afterCompactRename"] as const)("recovers ordered committed records after compaction owner death at %s", async (boundary) => {
    const directory = await mkdtemp(join(tmpdir(), "diffing-review-compact-crash-"));
    directories.push(directory);
    const module = new URL("../review-store.ts", import.meta.url).href;
    const code = `import { ReviewStore } from ${JSON.stringify(module)};
const store = await ReviewStore.open(process.argv[1], { io: {
  ${boundary}: async () => { process.stdout.write('BOUNDARY\\n'); await new Promise(() => {}); }
}});
await store.transact({key:'request-a', expectedVersion:0, input:{body:'a'}}, () => ({events:[{type:'concern.recorded', data:{body:'a'}}],result:{id:'record-a'}}));
await store.transact({key:'request-b', expectedVersion:1, input:{body:'b'}}, () => ({events:[{type:'concern.recorded', data:{body:'b'}}],result:{id:'record-b'}}));
await store.compact();`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, directory], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      let output = "";
      let errors = "";
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Boundary timed out: ${errors}`)); }, 5000);
      const onExit = () => { cleanup(); reject(new Error(`Child exited before boundary: ${errors}`)); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onData = (chunk: Buffer) => { output += chunk.toString(); if (output.includes("BOUNDARY\n")) { cleanup(); resolve(); } };
      const onStderr = (chunk: Buffer) => { errors += chunk.toString(); };
      function cleanup() { clearTimeout(timer); child.off("exit", onExit); child.off("error", onError); child.stdout!.off("data", onData); child.stderr!.off("data", onStderr); }
      child.once("exit", onExit); child.once("error", onError); child.stdout!.on("data", onData); child.stderr!.on("data", onStderr);
    });
    await expect(ReviewStore.open(directory)).rejects.toMatchObject({ code: "owner_busy" });
    await stop(child);
    const store = await ReviewStore.open(directory);
    stores.push(store);
    const first = store.read(0, 1).records[0];
    const second = store.read(1, 1).records[0];
    expect([first.result, second.result]).toEqual([{ id: "record-a" }, { id: "record-b" }]);
    expect(store.version).toBe(2);
    expect(await store.transact({ key: "request-a", expectedVersion: 0, input: { body: "a" } }, () => { throw new Error("Duplicate producer ran"); })).toEqual(first);
    expect(await store.transact({ key: "request-b", expectedVersion: 1, input: { body: "b" } }, () => { throw new Error("Duplicate producer ran"); })).toEqual(second);
    if (boundary === "beforeCompactRename" || boundary === "afterCompactRename") {
      const backups = (await readdir(directory)).filter((name) => name.startsWith("review.backup-") && name.endsWith(".jsonl"));
      expect(backups).toHaveLength(1);
      expect(await readFile(join(directory, backups[0]))).toEqual(await readFile(join(directory, "review.jsonl")));
    }
  });
});
