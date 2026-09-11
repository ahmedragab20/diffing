import {
	useCallback,
	useRef,
	useState,
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
} from "react";
import type {
	AiAction,
	AiConversationTurn,
	AiImageAttachmentReference,
	AiReviewContext,
	AiSurface,
} from "../../lib/ai/types";
import type {
	AiConversation,
	AiConversationSummary,
} from "../../lib/ai/conversations";
import { EMPTY_ACTIVITY, type RunActivity } from "../../lib/ai/activity";
import type { AiReviewStatus } from "../../lib/ai/review-jobs";
import { updateConversation } from "./conversationApi";
import {
	attachedFilePaths,
	contextLabel,
	titleForPrompt,
	type AiClient,
} from "./railHelpers";

export type RunPhase =
	| "idle"
	| "thinking"
	| "streaming"
	| "stopping"
	| "error"
	| "canceled"
	| "interrupted";

export function isRunBusy(phase: RunPhase): boolean {
	return phase === "thinking" || phase === "streaming" || phase === "stopping";
}

export interface PendingTurn {
	user: AiConversationTurn;
	assistantText: string;
	warnings: string[];
	error?: string;
}

export function deriveRailActivity(
	phase: RunPhase,
	pending: PendingTurn | null,
	elapsedMs: number,
	hasTurns: boolean,
): RunActivity {
	const warnings = pending?.warnings ?? [];
	const text = pending?.assistantText ?? "";
	if (phase === "thinking")
		return {
			...EMPTY_ACTIVITY,
			phase: "preparing",
			warnings,
			text,
			partial: true,
			elapsedMs,
		};
	if (phase === "streaming")
		return {
			...EMPTY_ACTIVITY,
			phase: "responding",
			warnings,
			text,
			partial: true,
			elapsedMs,
		};
	if (phase === "stopping")
		return {
			...EMPTY_ACTIVITY,
			phase: "cancel-requested",
			warnings,
			text,
			partial: true,
			elapsedMs,
		};
	if (phase === "error")
		return {
			...EMPTY_ACTIVITY,
			phase: "failed",
			warnings,
			text,
			partial: Boolean(text),
			errorCode: "provider_failed",
			elapsedMs,
		};
	if (phase === "canceled")
		return {
			...EMPTY_ACTIVITY,
			phase: "canceled",
			warnings,
			text,
			partial: true,
			elapsedMs,
		};
	if (phase === "interrupted")
		return {
			...EMPTY_ACTIVITY,
			phase: "interrupted",
			warnings,
			text,
			partial: true,
			elapsedMs,
		};
	if (hasTurns)
		return {
			...EMPTY_ACTIVITY,
			phase: "complete",
			succeeded: true,
			elapsedMs,
		};
	return EMPTY_ACTIVITY;
}

export interface UseAiRunArgs {
	ai: AiClient;
	surface: AiSurface;
	context: AiReviewContext;
	setConversation: Dispatch<SetStateAction<AiConversation | null>>;
	setConversationSummaries: Dispatch<SetStateAction<AiConversationSummary[]>>;
	setPersistenceError: Dispatch<SetStateAction<string | null>>;
	prompt: string;
	setPrompt: Dispatch<SetStateAction<string>>;
	imageAttachments: AiImageAttachmentReference[];
	setImageAttachments: Dispatch<SetStateAction<AiImageAttachmentReference[]>>;
	imageCapable: boolean;
	setImageError: Dispatch<SetStateAction<string | null>>;
	ensureConversation: () => Promise<AiConversation>;
	saveDraft: (nextDraft: string) => void;
	resizeComposer: () => void;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	forceScrollRef: MutableRefObject<boolean>;
}

export function useAiRun({
	ai,
	surface,
	context,
	setConversation,
	setConversationSummaries,
	setPersistenceError,
	prompt,
	setPrompt,
	imageAttachments,
	setImageAttachments,
	imageCapable,
	setImageError,
	ensureConversation,
	saveDraft,
	resizeComposer,
	textareaRef,
	forceScrollRef,
}: UseAiRunArgs) {
	const [phase, setPhase] = useState<RunPhase>("idle");
	const [pending, setPending] = useState<PendingTurn | null>(null);
	const [runWarnings, setRunWarnings] = useState<string[]>([]);
	const [reviewProgress, setReviewProgress] = useState<{
		review: AiReviewStatus;
		conversationId: string;
		modelId: string;
	} | null>(null);
	const runId = useRef<string | null>(null);
	const runStartedAt = useRef<number | null>(null);
	const abortController = useRef<AbortController | null>(null);
	const deltaFrameRef = useRef<number | null>(null);
	const latestDeltaRef = useRef("");
	const { run, cancel, selectedModel } = ai;

	const queueDelta = (text: string) => {
		latestDeltaRef.current = text;
		if (deltaFrameRef.current !== null) return;
		deltaFrameRef.current = window.requestAnimationFrame(() => {
			deltaFrameRef.current = null;
			setPhase("streaming");
			setPending((current) =>
				current ? { ...current, assistantText: latestDeltaRef.current } : current,
			);
		});
	};

	const resetRunVisuals = useCallback(() => {
		setPending(null);
		setPhase("idle");
		setRunWarnings([]);
		setReviewProgress(null);
	}, []);

	const start = async (
		action: AiAction,
		overridePrompt?: string,
		overrideImages?: AiImageAttachmentReference[],
		continuationId?: string,
	) => {
		const requested = (overridePrompt ?? prompt).trim();
		const requestedImages = overrideImages ?? imageAttachments;
		if (
			(!requested && requestedImages.length === 0) ||
			!selectedModel ||
			isRunBusy(phase)
		)
			return;
		if (requestedImages.length && !imageCapable) {
			setImageError("The selected model source cannot receive images.");
			return;
		}
		if (!continuationId) setReviewProgress(null);
		const requestedAttachments = attachedFilePaths(prompt);
		if (!overridePrompt) {
			saveDraft("");
			setPrompt("");
			setImageAttachments([]);
			requestAnimationFrame(() => {
				resizeComposer();
				textareaRef.current?.focus();
			});
		}
		setPersistenceError(null);
		const activeConversation = await ensureConversation();
		const userTurn: AiConversationTurn = {
			id: crypto.randomUUID(),
			role: "user",
			text:
				requested ||
				`Sent ${requestedImages.length} image${requestedImages.length === 1 ? "" : "s"}`,
			createdAt: Date.now(),
			context: contextLabel(context, requestedAttachments, requestedImages),
		};
		const controller = new AbortController();
		abortController.current = controller;
		setPending({ user: userTurn, assistantText: "", warnings: [] });
		setPhase("thinking");
		runStartedAt.current = Date.now();
		forceScrollRef.current = true;
		try {
			const result = await run({
				surface,
				action,
				context: {
					...context,
					attachmentPaths: requestedAttachments,
					imageAttachments: requestedImages,
				},
				prompt:
					requested || "Analyze the attached image in the supplied review context.",
				history: activeConversation.turns,
				conversationId: activeConversation.id,
				signal: controller.signal,
				onStart: (id) => {
					runId.current = id;
				},
				onDelta: queueDelta,
				onWarning: (message) => {
					setRunWarnings((current) =>
						current.includes(message) ? current : [...current, message],
					);
					setPending((current) =>
						current
							? {
									...current,
									warnings: current.warnings.includes(message)
										? current.warnings
										: [...current.warnings, message],
								}
							: current,
					);
				},
				reviewJobId: continuationId,
				reviewConfirmed: continuationId ? true : undefined,
				onReviewStatus: (review) =>
					setReviewProgress({
						review,
						conversationId: activeConversation.id,
						modelId: selectedModel,
					}),
			});
			if (result.canceled || controller.signal.aborted) {
				setPhase("canceled");
				return;
			}
			const assistantTurn: AiConversationTurn = {
				id: crypto.randomUUID(),
				role: "assistant",
				text: result.text,
				createdAt: Date.now(),
				modelId: selectedModel,
				context: userTurn.context,
			};
			const nextTitle =
				activeConversation.turns.length === 0
					? titleForPrompt(
							requested || requestedImages.map((image) => image.name).join(", "),
						)
					: activeConversation.title;
			const nextConversation: AiConversation = {
				...activeConversation,
				title: nextTitle,
				draft: "",
				modelId: selectedModel,
				updatedAt: Date.now(),
				turns: [...activeConversation.turns, userTurn, assistantTurn],
			};
			setConversation(nextConversation);
			setConversationSummaries((current) =>
				current.map((item) =>
					item.id === nextConversation.id
						? {
								...item,
								title: nextTitle,
								updatedAt: nextConversation.updatedAt,
								turnCount: nextConversation.turns.length,
								modelId: selectedModel,
							}
						: item,
				),
			);
			setPending(null);
			setPhase("idle");
			if (!activeConversation.id.startsWith("local-")) {
				try {
					await updateConversation(activeConversation.id, {
						title: nextTitle,
						draft: "",
						modelId: selectedModel,
						turns: nextConversation.turns,
					});
				} catch (error) {
					setPersistenceError(
						error instanceof Error ? error.message : String(error),
					);
				}
			}
			requestAnimationFrame(() => textareaRef.current?.focus());
		} catch (nextError) {
			if (controller.signal.aborted) {
				setPhase("canceled");
				return;
			}
			const message =
				nextError instanceof Error ? nextError.message : String(nextError);
			setPending((current) =>
				current
					? {
							...current,
							error: message,
						}
					: current,
			);
			setPhase(
				/incomplete|ended before completion/i.test(message)
					? "interrupted"
					: "error",
			);
		} finally {
			runId.current = null;
			abortController.current = null;
		}
	};

	const stop = async () => {
		setPhase("stopping");
		abortController.current?.abort();
		if (runId.current) await cancel(runId.current).catch(() => {});
	};

	const retry = () => {
		if (!pending) return;
		if (phase !== "error" && phase !== "canceled" && phase !== "interrupted")
			return;
		const retryPrompt = pending.user.text;
		const retryImages = pending.user.context?.imageAttachments;
		setPending(null);
		setPhase("idle");
		void start("ask", retryPrompt, retryImages);
	};

	const dispose = useCallback(() => {
		if (deltaFrameRef.current !== null)
			window.cancelAnimationFrame(deltaFrameRef.current);
		abortController.current?.abort();
	}, []);

	return {
		phase,
		setPhase,
		pending,
		setPending,
		runWarnings,
		setRunWarnings,
		reviewProgress,
		setReviewProgress,
		runStartedAt,
		abortController,
		start,
		stop,
		retry,
		resetRunVisuals,
		dispose,
		isBusy: isRunBusy(phase),
	};
}
