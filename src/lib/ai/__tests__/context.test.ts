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
