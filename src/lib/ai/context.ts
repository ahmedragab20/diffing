import type { AiAction, AiReviewContext, AiRunRequest } from "./types.js";

export const MAX_AI_CONTEXT_BYTES = 96 * 1024;
export const MAX_AI_PROMPT_BYTES = 16 * 1024;
export const MAX_AI_ATTACHMENT_BYTES = 64 * 1024;

function bounded(value: string | undefined, max: number): { text: string; truncated: boolean } {
	if (!value) return { text: "", truncated: false };
	const bytes = Buffer.byteLength(value, "utf8");
	if (bytes <= max) return { text: value, truncated: false };
	let end = Math.min(value.length, max);
	while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > max) end -= 256;
	return { text: `${value.slice(0, Math.max(0, end))}\n\n[context truncated]`, truncated: true };
}

const ACTION_INSTRUCTIONS: Record<AiAction, string> = {
	ask: "Answer the user's question using only the supplied review context.",
	summarize: "Summarize the change or plan precisely, emphasizing intent and review impact.",
	"review-risks": "Identify concrete correctness, security, lifecycle, and compatibility risks. Avoid speculative findings.",
	explain: "Explain the selected code or plan text clearly and concisely.",
	"draft-comment": "Draft an actionable review comment. Return only the proposed comment body.",
	"improve-comment": "Improve the draft review comment without changing its meaning. Return only the revised body.",
	"shorten-comment": "Make the draft shorter while preserving the actionable point. Return only the revised body.",
	"make-specific": "Make the draft more specific and evidence-based. Return only the revised body.",
	"draft-reply": "Draft a direct reply to the review thread. Return only the reply body.",
	"suggest-change": "Draft a GitHub-style suggestion fence and a short rationale.",
	"review-map": "Propose a review order for the supplied changed files. Do not claim any file was reviewed.",
	"explain-hunk": "Explain the hunk's intent, risks, and missing tests.",
	"draft-review-summary": "Draft an overall review summary from the supplied comments and metadata only.",
	"critique-plan": "Critique the plan for missing decisions, sequencing risks, and unverifiable steps.",
	"find-plan-gaps": "List material gaps that would block safe implementation.",
	"rewrite-plan-section": "Rewrite the selected plan section. Return only replacement Markdown.",
	"compare-plan-versions": "Explain meaningful changes between the two explicit plan versions.",
};

/** Build a provider-neutral prompt without reading any repository state. */
export function buildAiPrompt(request: AiRunRequest): { prompt: string; truncated: boolean } {
	const user = bounded(request.prompt?.trim(), MAX_AI_PROMPT_BYTES);
	const { attachments = [], ...contextWithoutAttachments } = request.context;
	const attachmentJson = bounded(JSON.stringify(attachments, null, 2), MAX_AI_ATTACHMENT_BYTES);
	const remainingContextBytes = Math.max(16 * 1024, MAX_AI_CONTEXT_BYTES - Buffer.byteLength(attachmentJson.text, "utf8"));
	const contextJson = bounded(JSON.stringify(contextWithoutAttachments, null, 2), remainingContextBytes);
	const prompt = [
		"You are assisting a human code/plan reviewer inside diffing.",
		"Do not use tools, modify files, post comments, resolve threads, or infer context that is not supplied.",
		"Return clean GitHub-Flavored Markdown. Use descriptive headings and lists when the answer has multiple sections. Put code in fenced code blocks with a language tag. Never emit ANSI/terminal formatting or dense pseudo-table text.",
		ACTION_INSTRUCTIONS[request.action],
		user.text ? `User request:\n${user.text}` : "",
		attachments.length ? `Explicitly attached files (highest-priority context):\n${attachmentJson.text}` : "",
		`Review context (${request.context.kind}):\n${contextJson.text}`,
	]
		.filter(Boolean)
		.join("\n\n");
	return { prompt, truncated: user.truncated || attachmentJson.truncated || contextJson.truncated };
}

export function contextSummary(context: AiReviewContext): string[] {
	if ("version" in context) {
		return [context.kind, `v${context.version}`, context.title];
	}
	return [context.kind, context.filePath ?? "whole diff"].filter(Boolean);
}
