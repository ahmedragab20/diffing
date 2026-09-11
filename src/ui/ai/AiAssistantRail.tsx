import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
	type Ref,
} from "react";
import { FileText, GripVertical, Paperclip, Sparkles, X } from "lucide-react";
import type {
	AiConversationTurn,
	AiImageAttachmentReference,
	AiReviewContext,
	AiSurface,
} from "../../lib/ai/types";
import type { NotebookEntry } from "../../lib/ai/notebook";
import { clampRailWidth, railWidthBounds } from "./railWidth.js";
import { TranscriptShell } from "./TranscriptShell";
import { useFileMention } from "../hooks/useFileMention";
import { useOptionalAi } from "./AiContext";
import { attachedFilePaths, quickActionsFor, type AiClient } from "./railHelpers";
import { deriveRailActivity, isRunBusy, useAiRun } from "./useAiRun";
import { useAiConversations } from "./useAiConversations";
import { AiRailHeader } from "./AiRailHeader";
import { AiQuickActions } from "./AiQuickActions";
import { AiComposer } from "./AiComposer";

export interface AiAssistantRailHandle {
	focusComposer(): void;
	newConversation(): void;
	insertMention(path: string): void;
}

export interface AiAssistantRailProps {
	open: boolean;
	onClose: () => void;
	surface: AiSurface;
	context: AiReviewContext;
	title?: string;
	onRemoveSelection?: (index: number) => void;
	initialFocus?: "composer";
	ref?: Ref<AiAssistantRailHandle | null>;
}

export function AiAssistantRail({
	open,
	onClose,
	surface,
	context,
	title = "Ask AI",
	onRemoveSelection,
	initialFocus,
	ref,
}: AiAssistantRailProps) {
	const ai = useOptionalAi();
	if (!open || !ai) return null;
	return (
		<AiAssistantRailOpen
			onClose={onClose}
			surface={surface}
			context={context}
			title={title}
			onRemoveSelection={onRemoveSelection}
			initialFocus={initialFocus}
			ai={ai}
			handleRef={ref}
		/>
	);
}

function AiAssistantRailOpen({
	onClose,
	surface,
	context,
	title = "Ask AI",
	onRemoveSelection,
	initialFocus,
	ai,
	handleRef,
}: Omit<AiAssistantRailProps, "open" | "ref"> & {
	ai: AiClient;
	handleRef?: Ref<AiAssistantRailHandle | null>;
}) {
	const [prompt, setPrompt] = useState("");
	const [localWidth, setLocalWidth] = useState(ai.railWidth ?? 360);
	const [showJump, setShowJump] = useState(false);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [imageAttachments, setImageAttachments] = useState<
		AiImageAttachmentReference[]
	>([]);
	const [imageUploading, setImageUploading] = useState(false);
	const [previewAttaching, setPreviewAttaching] = useState(false);
	const [imageError, setImageError] = useState<string | null>(null);
	const [draggingImage, setDraggingImage] = useState(false);
	const [findings, setFindings] = useState<NotebookEntry[]>([]);
	const resizeCleanup = useRef<(() => void) | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const imageInputRef = useRef<HTMLInputElement | null>(null);
	const conversationRef = useRef<HTMLDivElement | null>(null);
	const followOutputRef = useRef(true);
	const forceScrollRef = useRef(true);
	const isBusyRef = useRef(false);
	const resetRunRef = useRef<() => void>(() => {});
	const model = useMemo(
		() => ai.models.find((item) => item.id === ai.selectedModel),
		[ai.models, ai.selectedModel],
	);
	const imageCapable =
		model?.supportsImages ??
		(model
			? ["codex", "openai", "anthropic", "xai"].includes(model.sourceId)
			: false);
	const mention = useFileMention(prompt, setPrompt);
	const attachmentPaths = useMemo(() => attachedFilePaths(prompt), [prompt]);
	const resetComposer = useCallback(() => {
		setImageAttachments([]);
		setImageError(null);
	}, []);

	const conversations = useAiConversations({
		surface,
		context,
		selectedModel: ai.selectedModel,
		setPrompt,
		resetComposer,
		isBusyRef,
		resetRunRef,
		forceScrollRef,
	});

	const run = useAiRun({
		ai,
		surface,
		context,
		setConversation: conversations.setConversation,
		setConversationSummaries: conversations.setConversationSummaries,
		setPersistenceError: conversations.setPersistenceError,
		prompt,
		setPrompt,
		imageAttachments,
		setImageAttachments,
		imageCapable,
		setImageError,
		ensureConversation: conversations.ensureConversation,
		saveDraft: conversations.saveDraft,
		resizeComposer: () => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
		},
		textareaRef,
		forceScrollRef,
	});

	resetRunRef.current = run.resetRunVisuals;
	isBusyRef.current = run.isBusy;

	const { setRailWidth } = ai;

	const uploadImages = useCallback(
		async (files: File[]) => {
			const accepted = files.filter((file) =>
				["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type),
			);
			if (!accepted.length) {
				setImageError("Choose a PNG, JPEG, WebP, or GIF image.");
				return;
			}
			if (!imageCapable) {
				setImageError(
					"The selected model source cannot receive images. Choose Codex or another image-capable source.",
				);
				return;
			}
			const available = Math.max(0, 4 - imageAttachments.length);
			if (available === 0) {
				setImageError("You can attach up to 4 images per message.");
				return;
			}
			setImageUploading(true);
			setImageError(null);
			try {
				const uploaded = await Promise.all(
					accepted.slice(0, available).map(async (file) => {
						const form = new FormData();
						form.append("file", file, file.name);
						const response = await fetch("/api/attachments", {
							method: "POST",
							body: form,
						});
						const body = (await response
							.json()
							.catch(() => ({}))) as Partial<AiImageAttachmentReference> & {
							error?: string;
						};
						if (!response.ok || !body.url)
							throw new Error(
								body.error || `Image upload failed (${response.status}).`,
							);
						return {
							url: body.url,
							name: body.name || file.name,
							mimeType: body.mimeType || file.type,
							size: body.size ?? file.size,
						};
					}),
				);
				setImageAttachments((current) => [...current, ...uploaded].slice(0, 4));
			} catch (error) {
				setImageError(error instanceof Error ? error.message : String(error));
			} finally {
				setImageUploading(false);
			}
		},
		[imageAttachments.length, imageCapable],
	);

	const attachMockupPreview = async () => {
		if (surface !== "mockup" || !("mockupId" in context)) return;
		if (!imageCapable) {
			setImageError(
				"The selected model source cannot receive images. Choose Codex or another image-capable source.",
			);
			return;
		}
		setPreviewAttaching(true);
		setImageError(null);
		try {
			const params = new URLSearchParams({ view: "preview" });
			if (context.screenId) params.set("screen", context.screenId);
			if (context.viewport) params.set("viewport", context.viewport);
			const response = await fetch(
				`/api/mockups/${encodeURIComponent(context.mockupId)}/inspect?${params}`,
			);
			const body = (await response.json().catch(() => ({}))) as {
				available?: boolean;
				reason?: string;
				screenshotBase64?: string;
				mime?: string;
				error?: string;
			};
			if (!response.ok)
				throw new Error(body.error || `Preview failed (${response.status}).`);
			if (!body.available || !body.screenshotBase64) {
				setImageError(body.reason || "Preview screenshot is not available.");
				return;
			}
			const mime = body.mime || "image/png";
			const binary = atob(body.screenshotBase64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
			const file = new File(
				[bytes],
				`${context.screenId ?? "mockup"}-preview.png`,
				{ type: mime },
			);
			await uploadImages([file]);
		} catch (error) {
			setImageError(error instanceof Error ? error.message : String(error));
		} finally {
			setPreviewAttaching(false);
		}
	};

	useEffect(() => {
		if (ai.railWidth) setLocalWidth(ai.railWidth);
	}, [ai.railWidth]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const reclamp = () => {
			setLocalWidth((current) => {
				const next = clampRailWidth(current, window.innerWidth);
				return next === null ? current : next;
			});
		};
		reclamp();
		window.addEventListener("resize", reclamp);
		return () => window.removeEventListener("resize", reclamp);
	}, []);

	useEffect(
		() => () => {
			resizeCleanup.current?.();
			conversations.disposeDraftTimer();
			run.dispose();
		},
		[conversations.disposeDraftTimer, run.dispose],
	);

	const resizeComposer = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
	}, []);

	useLayoutEffect(() => resizeComposer(), [prompt, resizeComposer]);

	useEffect(() => {
		conversations.latestPromptRef.current = prompt;
	}, [conversations.latestPromptRef, prompt]);

	useEffect(() => {
		let alive = true;
		const loadFindings = async () => {
			try {
				const list = await fetch("/api/ai/evidence");
				if (!list.ok) return;
				const body = (await list.json()) as { snapshots?: { id: string }[] };
				const id = body.snapshots?.at(-1)?.id;
				if (!id) {
					if (alive) setFindings((current) => (current.length === 0 ? current : []));
					return;
				}
				const notebookResponse = await fetch(
					`/api/ai/evidence/${encodeURIComponent(id)}/notebook`,
				);
				if (!notebookResponse.ok) return;
				const notebook = (await notebookResponse.json()) as {
					entries?: NotebookEntry[];
				};
				if (alive) setFindings(notebook.entries ?? []);
			} catch {
				if (alive) setFindings((current) => (current.length === 0 ? current : []));
			}
		};
		void loadFindings();
		return () => {
			alive = false;
		};
	}, [
		conversations.conversation?.id,
		conversations.conversation?.turns.length,
		conversations.scopeKey,
		surface,
	]);

	const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
		const element = conversationRef.current;
		if (!element) return;
		element.scrollTo({ top: element.scrollHeight, behavior });
		followOutputRef.current = true;
		setShowJump(false);
	}, []);

	useLayoutEffect(() => {
		const element = conversationRef.current;
		if (!element) return;
		if (forceScrollRef.current || followOutputRef.current) {
			element.scrollTop = element.scrollHeight;
			forceScrollRef.current = false;
			setShowJump(false);
		}
	}, [conversations.conversation?.turns.length, run.pending?.assistantText, run.phase]);

	useEffect(() => {
		if (initialFocus === "composer") textareaRef.current?.focus();
	}, [initialFocus]);

	const insertMention = useCallback(
		(path: string) => {
			const insertion = `@${path} `;
			setPrompt((current) => {
				if (current.includes(`@${path}`)) return current;
				const trimmed = current.trimEnd();
				const next = trimmed ? `${trimmed} ${insertion}` : insertion;
				conversations.saveDraft(next);
				return next;
			});
			requestAnimationFrame(() => textareaRef.current?.focus());
		},
		[conversations.saveDraft],
	);

	useImperativeHandle(
		handleRef,
		() => ({
			focusComposer() {
				textareaRef.current?.focus();
			},
			newConversation() {
				void conversations.newConversation();
			},
			insertMention,
		}),
		[conversations.newConversation, insertMention],
	);

	const resizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = localWidth;
		let latest = startWidth;
		const move = (next: MouseEvent) => {
			const width = clampRailWidth(
				startWidth + startX - next.clientX,
				window.innerWidth,
			);
			if (width === null) return;
			latest = width;
			setLocalWidth(latest);
			document.documentElement.style.setProperty("--ai-rail-width", `${latest}px`);
		};
		const finish = () => {
			document.removeEventListener("mousemove", move);
			document.removeEventListener("mouseup", finish);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			resizeCleanup.current = null;
			void setRailWidth(latest);
		};
		resizeCleanup.current = finish;
		document.addEventListener("mousemove", move);
		document.addEventListener("mouseup", finish);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	};

	const announcedBounds = railWidthBounds(
		typeof window === "undefined" ? Number.NaN : window.innerWidth,
	);

	const setKeyboardWidth = (next: number) => {
		const width = clampRailWidth(
			next,
			typeof window === "undefined" ? Number.NaN : window.innerWidth,
		);
		if (width === null) return;
		setLocalWidth(width);
		void setRailWidth(width);
	};

	const copyMarkdown = useCallback(async (turn: AiConversationTurn) => {
		try {
			await navigator.clipboard.writeText(turn.text);
			setCopiedId(turn.id ?? null);
			window.setTimeout(
				() => setCopiedId((current) => (current === turn.id ? null : current)),
				1400,
			);
		} catch {
			/* clipboard access is optional in embedded browsers */
		}
	}, []);

	const handleCopy = useCallback(
		(turn: AiConversationTurn) => {
			void copyMarkdown(turn);
		},
		[copyMarkdown],
	);

	const quickActions = quickActionsFor(surface, context);
	const turns = conversations.conversation?.turns ?? [];
	const isBusy = run.isBusy;
	const activity = deriveRailActivity(
		run.phase,
		run.pending,
		run.runStartedAt.current ? Date.now() - run.runStartedAt.current : 0,
		turns.length > 0,
	);
	const showComposed =
		turns.length > 0 || run.pending !== null || findings.length > 0;

	return (
		<aside
			className="ai-assistant-rail"
			aria-label={title}
			style={{ width: localWidth }}
		>
			<div
				className="ai-rail-resize-handle"
				onMouseDown={resizeStart}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft") {
						event.preventDefault();
						setKeyboardWidth(localWidth + 16);
					}
					if (event.key === "ArrowRight") {
						event.preventDefault();
						setKeyboardWidth(localWidth - 16);
					}
				}}
				role="separator"
				aria-label="Resize AI assistant"
				aria-orientation="vertical"
				aria-valuemin={announcedBounds.min}
				aria-valuemax={announcedBounds.max}
				aria-valuenow={localWidth}
				tabIndex={0}
			>
				<GripVertical size={13} />
			</div>
			<AiRailHeader
				title={title}
				model={model}
				onClose={onClose}
				switcher={{
					conversation: conversations.conversation,
					conversationSummaries: conversations.conversationSummaries,
					conversationLoading: conversations.conversationLoading,
					isBusy,
					renaming: conversations.renaming,
					renameDraft: conversations.renameDraft,
					deletePending: conversations.deletePending,
					onSelect: (id) => void conversations.selectConversation(id),
					onNew: () => void conversations.newConversation(),
					onBeginRename: () => {
						if (!conversations.conversation) return;
						conversations.setRenameDraft(conversations.conversation.title);
						conversations.setRenaming(true);
					},
					onRenameDraftChange: conversations.setRenameDraft,
					onSaveRename: () => void conversations.saveRename(),
					onCancelRename: () => conversations.setRenaming(false),
					onBeginDelete: () => conversations.setDeletePending(true),
					onConfirmDelete: () => void conversations.removeCurrentConversation(),
					onCancelDelete: () => conversations.setDeletePending(false),
				}}
			/>

			<div className="ai-context-bar">
				<div className="ai-context-chips">
					<span>{context.kind === "diff" ? "whole diff" : context.kind}</span>
					{"filePath" in context && context.filePath && (
						<span title={context.filePath}>{context.filePath}</span>
					)}
					{"focusedFilePath" in context && context.focusedFilePath && (
						<span title={`Current UI focus: ${context.focusedFilePath}`}>
							focus: {context.focusedFilePath}
						</span>
					)}
					{"version" in context && <span>v{context.version}</span>}
					{"screenId" in context && context.screenId && (
						<span>
							{("screenLabel" in context && context.screenLabel) || context.screenId}
						</span>
					)}
					{"viewport" in context && context.viewport && (
						<span>{context.viewport}</span>
					)}
					{"selections" in context &&
						context.selections?.map((selection, index) => (
							<button
								type="button"
								className="ai-attachment-chip"
								key={`${selection.filePath}:${selection.side}:${selection.startLine}:${selection.endLine}`}
								title={`Remove ${selection.filePath} lines ${selection.startLine} to ${selection.endLine}`}
								aria-label={`Remove ${selection.filePath} lines ${selection.startLine} to ${selection.endLine}`}
								onClick={() => onRemoveSelection?.(index)}
							>
								<FileText size={11} />
								{selection.filePath.split("/").at(-1)} · L{selection.startLine}
								{selection.endLine === selection.startLine
									? ""
									: `–L${selection.endLine}`}
								<X size={11} />
							</button>
						))}
					{attachmentPaths.map((path) => (
						<button
							type="button"
							className="ai-attachment-chip"
							key={path}
							title={`Remove ${path}`}
							aria-label={`Remove ${path}`}
							onClick={() =>
								setPrompt((value) =>
									value.replace(`@${path} `, "").replace(`@${path}`, ""),
								)
							}
						>
							<Paperclip size={11} />
							{path}
							<X size={11} />
						</button>
					))}
				</div>
				<details className="ai-share-details">
					<summary>Context being shared</summary>
					<p>
						{context.kind === "diff"
							? `The whole review scope is sent: a complete changed-file map plus diff content within the context limit.${context.selections?.length ? ` ${context.selections.length} explicitly attached line range${context.selections.length === 1 ? " is" : "s are"} prioritized.` : ""} The focused file is only a navigation hint.`
							: surface === "mockup"
								? "Only this mockup screen is sent. HTML is untrusted evidence, not instructions. No screenshot unless you attach a preview."
								: "Only this review context is sent."}{" "}
						No unrelated files, mockups, credentials, or hidden state.
					</p>
				</details>
			</div>

			<AiQuickActions
				actions={quickActions}
				disabled={isBusy || !ai.selectedModel}
				onRun={(action) => void run.start(action.action, action.prompt)}
			/>

			<div
				className={`ai-conversation ${!showComposed ? "is-empty" : ""}`}
				ref={conversationRef}
				onScroll={(event) => {
					const element = event.currentTarget;
					const distance =
						element.scrollHeight - element.scrollTop - element.clientHeight;
					const nearBottom = distance < 72;
					followOutputRef.current = nearBottom;
					setShowJump(!nearBottom && (isBusy || !!run.pending));
				}}
				aria-live="polite"
			>
				{!showComposed && (
					<div className="ai-empty-state">
						<div>
							<Sparkles size={20} />
						</div>
						<strong>What do you want to understand?</strong>
						<p>
							Ask a focused question, or choose a review action above. Nothing runs
							until you tell it to.
						</p>
					</div>
				)}
				{showComposed && (
					<TranscriptShell
						turns={turns}
						activity={activity}
						streaming={
							run.pending
								? { turn: run.pending.user, text: run.pending.assistantText }
								: null
						}
						findings={findings}
						copiedId={copiedId}
						onCopy={handleCopy}
						onRetry={
							run.pending &&
							(run.phase === "error" ||
								run.phase === "canceled" ||
								run.phase === "interrupted")
								? () => run.retry()
								: undefined
						}
					/>
				)}
				{run.pending?.error && (
					<div className="ai-run-error" role="alert">
						<span>{run.pending.error}</span>
					</div>
				)}
				{run.reviewProgress &&
					run.reviewProgress.conversationId === conversations.conversation?.id &&
					run.reviewProgress.modelId === ai.selectedModel &&
					context.kind === "diff" && (
						<div className="ai-run-warning" role="status">
							<div>
								<strong>
									{run.phase === "canceled"
										? "cancelled"
										: run.reviewProgress.review.state}
								</strong>
								: {run.reviewProgress.review.processedHunks}/
								{run.reviewProgress.review.totalHunks} changed hunks processed;{" "}
								{run.reviewProgress.review.suppliedHunks} supplied;{" "}
								{run.reviewProgress.review.completedBatches}/
								{run.reviewProgress.review.estimatedBatches} estimated batches
								completed; {run.reviewProgress.review.pendingGroups} groups remaining;{" "}
								{run.reviewProgress.review.calls} provider calls;{" "}
								{run.reviewProgress.review.gapCount} evidence gaps.
							</div>
							<div>Evidence counters do not certify review quality.</div>
							{run.reviewProgress.review.canContinue && (
								<button
									type="button"
									disabled={isRunBusy(run.phase)}
									onClick={() =>
										void run.start(
											"review-risks",
											"Continue the bounded risk review.",
											[],
											run.reviewProgress?.review.jobId,
										)
									}
								>
									Continue review (up to 4 calls)
								</button>
							)}
						</div>
					)}
				{!run.pending &&
					run.runWarnings.map((warning) => (
						<div className="ai-run-warning" key={`complete-${warning}`} role="status">
							{warning}
						</div>
					))}
				{conversations.persistenceError && (
					<div className="ai-run-warning" role="status">
						Conversation history unavailable: {conversations.persistenceError}
					</div>
				)}
				{showJump && (
					<button
						type="button"
						className="ai-jump-latest"
						onClick={() => scrollToLatest()}
					>
						Jump to latest
					</button>
				)}
			</div>

			<AiComposer
				surface={surface}
				context={context}
				prompt={prompt}
				onPromptChange={(value) => {
					setPrompt(value);
					conversations.saveDraft(value);
				}}
				mention={mention}
				textareaRef={textareaRef}
				imageInputRef={imageInputRef}
				imageAttachments={imageAttachments}
				onRemoveImage={(url) =>
					setImageAttachments((current) => current.filter((item) => item.url !== url))
				}
				onUploadImages={(files) => void uploadImages(files)}
				onAttachPreview={() => void attachMockupPreview()}
				imageCapable={imageCapable}
				imageUploading={imageUploading}
				previewAttaching={previewAttaching}
				imageError={imageError}
				draggingImage={draggingImage}
				onDraggingImage={setDraggingImage}
				phase={run.phase}
				conversationLoading={conversations.conversationLoading}
				selectedModel={ai.selectedModel}
				onSend={() => void run.start("ask")}
				onStop={() => void run.stop()}
			/>
		</aside>
	);
}
