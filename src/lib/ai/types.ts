export type AiSourceId = "codex" | "claude" | "opencode" | "cursor" | "openai" | "anthropic" | "xai";

export type AiCredentialRoute = "subscription" | "direct-key" | "runtime-key";

export type AiConnectionStatus =
	| "connected"
	| "disconnected"
	| "missing-runtime"
	| "needs-configuration"
	| "error";

export interface AiConnection {
	id: AiSourceId;
	label: string;
	status: AiConnectionStatus;
	runtimeAvailable: boolean;
	credentialRoutes: AiCredentialRoute[];
	activeRoutes: AiCredentialRoute[];
	detail?: string;
	setupCommand?: string;
	modelCount?: number;
}

export interface AiModel {
	id: string;
	sourceId: AiSourceId;
	credentialRoute: AiCredentialRoute;
	providerId: string;
	modelId: string;
	displayName: string;
	description?: string;
	isDefault?: boolean;
	reasoningEfforts?: string[];
	serviceTiers?: string[];
}

export type AiSurface = "diff" | "pr-diff" | "plan";

export type AiAction =
	| "ask"
	| "summarize"
	| "review-risks"
	| "explain"
	| "draft-comment"
	| "improve-comment"
	| "shorten-comment"
	| "make-specific"
	| "draft-reply"
	| "suggest-change"
	| "review-map"
	| "explain-hunk"
	| "draft-review-summary"
	| "critique-plan"
	| "find-plan-gaps"
	| "rewrite-plan-section"
	| "compare-plan-versions";

export interface AiDiffContext {
	kind: "diff" | "file" | "selection" | "comment-thread";
	repoName?: string;
	branch?: string;
	filePath?: string;
	side?: "additions" | "deletions";
	startLine?: number;
	endLine?: number;
	patch?: string;
	selectedText?: string;
	draft?: string;
	commentBody?: string;
	replies?: string[];
	attachmentPaths?: string[];
	attachments?: AiAttachment[];
}

export interface AiPlanContext {
	kind: "plan" | "plan-selection" | "plan-thread" | "plan-version-compare";
	planId: string;
	title: string;
	version: number;
	body?: string;
	selectedText?: string;
	section?: string;
	draft?: string;
	commentBody?: string;
	replies?: string[];
	previousVersion?: number;
	previousBody?: string;
	attachmentPaths?: string[];
	attachments?: AiAttachment[];
}

export interface AiAttachment {
	path: string;
	content: string;
	truncated?: boolean;
}

export type AiReviewContext = AiDiffContext | AiPlanContext;

export interface AiRunRequest {
	/** The server rejects anything except an explicit user-triggered request. */
	trigger: "user";
	conversationId: string;
	modelId: string;
	surface: AiSurface;
	action: AiAction;
	prompt?: string;
	context: AiReviewContext;
	reasoningEffort?: string;
	serviceTier?: string;
}

export type AiRunEvent =
	| { type: "start"; runId: string; modelId: string }
	| { type: "text-delta"; text: string }
	| { type: "warning"; message: string }
	| { type: "error"; message: string }
	| { type: "complete"; text: string };

export interface AiBackendAdapter {
	id: AiSourceId;
	connection(): Promise<AiConnection>;
	models(): Promise<AiModel[]>;
	connectKey?(key: string, remember: boolean): Promise<void>;
	disconnect?(): Promise<void>;
	setupCommand?(route: AiCredentialRoute, providerId?: string): string | null;
	run(
		request: AiRunRequest,
		signal: AbortSignal,
		onEvent: (event: AiRunEvent) => void | Promise<void>,
	): Promise<string>;
}
