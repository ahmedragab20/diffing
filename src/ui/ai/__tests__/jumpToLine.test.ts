import { describe, expect, it } from "vitest";
import { citationJumpTarget } from "../jumpToLine";

describe("citationJumpTarget", () => {
	it("maps new:<path> to the additions side", () => {
		expect(citationJumpTarget("new:src/a.ts", 4)).toEqual({
			filePath: "src/a.ts",
			line: 4,
			side: "additions",
		});
	});

	it("maps old:<path> to the deletions side", () => {
		expect(citationJumpTarget("old:src/a.ts", 12)).toEqual({
			filePath: "src/a.ts",
			line: 12,
			side: "deletions",
		});
	});

	it("does not jump for patch offsets or plan keys", () => {
		expect(citationJumpTarget("patch:0", 3)).toBeNull();
		expect(citationJumpTarget("draft", 1)).toBeNull();
		expect(citationJumpTarget("body-draft", 2)).toBeNull();
		expect(citationJumpTarget("src/a.ts", 4)).toBeNull();
		expect(citationJumpTarget("new:", 1)).toBeNull();
		expect(citationJumpTarget("old:", 1)).toBeNull();
	});

	it("requires a positive line number", () => {
		expect(citationJumpTarget("new:src/a.ts", 0)).toBeNull();
		expect(citationJumpTarget("new:src/a.ts", -1)).toBeNull();
		expect(citationJumpTarget("new:src/a.ts", Number.NaN)).toBeNull();
	});
});
