/**
 * Split diffs need two code panes. Below this card width the panes stack on
 * top of each other (Pierre's 1fr columns won't shrink past min-content).
 * Unified is the readable layout in that range — same idea as plan split
 * collapsing below 960px, measured on the file card rather than the viewport
 * so a desktop window with sidebar + AI rail still switches.
 */
export const SPLIT_DIFF_MIN_WIDTH = 720;

export function effectiveDiffStyle(
	requested: "split" | "unified",
	containerWidth: number,
): "split" | "unified" {
	if (requested !== "split") return requested;
	if (containerWidth <= 0) return requested;
	if (containerWidth < SPLIT_DIFF_MIN_WIDTH) return "unified";
	return "split";
}
