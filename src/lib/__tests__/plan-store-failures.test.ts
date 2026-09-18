// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  failRead: false,
  failPlansWrite: false,
  failSync: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (io.failRead && String(args[0]).endsWith("plans.json")) throw new Error("simulated read failure");
      return actual.readFile(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (io.failPlansWrite && String(args[0]).endsWith("plans.json")) throw new Error("simulated plans replacement failure");
      return actual.writeFile(...args);
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (io.failPlansWrite && String(args[1]).endsWith("plans.json")) throw new Error("simulated plans replacement failure");
      return actual.rename(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      if (io.failSync && String(args[0]).includes(".plans-")) file.sync = async () => { throw new Error("simulated flush failure"); };
      return file;
    },
  };
});

import { FilePlanStore } from "../plans.js";

const planInput = (title: string) => ({ title, body: `# ${title}`, source: "test", model: "test-model" });
const dirs: string[] = [];

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "diffing-plan-failures-"));
  dirs.push(dir);
  return { dir, store: new FilePlanStore(dir) };
}

afterEach(async () => {
  io.failRead = false;
  io.failPlansWrite = false;
  io.failSync = false;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("FilePlanStore failure handling", () => {
  it.each(["{", JSON.stringify({ plans: [] })])("rejects getAll and upsert for malformed plans.json (%j), preserving bytes", async (contents) => {
    const { dir, store } = await tempStore();
    const path = join(dir, "plans.json");
    await writeFile(path, contents, "utf8");
    const before = await readFile(path);
    await expect(store.getAll()).rejects.toThrow();
    await expect(store.upsert(planInput("new"))).rejects.toThrow();
    await expect(readFile(path)).resolves.toEqual(before);
  });

  it("propagates filesystem read failures instead of returning an empty store", async () => {
    const { store } = await tempStore();
    await store.upsert(planInput("existing"));
    io.failRead = true;
    await expect(store.getAll()).rejects.toThrow("simulated read failure");
  });

  it("rejects an authoritative plans.json replacement failure and preserves the prior valid file", async () => {
    const { dir, store } = await tempStore();
    const created = await store.upsert(planInput("existing"));
    const path = join(dir, "plans.json");
    const before = await readFile(path);
    io.failPlansWrite = true;
    await expect(store.setDecision(created.id, "approved", "ship it")).rejects.toThrow("simulated plans replacement failure");
    await expect(readFile(path)).resolves.toEqual(before);
  });

  it("retains both plans when concurrent upserts target the same store", async () => {
    const { store } = await tempStore();
    await Promise.all([store.upsert(planInput("first")), store.upsert(planInput("second"))]);
    await expect(store.getAll()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "first" }),
      expect.objectContaining({ title: "second" }),
    ]));
  });

  it("rejects a failed flush and allows a later decision after recovery", async () => {
    const { dir, store } = await tempStore();
    const created = await store.upsert(planInput("existing"));
    const path = join(dir, "plans.json");
    const before = await readFile(path);
    io.failSync = true;
    await expect(store.setDecision(created.id, "approved")).rejects.toThrow("simulated flush failure");
    expect(await readFile(path)).toEqual(before);
    io.failSync = false;
    await expect(store.setDecision(created.id, "changes-requested")).resolves.toMatchObject({ decision: "changes-requested" });
    expect(await new FilePlanStore(dir).get(created.id)).toMatchObject({ decision: "changes-requested" });
  });
});
