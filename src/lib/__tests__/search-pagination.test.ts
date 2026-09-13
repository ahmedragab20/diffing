// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  create: vi.fn(),
  fileSearch: vi.fn(),
  grep: vi.fn(),
  waitForScan: vi.fn(),
  isScanning: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("@ff-labs/fff-node", () => ({ FileFinder: { create: native.create } }));
vi.mock("node:fs", () => ({ mkdirSync: vi.fn() }));
vi.mock("../git.js", () => ({
  getRepoRoot: () => "/repo",
  getProjectStorageDir: () => "/storage",
}));

import {
  closeSearch,
  mergeSearchResponses,
  searchContent,
  searchFiles,
  searchSymbols,
} from "../search.js";

const fileHit = (path: string) => ({
  relativePath: path,
  fileName: path.split("/").pop(),
  gitStatus: "",
});
const grepHit = (path: string, line: number, content: string) => ({
  relativePath: path,
  fileName: path.split("/").pop(),
  lineNumber: line,
  col: 0,
  lineContent: content,
  matchRanges: [[0, 3]],
  gitStatus: "",
});
const ok = <T>(value: T) => ({ ok: true, value });

beforeEach(() => {
  closeSearch();
  vi.clearAllMocks();
  native.fileSearch.mockReturnValue(
    ok({ items: [], scores: [], totalMatched: 0 }),
  );
  native.grep.mockReturnValue(
    ok({ items: [], totalMatched: 0, nextCursor: null }),
  );
  native.create.mockReturnValue(
    ok({
      fileSearch: native.fileSearch,
      grep: native.grep,
      waitForScan: native.waitForScan.mockResolvedValue(undefined),
      isScanning: native.isScanning.mockReturnValue(false),
      destroy: native.destroy,
    }),
  );
});

describe("search pagination and path filtering", () => {
  it("pages filtered fileSearch results until the requested target is found", async () => {
    const unrelated = Array.from({ length: 1000 }, (_, i) =>
      fileHit(`other/${i}.ts`),
    );
    native.fileSearch
      .mockReturnValueOnce(
        ok({
          items: unrelated,
          scores: unrelated.map(() => ({ matchType: "fuzzy" })),
          totalMatched: 1001,
        }),
      )
      .mockReturnValueOnce(
        ok({
          items: [fileHit("src/target.ts")],
          scores: [{ exactMatch: true }],
          totalMatched: 1001,
        }),
      );

    const result = await searchFiles("target", { paths: ["src/target.ts"] });
    expect(result.items.map((item) => item.path)).toEqual(["src/target.ts"]);
    expect(native.fileSearch).toHaveBeenCalledTimes(2);
    expect(native.fileSearch).toHaveBeenNthCalledWith(
      2,
      "target",
      expect.objectContaining({ pageIndex: 1 }),
    );
  });

  it("returns no hits and does not search for an empty path set", async () => {
    expect(await searchFiles("target", { paths: [] })).toMatchObject({
      items: [],
      total: 0,
    });
    expect(await searchContent("target", { paths: [] })).toMatchObject({
      items: [],
      total: 0,
    });
    expect(await searchSymbols("target", { paths: [] })).toMatchObject({
      items: [],
      total: 0,
    });
    expect(native.fileSearch).not.toHaveBeenCalled();
    expect(native.grep).not.toHaveBeenCalled();
  });

  it("pages grep results for content and applies the returned result limit", async () => {
    const unrelated = Array.from({ length: 1000 }, (_, i) =>
      grepHit(`other/${i}.ts`, i + 1, "unrelated"),
    );
    native.grep
      .mockReturnValueOnce(
        ok({
          items: unrelated,
          totalMatched: 1003,
          nextCursor: { _offset: 1000 },
        }),
      )
      .mockReturnValueOnce(
        ok({
          items: [
            grepHit("src/target.ts", 10, "needle one"),
            grepHit("src/target.ts", 20, "needle two"),
            grepHit("src/target.ts", 30, "needle three"),
          ],
          totalMatched: 3,
          nextCursor: null,
        }),
      );

    const result = await searchContent("needle", {
      paths: ["src/target.ts"],
      limit: 2,
    });
    expect(result.items.map((item) => item.line)).toEqual([10, 20]);
    expect(result.hasMore).toBe(true);
    expect(native.grep).toHaveBeenCalledTimes(2);
    expect(native.grep).toHaveBeenNthCalledWith(
      2,
      "needle",
      expect.objectContaining({ cursor: { _offset: 1000 } }),
    );
  });

  it("does not treat a clipped full page as a definitive empty symbol result", async () => {
    native.grep.mockReturnValueOnce(
      ok({
        items: Array.from({ length: 1000 }, (_, i) =>
          grepHit("src/target.ts", i + 1, "return target()"),
        ),
        totalMatched: 1000,
        nextCursor: null,
      }),
    );

    const result = await searchSymbols("target", { paths: ["src/target.ts"] });
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(true);
  });

  it("pages past non-definition grep hits to find a target symbol definition", async () => {
    const unrelated = Array.from({ length: 1000 }, (_, i) =>
      grepHit(`other/${i}.ts`, i + 1, "return target()"),
    );
    native.grep
      .mockReturnValueOnce(
        ok({
          items: unrelated,
          totalMatched: 1001,
          nextCursor: { _offset: 1000 },
        }),
      )
      .mockReturnValueOnce(
        ok({
          items: [grepHit("src/target.ts", 42, "export function target() {}")],
          totalMatched: 1,
          nextCursor: null,
        }),
      );

    const result = await searchSymbols("target", { paths: ["src/target.ts"] });
    expect(result.items.map((item) => item.line)).toEqual([42]);
    expect(result.items[0].name).toBe("target");
    expect(native.grep).toHaveBeenCalledTimes(2);
  });

  it("preserves hasMore when merging scope responses", () => {
    const response = mergeSearchResponses(
      { scope: "files", items: [], total: 0, indexing: false, hasMore: true },
      { scope: "text", items: [], total: 0, indexing: false },
      { scope: "symbols", items: [], total: 0, indexing: false },
    );
    expect(response.hasMore).toBe(true);
  });
});
