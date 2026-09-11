import type {
	AiAction,
	AiConversationContextLabel,
	AiImageAttachmentReference,
	AiReviewContext,
	AiSurface,
} from "../../lib/ai/types";
import type { AiConversation } from "../../lib/ai/conversations";
import {
	FileText,
	GitCompare,
	ListTree,
	MessageCircle,
	ShieldAlert,
	type LucideIcon,
} from "lucide-react";
import type { useOptionalAi } from "./AiContext";

export type AiClient = NonNullable<ReturnType<typeof useOptionalAi>>;

export function attachedFilePaths(text: string): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(/(?:^|\s)@([^\s@]+)/g)) {
		const path = match[1]?.trim();
		if (!path || seen.has(path)) continue;
		seen.add(path);
		paths.push(path);
	}
	return paths.slice(0, 8);
}

export function conversationScopeKey(
	surface: AiSurface,
	context: AiReviewContext,
): string {
	if (surface === "mockup" && "mockupId" in context)
		return `${surface}:${context.mockupId}`;
	if (surface === "plan" && "planId" in context)
		return `${surface}:${context.planId}`;
	const root =
		"repoName" in context && context.repoName ? context.repoName : "review";
	const branch =
		"branch" in context && context.branch ? context.branch : "working-tree";
	return `${surface}:${root}:${branch}`;
}

export function contextLabel(
	context: AiReviewContext,
	attachmentPaths: string[],
	imageAttachments: AiImageAttachmentReference[],
): AiConversationContextLabel {
	const label: AiConversationContextLabel = {
		kind: context.kind,
		attachmentPaths,
		imageAttachments,
	};
	if ("filePath" in context && context.filePath)
		label.filePath = context.filePath;
	if ("version" in context) label.version = context.version;
	if (context.kind === "selection" && "selectedText" in context)
		label.label = "Selected context";
	if (context.kind === "comment-thread" && "commentBody" in context)
		label.label = "Review thread";
	if (context.kind === "mockup-thread") label.label = "Mockup thread";
	if (context.kind === "mockup-region") label.label = "Selected region";
	if ("selections" in context && context.selections?.length) {
		label.selectionLabels = context.selections.map(
			(selection) =>
				`${selection.filePath} · L${selection.startLine}${selection.endLine === selection.startLine ? "" : `–L${selection.endLine}`}`,
		);
	}
	return label;
}

export function titleForPrompt(prompt: string): string {
	const title = prompt.replace(/\s+/g, " ").trim();
	return title.length > 54
		? `${title.slice(0, 53).trimEnd()}…`
		: title || "New conversation";
}

export function localConversation(
	surface: AiSurface,
	scopeKey: string,
	modelId: string,
): AiConversation {
	const now = Date.now();
	return {
		id: `local-${crypto.randomUUID()}`,
		title: "New conversation",
		surface,
		scopeKey,
		createdAt: now,
		updatedAt: now,
		modelId,
		turns: [],
	};
}

export interface RailQuickAction {
	action: AiAction;
	prompt: string;
	label: string;
	hint: string;
	icon: LucideIcon;
	needsInput?: boolean;
}

export function quickActionsFor(
	surface: AiSurface,
	context: AiReviewContext,
): RailQuickAction[] {
	const isMockup = surface === "mockup";
	const isPlan = surface === "plan";
	const thirdAction: RailQuickAction = isMockup
		? {
				action: "critique-mockup",
				prompt:
					"Critique this mockup for missing states, accessibility, viewport issues, and copy.",
				label: "Critique mockup",
				hint: "Challenge the screen",
				icon: ListTree,
			}
		: isPlan
			? {
					action: "critique-plan",
					prompt: "Critique this plan for missing decisions and sequencing risks.",
					label: "Critique plan",
					hint: "Challenge assumptions",
					icon: ListTree,
				}
			: context.kind === "diff"
				? {
						action: "review-map",
						prompt: "Generate a review order. Do not mark anything reviewed.",
						label: "Review map",
						hint: "Prioritize the diff",
						icon: ListTree,
					}
				: {
						action: "explain-hunk",
						prompt:
							"Explain the intent, risks, and missing tests in this file context.",
						label: "Explain context",
						hint: "Trace this change",
						icon: FileText,
					};
	return [
		{
			action: "summarize",
			prompt: "Summarize this review context.",
			label: "Summarize",
			hint: "Intent and impact",
			icon: FileText,
		},
		{
			action: isMockup
				? "find-mockup-gaps"
				: isPlan
					? "find-plan-gaps"
					: "review-risks",
			prompt: isMockup
				? "Find material gaps in this mockup."
				: isPlan
					? "Find material gaps in this plan."
					: "Find material review risks.",
			label: isMockup || isPlan ? "Find gaps" : "Review risks",
			hint: isMockup
				? "Missing states and a11y"
				: isPlan
					? "Missing decisions"
					: "Correctness and safety",
			icon: ShieldAlert,
		},
		thirdAction,
	];
}

export function extraSlashActionsFor(
	surface: AiSurface,
	context: AiReviewContext,
): RailQuickAction[] {
	const extras: RailQuickAction[] = [
		{
			action: "ask",
			prompt: "",
			label: "Ask",
			hint: "Type a question, then send",
			icon: MessageCircle,
			needsInput: true,
		},
		{
			action: "explain",
			prompt: "Explain the current context.",
			label: "Explain",
			hint: "Explain the current context",
			icon: FileText,
		},
	];
	if (surface === "diff" || surface === "pr-diff") {
		extras.push({
			action: "draft-review-summary",
			prompt: "Draft a review summary from this diff.",
			label: "Draft review summary",
			hint: "Summarize for the review",
			icon: ListTree,
		});
	}
	if (surface === "plan" && "version" in context && (context.version ?? 0) > 1) {
		extras.push({
			action: "compare-plan-versions",
			prompt: "Compare this plan version with the previous one.",
			label: "Compare plan versions",
			hint: "What changed between versions",
			icon: GitCompare,
		});
	}
	if (surface === "mockup" && context.kind === "mockup-version-compare") {
		extras.push({
			action: "compare-mockup-versions",
			prompt: "Compare these mockup versions.",
			label: "Compare mockup versions",
			hint: "What changed between screens",
			icon: GitCompare,
		});
	}
	return extras;
}

export function slashActionsFor(
	surface: AiSurface,
	context: AiReviewContext,
): RailQuickAction[] {
	const seen = new Set<AiAction>();
	const items: RailQuickAction[] = [];
	for (const item of [
		...quickActionsFor(surface, context),
		...extraSlashActionsFor(surface, context),
	]) {
		if (seen.has(item.action)) continue;
		seen.add(item.action);
		items.push(item);
	}
	return items;
}

export function emptyStateCopy(surface: AiSurface): {
	title: string;
	examples: readonly [string, string, string];
} {
	if (surface === "plan") {
		return {
			title: "What should this plan still decide?",
			examples: [
				"What decisions are still open?",
				"What is the sequencing risk?",
				"Summarize this plan in 5 bullets",
			],
		};
	}
	if (surface === "mockup") {
		return {
			title: "What should this screen still cover?",
			examples: [
				"Which states are missing?",
				"Any accessibility problems?",
				"Does copy match the product tone?",
			],
		};
	}
	return {
		title: "What do you want to understand?",
		examples: [
			"What is the riskiest change here?",
			"Which files should I read first?",
			"Are there missing tests?",
		],
	};
}
