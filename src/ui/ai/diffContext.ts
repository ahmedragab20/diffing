import type { AiDiffContext } from "../../lib/ai/types";

/**
 * Build the context for the review-wide AI rail. The viewport's active file is
 * preserved as a focus hint, but the scope and patch always remain the whole
 * review. Renderer hunk metadata is deliberately not accepted here: its
 * segments are objects and coercing them to text produces `[object Object]`.
 */
export function diffReviewContextForAi(
	patch: string | null | undefined,
	options: {
		repoName?: string;
		branch?: string;
		focusedFilePath?: string | null;
	} = {},
): AiDiffContext {
	return {
		kind: "diff",
		repoName: options.repoName || undefined,
		branch: options.branch || undefined,
		focusedFilePath: options.focusedFilePath || undefined,
		patch: patch || undefined,
	};
}
