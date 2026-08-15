import type { CommentReply } from "./types.js";

export const DESIGN_SYSTEM_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const DEFAULT_DESIGN_SYSTEM_ID = "default";
export const DESIGN_SYSTEM_ROUTE_ID = "system";

export type DesignSystemStatus = "draft" | "published";
export type DesignComponentSource = "human" | "agent" | "promote" | "extract";

export interface DesignTokens {
	color: Record<string, string>;
	font: Record<string, string>;
	space: { unit: number; scale: number[] };
	radius: Record<string, string>;
	shadow: Record<string, string>;
	/** All extracted custom properties, including ones that did not map semantically. */
	raw: Record<string, string>;
}

export interface DesignComponent {
	id: string;
	label: string;
	html: string;
	createdAt: number;
	source?: DesignComponentSource;
}

export interface DesignSystemSource {
	kind: "css-vars" | "capture" | "mockup" | "manual" | "url";
	path?: string;
	url?: string;
	mockupId?: string;
	screenId?: string;
}

export interface DesignSystemComment {
	id: string;
	kind: "token" | "component" | "guidelines" | "general";
	target?: string;
	body: string;
	status: "open" | "resolved";
	createdAt: number;
	replies: CommentReply[];
}

export interface DesignSystemRevision {
	revision: number;
	status: DesignSystemStatus;
	title: string;
	tokens: DesignTokens;
	guidelines: string;
	components: DesignComponent[];
	sources: DesignSystemSource[];
	createdAt: number;
	publishedAt?: number;
}

export interface DesignSystem {
	id: string;
	title: string;
	revision: number;
	status: DesignSystemStatus;
	tokens: DesignTokens;
	guidelines: string;
	components: DesignComponent[];
	sources: DesignSystemSource[];
	createdAt: number;
	updatedAt: number;
	publishedAt?: number;
	revisions: DesignSystemRevision[];
	comments: DesignSystemComment[];
}

export function emptyTokens(): DesignTokens {
	return {
		color: {},
		font: {},
		space: { unit: 4, scale: [4, 8, 12, 16, 24, 32, 48] },
		radius: {},
		shadow: {},
		raw: {},
	};
}

export function cloneTokens(tokens: DesignTokens): DesignTokens {
	return {
		color: { ...tokens.color },
		font: { ...tokens.font },
		space: {
			unit: tokens.space.unit,
			scale: [...tokens.space.scale],
		},
		radius: { ...tokens.radius },
		shadow: { ...tokens.shadow },
		raw: { ...tokens.raw },
	};
}

export function snapshotRevision(system: DesignSystem): DesignSystemRevision {
	return {
		revision: system.revision,
		status: system.status,
		title: system.title,
		tokens: cloneTokens(system.tokens),
		guidelines: system.guidelines,
		components: system.components.map((c) => ({ ...c })),
		sources: system.sources.map((s) => ({ ...s })),
		createdAt: system.updatedAt,
		publishedAt: system.publishedAt,
	};
}

export function slugifyDesignId(raw: string): string | null {
	const slug = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!DESIGN_SYSTEM_ID_RE.test(slug)) return null;
	return slug;
}

export function tokensToCss(tokens: DesignTokens): string {
	const lines: string[] = [":root {"];
	const put = (name: string, value: string) => {
		lines.push(`  --ds-${name}: ${value};`);
	};
	for (const [k, v] of Object.entries(tokens.color)) put(`color-${k}`, v);
	for (const [k, v] of Object.entries(tokens.font)) put(`font-${k}`, v);
	put("space-unit", `${tokens.space.unit}px`);
	tokens.space.scale.forEach((n, i) => put(`space-${i}`, `${n}px`));
	for (const [k, v] of Object.entries(tokens.radius)) put(`radius-${k}`, v);
	for (const [k, v] of Object.entries(tokens.shadow)) put(`shadow-${k}`, v);
	for (const [k, v] of Object.entries(tokens.raw)) {
		const name = k.startsWith("--") ? k.slice(2) : k;
		if (!lines.some((line) => line.includes(`--ds-${name}:`) || line.includes(`${k}:`))) {
			lines.push(`  ${k.startsWith("--") ? k : `--${k}`}: ${v};`);
		}
	}
	lines.push("}");
	return lines.join("\n");
}
