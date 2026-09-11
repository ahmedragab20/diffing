export const DIFFING_JUMP_TO_LINE = "diffing-jump-to-line";

export interface DiffingJumpToLineDetail {
	filePath: string;
	line: number;
	side?: "additions" | "deletions";
}

export function dispatchJumpToLine(detail: DiffingJumpToLineDetail): void {
	window.dispatchEvent(
		new CustomEvent<DiffingJumpToLineDetail>(DIFFING_JUMP_TO_LINE, { detail }),
	);
}
