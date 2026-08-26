import { describe, expect, it } from "vitest";
import { buildAiPrompt, MAX_AI_CONTEXT_BYTES } from "../context.js";
import type { AiRunRequest } from "../types.js";

function request(patch: string): AiRunRequest {
	return {
		trigger: "user",
		conversationId: "conversation-1",
		modelId: "codex/subscription/codex/gpt-test",
		surface: "diff",
		action: "review-risks",
		context: { kind: "diff", patch },
	};
}

describe("buildAiPrompt", () => {
	it("uses only the supplied review context", () => {
		const result = buildAiPrompt(request("+changed line"));
		expect(result.prompt).toContain("+changed line");
		expect(result.prompt).toContain("Do not use tools");
		expect(result.truncated).toBe(false);
	});

	it("bounds oversized context and reports truncation", () => {
		const result = buildAiPrompt(request("x".repeat(MAX_AI_CONTEXT_BYTES * 2)));
		expect(result.truncated).toBe(true);
		expect(result.prompt).toContain("[context truncated]");
		expect(Buffer.byteLength(result.prompt, "utf8")).toBeLessThan(MAX_AI_CONTEXT_BYTES + 5000);
	});

	it("keeps explicitly attached files ahead of oversized ambient context", () => {
		const input = request("x".repeat(MAX_AI_CONTEXT_BYTES * 2));
		input.context = { ...input.context, attachments: [{ path: "src/important.ts", content: "export const important = true" }] };
		const result = buildAiPrompt(input);
		expect(result.prompt).toContain("Explicitly attached files (highest-priority context)");
		expect(result.prompt).toContain("src/important.ts");
		expect(result.prompt).toContain("export const important = true");
	});

	it("prioritizes exact attached diff ranges with line metadata", () => {
		const input = request("+ambient change");
		input.context = { ...input.context, selections: [{ filePath: "src/device.ts", side: "additions", startLine: 14, endLine: 16, selectedText: "one\ntwo\nthree" }] };
		const result = buildAiPrompt(input);
		expect(result.prompt).toContain("Explicitly attached diff ranges (highest-priority review evidence)");
		expect(result.prompt).toContain("src/device.ts · additions · L14–L16");
		expect(result.prompt.indexOf("one\ntwo\nthree")).toBeLessThan(result.prompt.indexOf("## Unified diff"));
	});

	it("describes the whole review scope and treats viewport focus as a hint", () => {
		const patch = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-export const value = 1
+export const value = 2
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1 @@
+export const added = true
`;
		const input = request(patch);
		input.context = { kind: "diff", patch, repoName: "demo", branch: "feature", focusedFilePath: "src/a.ts" };
		const result = buildAiPrompt(input);
		expect(result.prompt).toContain("Scope: entire review diff");
		expect(result.prompt).toContain("Current UI focus: src/a.ts (navigation hint only");
		expect(result.prompt).toContain("Total: 2 files, 2 hunks, +2 -1");
		expect(result.prompt).toContain("[modified] src/a.ts");
		expect(result.prompt).toContain("[added] src/b.ts");
		expect(result.prompt).toContain("export const added = true");
	});

	it("keeps evidence from every changed file when a large diff is truncated", () => {
		const largeFile = (path: string, token: string) => `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-old
+${token.repeat(55_000)}
`;
		const input = request([
			largeFile("src/first.ts", "a"),
			largeFile("src/middle.ts", "b"),
			largeFile("src/last.ts", "c"),
		].join(""));
		const result = buildAiPrompt(input);
		expect(result.truncated).toBe(true);
		expect(result.prompt).toContain("### src/first.ts");
		expect(result.prompt).toContain("### src/middle.ts");
		expect(result.prompt).toContain("### src/last.ts");
		expect(result.prompt.match(/\[file diff truncated\]/g)).toHaveLength(3);
	});

	it("keeps the newest conversation turns when the history budget is exceeded", () => {
		const input = request("current question");
		input.history = [
			{ role: "user", text: "old question ".repeat(2_000) },
			{ role: "assistant", text: "old answer ".repeat(2_000) },
			{ role: "user", text: "recent question" },
			{ role: "assistant", text: "recent answer" },
		];
		const result = buildAiPrompt(input);
		expect(result.truncated).toBe(true);
		expect(result.prompt).toContain("recent question");
		expect(result.prompt).toContain("recent answer");
		expect(result.prompt).not.toContain("old question old question");
	});
});
