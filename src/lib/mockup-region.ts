/**
 * Replace the inner HTML of the first `[data-diffing="<region>"]` element.
 * Used by revise_mockup op=replace-region. Not a general HTML rewriter —
 * good enough for agent-authored mockup fragments.
 */

const VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

export type ReplaceRegionResult =
	| { ok: true; html: string; occurrences: number }
	| { ok: false; error: string };

interface OpenTag {
	start: number;
	end: number;
	name: string;
	selfClosing: boolean;
}

function scanOpenTag(html: string, at: number): OpenTag | null {
	if (html[at] !== "<" || html[at + 1] === "/" || html[at + 1] === "!") {
		return null;
	}
	const nameMatch = /^<([A-Za-z][\w:-]*)/.exec(html.slice(at));
	if (!nameMatch) return null;
	let quote: string | null = null;
	for (let i = at + 1; i < html.length; i++) {
		const ch = html[i];
		if (quote) {
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === ">") {
			const selfClosing = html[i - 1] === "/" || VOID_TAGS.has(nameMatch[1].toLowerCase());
			return {
				start: at,
				end: i + 1,
				name: nameMatch[1],
				selfClosing,
			};
		}
	}
	return null;
}

function findOpenTagContaining(html: string, attrIndex: number): OpenTag | null {
	let i = attrIndex;
	while (i >= 0 && html[i] !== "<") i--;
	if (i < 0) return null;
	const tag = scanOpenTag(html, i);
	if (!tag || attrIndex >= tag.end) return null;
	return tag;
}

function findMatchingClose(html: string, afterOpen: number, tagName: string): number | null {
	const lower = tagName.toLowerCase();
	let depth = 1;
	let i = afterOpen;
	while (i < html.length) {
		if (html[i] !== "<") {
			i++;
			continue;
		}
		if (html.startsWith("<!--", i)) {
			const end = html.indexOf("-->", i + 4);
			i = end === -1 ? html.length : end + 3;
			continue;
		}
		const close = /^<\/([A-Za-z][\w:-]*)\s*>/.exec(html.slice(i));
		if (close) {
			if (close[1].toLowerCase() === lower) {
				depth--;
				if (depth === 0) return i;
			}
			i += close[0].length;
			continue;
		}
		const open = scanOpenTag(html, i);
		if (open) {
			if (!open.selfClosing && open.name.toLowerCase() === lower) depth++;
			i = open.end;
			continue;
		}
		i++;
	}
	return null;
}

const ATTR_RE = /data-diffing\s*=\s*(["'])([^"']*)\1/gi;

/** Count how many `data-diffing="<region>"` attributes appear. */
export function countDataDiffingRegion(html: string, region: string): number {
	ATTR_RE.lastIndex = 0;
	let count = 0;
	let match: RegExpExecArray | null;
	while ((match = ATTR_RE.exec(html))) {
		if (match[2] === region) count++;
	}
	return count;
}

/**
 * Replace inner HTML of the first element whose `data-diffing` equals `region`.
 * `occurrences` is how many matching attributes existed before the replace.
 */
export function replaceDataDiffingRegion(
	html: string,
	region: string,
	replacement: string,
): ReplaceRegionResult {
	if (!region) return { ok: false, error: "region is required" };
	const occurrences = countDataDiffingRegion(html, region);
	if (occurrences === 0) {
		return { ok: false, error: `Region "${region}" not found` };
	}
	ATTR_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ATTR_RE.exec(html))) {
		if (match[2] !== region) continue;
		const tag = findOpenTagContaining(html, match.index);
		if (!tag) {
			return { ok: false, error: `Region "${region}" is not on an element` };
		}
		if (tag.selfClosing) {
			return {
				ok: false,
				error: `Region "${region}" is on a void/self-closing <${tag.name}> — give it a wrapper with inner HTML`,
			};
		}
		const closeStart = findMatchingClose(html, tag.end, tag.name);
		if (closeStart === null) {
			return {
				ok: false,
				error: `Region "${region}" has no matching </${tag.name}>`,
			};
		}
		return {
			ok: true,
			html: html.slice(0, tag.end) + replacement + html.slice(closeStart),
			occurrences,
		};
	}
	return { ok: false, error: `Region "${region}" not found` };
}
