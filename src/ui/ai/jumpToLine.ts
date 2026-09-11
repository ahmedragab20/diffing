export const DIFFING_JUMP_TO_LINE = "diffing-jump-to-line";

export interface DiffingJumpToLineDetail {
	filePath: string;
	line: number;
	side?: "additions" | "deletions";
}

/**
 * Notebook citation keys are snapshot source ids (`new:<path>`, `old:<path>`,
 * `patch:<index>`, plan `draft` / `body-draft`), not file paths. Patch keys
 * use unified-diff offsets and must never be treated as original-file lines.
 */
export function citationJumpTarget(
	key: string,
	line: number,
): DiffingJumpToLineDetail | null {
	if (!Number.isFinite(line) || line < 1) return null;
	if (key.startsWith("new:")) {
		const filePath = key.slice("new:".length);
		if (!filePath) return null;
		return { filePath, line, side: "additions" };
	}
	if (key.startsWith("old:")) {
		const filePath = key.slice("old:".length);
		if (!filePath) return null;
		return { filePath, line, side: "deletions" };
	}
	return null;
}

export function dispatchJumpToLine(detail: DiffingJumpToLineDetail): void {
	window.dispatchEvent(
		new CustomEvent<DiffingJumpToLineDetail>(DIFFING_JUMP_TO_LINE, { detail }),
	);
}
