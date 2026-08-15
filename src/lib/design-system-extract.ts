import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { emptyTokens, type DesignTokens } from "./design-system-types.js";

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"coverage",
	"target",
	".turbo",
	".output",
]);

const CSS_FILE_RE = /\.(css|scss|sass)$/i;
const TOKEN_JSON_RE = /(tokens?|theme)\.json$/i;
const VAR_RE = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

const COLOR_ALIASES: Array<[RegExp, string]> = [
	[/(?:^|-)(?:bg|background|canvas|surface-0)$/i, "bg"],
	[/(?:^|-)(?:surface|raised|panel)$/i, "surface"],
	[/(?:^|-)(?:text|fg|foreground|ink)$/i, "text"],
	[/(?:^|-)(?:muted|subtle|secondary-text)$/i, "muted"],
	[/(?:^|-)(?:accent|primary|brand|focus)$/i, "accent"],
	[/(?:^|-)(?:border|rule|line)$/i, "border"],
	[/(?:^|-)(?:danger|error|destructive)$/i, "danger"],
	[/(?:^|-)(?:ok|success)$/i, "ok"],
	[/(?:^|-)(?:warn|warning)$/i, "warn"],
];

const FONT_ALIASES: Array<[RegExp, string]> = [
	[/(?:ui|sans|body|text)-?font|font-?(?:ui|sans|body)/i, "ui"],
	[/(?:mono|code|pre)-?font|font-?(?:mono|code)/i, "mono"],
];

export interface ExtractHit {
	path: string;
	count: number;
}

export interface ExtractResult {
	tokens: DesignTokens;
	sources: Array<{ kind: "css-vars"; path: string }>;
	files: ExtractHit[];
}

function mapSemantic(
	name: string,
	value: string,
	tokens: DesignTokens,
): void {
	const trimmed = value.trim();
	for (const [re, key] of COLOR_ALIASES) {
		if (re.test(name) && !tokens.color[key]) {
			tokens.color[key] = trimmed;
			return;
		}
	}
	for (const [re, key] of FONT_ALIASES) {
		if (re.test(name) && !tokens.font[key]) {
			tokens.font[key] = trimmed.replace(/^["']|["']$/g, "");
			return;
		}
	}
	if (/radius/i.test(name) && !tokens.radius.sm) {
		tokens.radius.sm = trimmed;
	}
	if (/shadow|elevation/i.test(name) && !tokens.shadow.overlay) {
		tokens.shadow.overlay = trimmed;
	}
}

/** Pure: pull custom properties out of a CSS/JSON string. */
export function extractTokensFromText(text: string): DesignTokens {
	const tokens = emptyTokens();
	VAR_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = VAR_RE.exec(text))) {
		const name = match[1];
		const value = match[2].trim();
		tokens.raw[`--${name}`] = value;
		mapSemantic(name, value, tokens);
	}
	try {
		const json = JSON.parse(text) as unknown;
		if (json && typeof json === "object") collectJsonTokens(json, tokens, "");
	} catch {
		/* not JSON */
	}
	return tokens;
}

function collectJsonTokens(value: unknown, tokens: DesignTokens, path: string): void {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) return;
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		const next = path ? `${path}-${k}` : k;
		if (typeof v === "string") {
			tokens.raw[next] = v;
			mapSemantic(next, v, tokens);
		} else if (v && typeof v === "object" && "value" in (v as object)) {
			const inner = (v as { value: unknown }).value;
			if (typeof inner === "string") {
				tokens.raw[next] = inner;
				mapSemantic(next, inner, tokens);
			}
		} else {
			collectJsonTokens(v, tokens, next);
		}
	}
}

export function mergeTokens(base: DesignTokens, extra: DesignTokens): DesignTokens {
	return {
		color: { ...base.color, ...extra.color },
		font: { ...base.font, ...extra.font },
		space: extra.space.scale.length ? extra.space : base.space,
		radius: { ...base.radius, ...extra.radius },
		shadow: { ...base.shadow, ...extra.shadow },
		raw: { ...base.raw, ...extra.raw },
	};
}

async function walkFiles(
	root: string,
	dir: string,
	out: string[],
	budget: { left: number },
): Promise<void> {
	if (budget.left <= 0) return;
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (budget.left <= 0) return;
		if (entry.name.startsWith(".") && entry.name !== ".") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			await walkFiles(root, full, out, budget);
			continue;
		}
		if (!entry.isFile()) continue;
		if (CSS_FILE_RE.test(entry.name) || TOKEN_JSON_RE.test(entry.name)) {
			out.push(full);
			budget.left -= 1;
		}
	}
}

/** Scan a repo for CSS variables / token JSON. Bounded and skippable. */
export async function extractFromRepo(
	repoRoot: string,
	opts?: { maxFiles?: number },
): Promise<ExtractResult> {
	const files: string[] = [];
	await walkFiles(repoRoot, repoRoot, files, { left: opts?.maxFiles ?? 80 });
	let tokens = emptyTokens();
	const hits: ExtractHit[] = [];
	const sources: ExtractResult["sources"] = [];
	for (const file of files) {
		let text = "";
		try {
			text = await readFile(file, "utf8");
		} catch {
			continue;
		}
		const extracted = extractTokensFromText(text);
		const count = Object.keys(extracted.raw).length;
		if (count === 0) continue;
		tokens = mergeTokens(tokens, extracted);
		const rel = relative(repoRoot, file) || file;
		hits.push({ path: rel, count });
		sources.push({ kind: "css-vars", path: rel });
	}
	return { tokens, sources, files: hits };
}
