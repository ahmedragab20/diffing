import { splitUnifiedDiffByFile } from "../../lib/diff-fingerprint";

/**
 * Select the original unified-diff section for the active file. Renderer hunk
 * metadata is deliberately not accepted here: its segments are objects and
 * coercing them to text produces `[object Object]` instead of review context.
 */
export function diffPatchForAiContext(
	patch: string | null | undefined,
	filePath: string | null | undefined,
): string | undefined {
	if (!patch) return undefined;
	if (!filePath) return patch;
	return splitUnifiedDiffByFile(patch).get(filePath) ?? patch;
}
