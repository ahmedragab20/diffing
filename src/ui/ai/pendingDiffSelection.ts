import type { AiDiffSelection } from "../../lib/ai/types";

let pending: AiDiffSelection | null = null;

export function setPendingDiffSelection(
	selection: AiDiffSelection | null,
): void {
	pending = selection;
}

export function getPendingDiffSelection(): AiDiffSelection | null {
	return pending;
}
