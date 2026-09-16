// @vitest-environment node
import { basename, join } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({
  readError: null as Error | null,
  openError: null as Error | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (path: Parameters<typeof actual.readFile>[0], ...rest: any[]) => {
      if (basename(String(path)) === "comments.json" && faults.readError) throw faults.readError;
      return actual.readFile(path, ...(rest as [any]));
    },
    open: async (path: Parameters<typeof actual.open>[0], ...rest: any[]) => {
      if (basename(String(path)).startsWith(".comments-") && faults.openError) throw faults.openError;
      return actual.open(path, ...(rest as [any]));
    },
  };
});

import { FileCommentStore } from "../lib/comments.js";

let tempDir: string;

const comment = {
  id: "comment-1",
  filePath: "src/index.ts",
  side: "additions" as const,
  lineNumber: 1,
  lineContent: "new",
  body: "keep this comment",
  status: "open" as const,
  createdAt: 1,
  replies: [{ id: "reply-1", body: "reply", createdAt: 2, role: "agent" as const }],
};

function error(code: string): Error {
  const value = new Error(code);
  Object.assign(value, { code });
  return value;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "diffing-comments-durability-"));
  faults.readError = null;
  faults.openError = null;
});

afterEach(() => {
  faults.readError = null;
  faults.openError = null;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("FileCommentStore durability", () => {
  it("treats a missing comments file as a fresh empty store", async () => {
    await expect(new FileCommentStore(tempDir).getAll()).resolves.toEqual([]);
  });

  it("rejects corrupt JSON and preserves exact bytes after an attempted add", async () => {
    const bytes = "{\"broken\":";
    writeFileSync(join(tempDir, "comments.json"), bytes);
    const store = new FileCommentStore(tempDir);
    await expect(store.getAll()).rejects.toThrow();
    await expect(store.add(comment)).rejects.toThrow();
    expect(readFileSync(join(tempDir, "comments.json"), "utf8")).toBe(bytes);
  });

  it("rejects structurally invalid JSON and preserves it after an attempted add", async () => {
    const bytes = JSON.stringify({ comments: [] });
    writeFileSync(join(tempDir, "comments.json"), bytes);
    const store = new FileCommentStore(tempDir);
    await expect(store.getAll()).rejects.toThrow();
    await expect(store.add(comment)).rejects.toThrow();
    expect(readFileSync(join(tempDir, "comments.json"), "utf8")).toBe(bytes);
  });

  it("propagates an injected comments read EACCES instead of returning an empty list", async () => {
    faults.readError = error("EACCES");
    await expect(new FileCommentStore(tempDir).getAll()).rejects.toMatchObject({ code: "EACCES" });
  });

  it.each(["ENOSPC", "EACCES"])("rejects an atomic temp-file open failure and preserves prior comments (%s)", async (code) => {
    const store = new FileCommentStore(tempDir);
    await expect(store.add(comment)).resolves.toEqual(comment);
    const before = readFileSync(join(tempDir, "comments.json"), "utf8");
    faults.openError = error(code);
    await expect(store.add({ ...comment, id: "comment-2" })).rejects.toMatchObject({ code });
    faults.openError = null;
    await expect(store.getAll()).resolves.toEqual([comment]);
    expect(readFileSync(join(tempDir, "comments.json"), "utf8")).toBe(before);
  });

  it("preserves body and replies after a successful reopen", async () => {
    await expect(new FileCommentStore(tempDir).add(comment)).resolves.toEqual(comment);
    await expect(new FileCommentStore(tempDir).getAll()).resolves.toEqual([comment]);
  });
});
