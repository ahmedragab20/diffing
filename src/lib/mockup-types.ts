import type { CommentReply, CommentSeverity } from "./types.js";
import type { PlanDecision, PlanMode } from "./plan-types.js";

/** Same verdict vocabulary as plan review. */
export type MockupDecision = PlanDecision;
export type MockupMode = PlanMode;

export const MOCKUP_MAX_SCREENS = 24;
export const MOCKUP_MAX_SCREEN_BYTES = Math.floor(1.5 * 1024 * 1024);
export const MOCKUP_SCREEN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type MockupAnchorKind = "section" | "block" | "point";

/** Layout width at click time. Comment scope = version + screen + viewport. */
export type MockupViewport = "desktop" | "tablet" | "mobile";

export const MOCKUP_VIEWPORTS: readonly MockupViewport[] = [
	"desktop",
	"tablet",
	"mobile",
];

export function isMockupViewport(value: unknown): value is MockupViewport {
	return value === "desktop" || value === "tablet" || value === "mobile";
}

export function normalizeMockupViewport(value: unknown): MockupViewport {
	return isMockupViewport(value) ? value : "desktop";
}

/** Effective viewport of a comment; legacy comments (no viewport) anchor on desktop. */
export function commentViewport(comment: MockupComment): MockupViewport {
	return comment.viewport ?? "desktop";
}

export function commentTheme(comment: MockupComment): MockupTheme {
	return comment.theme ?? "light";
}

/** Bounded inspect views exposed by `diffing mockup inspect` / MCP inspect_mockup. */
export type MockupInspectView =
	| "summary"
	| "comments"
	| "comment"
	| "screen"
	| "preview";

/** How much anchor context an inspect view carries. */
export type MockupInspectContext = "none" | "anchor" | "source";

export type MockupRenderMode = "fragment" | "document";
export type MockupTheme = "light" | "dark";

export interface MockupFlow {
	id: string;
	label: string;
	screenIds: string[];
}

export interface MockupScreen {
	id: string;
	label: string;
	html: string;
	/** This screen is a state variant of another screen id. */
	stateOf?: string;
	/** Optional flow grouping id. */
	flow?: string;
}

export interface MockupScreenInput {
	id?: string;
	label?: string;
	html: string;
	stateOf?: string;
	flow?: string;
}

export interface MockupRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface MockupComment {
	id: string;
	screenId: string;
	kind: MockupAnchorKind;
	/** data-diffing section name, when the click is inside one. */
	target?: string;
	/** Precise CSS path to the clicked node (not the section wrapper). */
	selector?: string;
	/** outerHTML of the clicked node. Primary locator for agents. */
	html?: string;
	/** Parent / section HTML around the click. Survives viewport/rect changes. */
	contextHtml?: string;
	x?: number;
	y?: number;
	/** Click position as % of the enclosing section, when kind=section. */
	sectionX?: number;
	sectionY?: number;
	snapshot?: string;
	rect?: MockupRect;
	severity?: CommentSeverity;
	body: string;
	status: "open" | "resolved";
	createdAt: number;
	createdAtMockupVersion: number;
	replies: CommentReply[];
	/** Verdict-note thread, twin of plan `kind: 'decision'`. */
	threadKind?: "general" | "decision";
	/**
	 * Layout width at click time. Part of the comment scope together with
	 * createdAtMockupVersion + screenId. Legacy comments (undefined) anchor on
	 * "desktop".
	 */
	viewport?: MockupViewport;
	/** Color theme at click time. Part of comment scope with viewport. */
	theme?: MockupTheme;
	/**
	 * Stable fingerprint of the block's section-relative DOM path (kind=block
	 * inside a named section). Survives edits elsewhere in the section.
	 */
	fingerprint?: string;
}

export interface MockupVersion {
	version: number;
	title: string;
	screens: MockupScreen[];
	source?: string;
	model?: string;
	createdAt: number;
	designSystemId?: string;
	designRevision?: number;
	mode?: MockupRenderMode;
	planId?: string;
	flows?: MockupFlow[];
}

export interface Mockup {
	id: string;
	title: string;
	screens: MockupScreen[];
	source?: string;
	sourcePath?: string;
	model?: string;
	createdAt: number;
	updatedAt: number;
	version: number;
	decision: MockupDecision;
	decisionComment?: string;
	decidedAt?: number;
	versions: MockupVersion[];
	comments: MockupComment[];
	designSystemId?: string;
	designRevision?: number;
	mode?: MockupRenderMode;
	planId?: string;
	flows?: MockupFlow[];
}

/** Metadata-only list representation. Screen and version HTML stay out of list/SSE refetches. */
export interface MockupSummary {
	id: string;
	title: string;
	screens: Array<Pick<MockupScreen, "id" | "label">>;
	source?: string;
	model?: string;
	createdAt: number;
	updatedAt: number;
	version: number;
	decision: MockupDecision;
	decidedAt?: number;
	versionCount: number;
	commentCounts: {
		total: number;
		open: number;
		resolved: number;
	};
	designSystemId?: string;
	planId?: string;
	/** Present only for compatibility lookups with `include=comments`. */
	comments?: MockupComment[];
}

export function defaultScreenLabel(id: string): string {
	if (id === "main") return "Main";
	return id
		.split(/[-_]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function slugifyScreenId(raw: string): string | null {
	const slug = raw
		.trim()
		.toLowerCase()
		.replace(/\.html?$/i, "")
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!MOCKUP_SCREEN_ID_RE.test(slug)) return null;
	return slug;
}

export type NormalizeScreensResult =
	| { ok: true; screens: MockupScreen[] }
	| { ok: false; error: string };

export function normalizeSubmitScreens(input: {
	html?: string;
	screens?: MockupScreenInput[];
}): NormalizeScreensResult {
	const hasHtml = typeof input.html === "string" && input.html.length > 0;
	const hasScreens = Array.isArray(input.screens) && input.screens.length > 0;
	if (hasHtml && hasScreens) {
		return { ok: false, error: "Provide either html or screens, not both" };
	}
	const raw: MockupScreenInput[] = hasScreens
		? input.screens!
		: hasHtml
			? [{ id: "main", label: "Main", html: input.html! }]
			: [];
	if (raw.length === 0) {
		return { ok: false, error: "A mockup html body or screens[] is required" };
	}
	if (raw.length > MOCKUP_MAX_SCREENS) {
		return {
			ok: false,
			error: `At most ${MOCKUP_MAX_SCREENS} screens are allowed`,
		};
	}
	const seen = new Set<string>();
	const screens: MockupScreen[] = [];
	for (const item of raw) {
		if (typeof item.html !== "string" || !item.html.trim()) {
			return { ok: false, error: "Each screen needs a non-empty html body" };
		}
		const bytes = Buffer.byteLength(item.html, "utf8");
		if (bytes > MOCKUP_MAX_SCREEN_BYTES) {
			return {
				ok: false,
				error: `Each screen must be ≤ ${MOCKUP_MAX_SCREEN_BYTES} bytes`,
			};
		}
		const id = item.id ? slugifyScreenId(item.id) : slugifyScreenId("main");
		if (!id) {
			return { ok: false, error: `Invalid screen id "${item.id ?? ""}"` };
		}
		if (seen.has(id)) {
			return { ok: false, error: `Duplicate screen id "${id}"` };
		}
		seen.add(id);
		const label =
			typeof item.label === "string" && item.label.trim()
				? item.label.trim()
				: defaultScreenLabel(id);
		const screen: MockupScreen = {
			id,
			label,
			html: item.html.replace(/\r\n/g, "\n"),
		};
		if (item.stateOf) screen.stateOf = item.stateOf;
		if (item.flow) screen.flow = item.flow;
		screens.push(screen);
	}
	return { ok: true, screens };
}
