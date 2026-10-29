const SUGGESTION_RE = /```suggestion\n([\s\S]*?)```/;
const CLIPPED_MARK = "\u2026";

export type SuggestionEditPlan =
	| { ok: true; op: "region"; region: string }
	| { ok: true; op: "text"; expectedText: string }
	| { ok: false; status: 400; error: string };

/**
 * Section comments replace the named `data-diffing` region. Block comments
 * replace the stored element HTML. A block inside a section still has `target`
 * set to that section; using it would wipe the rest of the region. Pins never
 * rewrite markup.
 */
export function planSuggestionEdit(comment: {
	kind: string;
	target?: string;
	html?: string;
}): SuggestionEditPlan {
	if (comment.kind === "point") {
		return {
			ok: false,
			status: 400,
			error: "Pin comments have no markup to replace",
		};
	}
	if (comment.kind === "section") {
		if (!comment.target?.trim()) {
			return {
				ok: false,
				status: 400,
				error: "Section comment has no data-diffing target",
			};
		}
		return { ok: true, op: "region", region: comment.target };
	}
	if (comment.kind === "block") {
		const html = comment.html;
		if (!html) {
			return {
				ok: false,
				status: 400,
				error: "Block comment has no html anchor",
			};
		}
		if (html.length > 2000 && html.endsWith(CLIPPED_MARK)) {
			return {
				ok: false,
				status: 400,
				error:
					"Block anchor HTML was truncated, so it cannot be applied exactly",
			};
		}
		return { ok: true, op: "text", expectedText: html };
	}
	return { ok: false, status: 400, error: "Comment has no applicable anchor" };
}

export function extractSuggestion(body: string): string | null {
	const match = SUGGESTION_RE.exec(body);
	if (!match) return null;
	const text = match[1].replace(/\n$/, "");
	return text.length > 0 ? text : null;
}
