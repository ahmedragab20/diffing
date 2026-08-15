const SUGGESTION_RE = /```suggestion\n([\s\S]*?)```/;

export function extractSuggestion(body: string): string | null {
	const match = SUGGESTION_RE.exec(body);
	if (!match) return null;
	const text = match[1].replace(/\n$/, "");
	return text.length > 0 ? text : null;
}
