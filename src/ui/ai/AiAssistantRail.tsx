import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
	Check,
	Copy,
	FileText,
	GripVertical,
	ListTree,
	Paperclip,
	Pencil,
	Plus,
	Send,
	ShieldAlert,
	Sparkles,
	Square,
	Trash2,
	X,
} from "lucide-react";
import type { AiAction, AiConversationContextLabel, AiConversationTurn, AiReviewContext, AiSurface } from "../../lib/ai/types";
import type { AiConversation, AiConversationSummary } from "../../lib/ai/conversations";
import { Markdown } from "../components/Markdown";
import { FileMentionDropdown } from "../components/FileMentionDropdown";
import { useFileMention } from "../hooks/useFileMention";
import { useOptionalAi } from "./AiContext";
import { aiSourceLabel } from "./labels";
import { createConversation, deleteConversation, getConversation, listConversations, updateConversation } from "./conversationApi";

function attachedFilePaths(text: string): string[] {
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

function conversationScopeKey(surface: AiSurface, context: AiReviewContext): string {
	if (surface === "plan" && "planId" in context) return `${surface}:${context.planId}`;
	const root = "repoName" in context && context.repoName ? context.repoName : "review";
	const branch = "branch" in context && context.branch ? context.branch : "working-tree";
	return `${surface}:${root}:${branch}`;
}

function contextLabel(context: AiReviewContext, attachmentPaths: string[]): AiConversationContextLabel {
	const label: AiConversationContextLabel = { kind: context.kind, attachmentPaths };
	if ("filePath" in context && context.filePath) label.filePath = context.filePath;
	if ("version" in context) label.version = context.version;
	if (context.kind === "selection" && "selectedText" in context) label.label = "Selected context";
	if (context.kind === "comment-thread" && "commentBody" in context) label.label = "Review thread";
	return label;
}

function titleForPrompt(prompt: string): string {
	const title = prompt.replace(/\s+/g, " ").trim();
	return title.length > 54 ? `${title.slice(0, 53).trimEnd()}…` : title || "New conversation";
}

function localConversation(surface: AiSurface, scopeKey: string, modelId: string): AiConversation {
	const now = Date.now();
	return { id: `local-${crypto.randomUUID()}`, title: "New conversation", surface, scopeKey, createdAt: now, updatedAt: now, modelId, turns: [] };
}

type RunPhase = "idle" | "thinking" | "streaming" | "stopping" | "error";

interface PendingTurn {
	user: AiConversationTurn;
	assistantText: string;
	warnings: string[];
	error?: string;
}

interface AiAssistantRailProps {
	open: boolean;
	onClose: () => void;
	surface: AiSurface;
	context: AiReviewContext;
	title?: string;
}

export function AiAssistantRail(props: AiAssistantRailProps) {
	const ai = useOptionalAi();
	if (!props.open || !ai) return null;
	return <AiAssistantRailOpen {...props} ai={ai} />;
}

function AiAssistantRailOpen({ onClose, surface, context, title = "Ask AI", ai }: AiAssistantRailProps & { ai: NonNullable<ReturnType<typeof useOptionalAi>> }) {
	const [prompt, setPrompt] = useState("");
	const [conversation, setConversation] = useState<AiConversation | null>(null);
	const [conversationSummaries, setConversationSummaries] = useState<AiConversationSummary[]>([]);
	const [conversationLoading, setConversationLoading] = useState(true);
	const [phase, setPhase] = useState<RunPhase>("idle");
	const [pending, setPending] = useState<PendingTurn | null>(null);
	const [localWidth, setLocalWidth] = useState(ai.railWidth ?? 360);
	const [showJump, setShowJump] = useState(false);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [runWarnings, setRunWarnings] = useState<string[]>([]);
	const [persistenceError, setPersistenceError] = useState<string | null>(null);
	const [renaming, setRenaming] = useState(false);
	const [renameDraft, setRenameDraft] = useState("");
	const [deletePending, setDeletePending] = useState(false);
	const runId = useRef<string | null>(null);
	const abortController = useRef<AbortController | null>(null);
	const resizeCleanup = useRef<(() => void) | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const conversationRef = useRef<HTMLDivElement | null>(null);
	const followOutputRef = useRef(true);
	const forceScrollRef = useRef(false);
	const draftTimer = useRef<number | null>(null);
	const deltaFrameRef = useRef<number | null>(null);
	const latestDeltaRef = useRef("");
	const latestConversationRef = useRef<AiConversation | null>(null);
	const latestPromptRef = useRef("");
	const model = useMemo(() => ai.models.find((item) => item.id === ai.selectedModel), [ai.models, ai.selectedModel]);
	const mention = useFileMention(prompt, setPrompt);
	const attachmentPaths = useMemo(() => attachedFilePaths(prompt), [prompt]);
	const scopeKey = useMemo(() => conversationScopeKey(surface, context), [surface, context]);

	useEffect(() => {
		if (ai.railWidth) setLocalWidth(ai.railWidth);
	}, [ai.railWidth]);

	useEffect(() => {
		latestConversationRef.current = conversation;
	}, [conversation]);

	useEffect(() => {
		latestPromptRef.current = prompt;
	}, [prompt]);

	useEffect(() => () => {
		resizeCleanup.current?.();
		if (draftTimer.current) window.clearTimeout(draftTimer.current);
		if (deltaFrameRef.current !== null) window.cancelAnimationFrame(deltaFrameRef.current);
		const latestConversation = latestConversationRef.current;
		if (latestConversation && !latestConversation.id.startsWith("local-")) {
			void updateConversation(latestConversation.id, { draft: latestPromptRef.current }).catch(() => {});
		}
		abortController.current?.abort();
	}, []);

	const resizeComposer = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
	}, []);

	useLayoutEffect(() => resizeComposer(), [prompt, resizeComposer]);

	const saveDraft = useCallback((nextDraft: string) => {
		if (!conversation || conversation.id.startsWith("local-")) return;
		if (draftTimer.current) window.clearTimeout(draftTimer.current);
		draftTimer.current = window.setTimeout(() => {
			void updateConversation(conversation.id, { draft: nextDraft }).then((next) => {
				setConversation((current) => current?.id === next.id ? { ...current, draft: next.draft, updatedAt: next.updatedAt } : current);
			}).catch((error) => setPersistenceError(error instanceof Error ? error.message : String(error)));
		}, 350);
	}, [conversation]);

	useEffect(() => {
		let alive = true;
		setConversationLoading(true);
		setConversation(null);
		setPending(null);
		setPhase("idle");
		setPersistenceError(null);
		setRunWarnings([]);
		void listConversations(surface, scopeKey).then(async (summaries) => {
			if (!alive) return;
			setConversationSummaries(summaries);
			const first = summaries[0];
			if (!first) return;
			const loaded = await getConversation(first.id);
			if (!alive) return;
			setConversation(loaded);
			setPrompt(loaded.draft ?? "");
			forceScrollRef.current = true;
		}).catch((error) => {
			if (alive) setPersistenceError(error instanceof Error ? error.message : String(error));
		}).finally(() => { if (alive) setConversationLoading(false); });
		return () => { alive = false; };
	}, [scopeKey, surface]);

	const { run, cancel, selectedModel, setRailWidth } = ai;

	const queueDelta = (text: string) => {
		latestDeltaRef.current = text;
		if (deltaFrameRef.current !== null) return;
		deltaFrameRef.current = window.requestAnimationFrame(() => {
			deltaFrameRef.current = null;
			setPhase("streaming");
			setPending((current) => current ? { ...current, assistantText: latestDeltaRef.current } : current);
		});
	};

	const ensureConversation = useCallback(async (): Promise<AiConversation> => {
		if (conversation) return conversation;
		try {
			const created = await createConversation({ surface, scopeKey, modelId: selectedModel });
			setConversationSummaries((current) => [
				{ id: created.id, title: created.title, surface: created.surface, scopeKey: created.scopeKey, createdAt: created.createdAt, updatedAt: created.updatedAt, turnCount: 0, modelId: created.modelId },
				...current.filter((item) => item.id !== created.id),
			]);
			setConversation(created);
			return created;
		} catch (error) {
			setPersistenceError(error instanceof Error ? error.message : String(error));
			const fallback = localConversation(surface, scopeKey, selectedModel);
			setConversation(fallback);
			return fallback;
		}
	}, [conversation, scopeKey, selectedModel, surface]);

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
	}, [conversation?.turns.length, pending?.assistantText, phase]);

	const start = async (action: AiAction, overridePrompt?: string) => {
		const requested = (overridePrompt ?? prompt).trim();
		if (!requested || !selectedModel || (phase !== "idle" && phase !== "error")) return;
		const requestedAttachments = attachedFilePaths(prompt);
		if (!overridePrompt) {
			saveDraft("");
			setPrompt("");
			requestAnimationFrame(() => { resizeComposer(); textareaRef.current?.focus(); });
		}
		setPersistenceError(null);
		const activeConversation = await ensureConversation();
		const userTurn: AiConversationTurn = {
			id: crypto.randomUUID(),
			role: "user",
			text: requested,
			createdAt: Date.now(),
			context: contextLabel(context, requestedAttachments),
		};
		const controller = new AbortController();
		abortController.current = controller;
		setPending({ user: userTurn, assistantText: "", warnings: [] });
		setPhase("thinking");
		forceScrollRef.current = true;
		try {
			const result = await run({
				surface,
				action,
				context: { ...context, attachmentPaths: requestedAttachments },
				prompt: requested || undefined,
				history: activeConversation.turns,
				conversationId: activeConversation.id,
				signal: controller.signal,
				onStart: (id) => { runId.current = id; },
				onDelta: queueDelta,
				onWarning: (message) => {
					setRunWarnings((current) => current.includes(message) ? current : [...current, message]);
					setPending((current) => current ? { ...current, warnings: current.warnings.includes(message) ? current.warnings : [...current.warnings, message] } : current);
				},
			});
			if (result.canceled || controller.signal.aborted) {
				setPending(null);
				setPhase("idle");
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
			const nextTitle = activeConversation.turns.length === 0 ? titleForPrompt(requested) : activeConversation.title;
			const nextConversation: AiConversation = {
				...activeConversation,
				title: nextTitle,
				draft: "",
				modelId: selectedModel,
				updatedAt: Date.now(),
				turns: [...activeConversation.turns, userTurn, assistantTurn],
			};
			setConversation(nextConversation);
			setConversationSummaries((current) => current.map((item) => item.id === nextConversation.id ? { ...item, title: nextTitle, updatedAt: nextConversation.updatedAt, turnCount: nextConversation.turns.length, modelId: selectedModel } : item));
			setPending(null);
			setPhase("idle");
			if (!activeConversation.id.startsWith("local-")) {
				try {
					await updateConversation(activeConversation.id, { title: nextTitle, draft: "", modelId: selectedModel, turns: nextConversation.turns });
				} catch (error) {
					setPersistenceError(error instanceof Error ? error.message : String(error));
				}
			}
			requestAnimationFrame(() => textareaRef.current?.focus());
		} catch (nextError) {
			if (controller.signal.aborted) {
				setPending(null);
				setPhase("idle");
				return;
			}
			setPending((current) => current ? { ...current, error: nextError instanceof Error ? nextError.message : String(nextError) } : current);
			setPhase("error");
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

	const resizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = localWidth;
		let latest = startWidth;
		const move = (next: MouseEvent) => {
			latest = Math.max(320, Math.min(720, startWidth + startX - next.clientX));
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

	const setKeyboardWidth = (next: number) => {
		const width = Math.max(320, Math.min(720, next));
		setLocalWidth(width);
		void setRailWidth(width);
	};

	const newConversation = async () => {
		if (phase !== "idle") return;
		setDeletePending(false);
		setRenaming(false);
		setPrompt("");
		setPending(null);
		try {
			const created = await createConversation({ surface, scopeKey, modelId: selectedModel });
			setConversation(created);
			setConversationSummaries((current) => [{ id: created.id, title: created.title, surface: created.surface, scopeKey: created.scopeKey, createdAt: created.createdAt, updatedAt: created.updatedAt, turnCount: 0, modelId: created.modelId }, ...current]);
		} catch (error) {
			setPersistenceError(error instanceof Error ? error.message : String(error));
			setConversation(localConversation(surface, scopeKey, selectedModel));
		}
	};

	const selectConversation = async (id: string) => {
		if (phase !== "idle" || id === conversation?.id) return;
		setConversationLoading(true);
		try {
			const loaded = await getConversation(id);
			setConversation(loaded);
			setPrompt(loaded.draft ?? "");
			setPending(null);
			setRenaming(false);
			setDeletePending(false);
			forceScrollRef.current = true;
		} catch (error) {
			setPersistenceError(error instanceof Error ? error.message : String(error));
		} finally {
			setConversationLoading(false);
		}
	};

	const saveRename = async () => {
		if (!conversation || !renameDraft.trim()) return;
		if (conversation.id.startsWith("local-")) {
			setConversation({ ...conversation, title: renameDraft.trim() });
		} else {
			try {
				const next = await updateConversation(conversation.id, { title: renameDraft.trim() });
				setConversation(next);
				setConversationSummaries((current) => current.map((item) => item.id === next.id ? { ...item, title: next.title, updatedAt: next.updatedAt } : item));
			} catch (error) { setPersistenceError(error instanceof Error ? error.message : String(error)); }
		}
		setRenaming(false);
	};

	const removeCurrentConversation = async () => {
		if (!conversation || phase !== "idle") return;
		if (conversation.id.startsWith("local-")) {
			setConversation(null);
			setDeletePending(false);
			return;
		}
		try {
			await deleteConversation(conversation.id);
			const remaining = conversationSummaries.filter((item) => item.id !== conversation.id);
			setConversationSummaries(remaining);
			setConversation(null);
			setPrompt("");
			if (remaining[0]) await selectConversation(remaining[0].id);
		} catch (error) { setPersistenceError(error instanceof Error ? error.message : String(error)); }
		setDeletePending(false);
	};

	const copyMarkdown = async (turn: AiConversationTurn) => {
		try {
			await navigator.clipboard.writeText(turn.text);
			setCopiedId(turn.id ?? null);
			window.setTimeout(() => setCopiedId((current) => current === turn.id ? null : current), 1400);
		} catch { /* clipboard access is optional in embedded browsers */ }
	};

	const thirdAction = surface === "plan"
		? { action: "critique-plan" as const, prompt: "Critique this plan for missing decisions and sequencing risks.", label: "Critique plan", hint: "Challenge assumptions", icon: ListTree }
		: context.kind === "diff"
			? { action: "review-map" as const, prompt: "Generate a review order. Do not mark anything reviewed.", label: "Review map", hint: "Prioritize the diff", icon: ListTree }
			: { action: "explain-hunk" as const, prompt: "Explain the intent, risks, and missing tests in this file context.", label: "Explain context", hint: "Trace this change", icon: FileText };
	const quickActions = [
		{ action: "summarize" as const, prompt: "Summarize this review context.", label: "Summarize", hint: "Intent and impact", icon: FileText },
		{ action: surface === "plan" ? "find-plan-gaps" as const : "review-risks" as const, prompt: surface === "plan" ? "Find material gaps in this plan." : "Find material review risks.", label: surface === "plan" ? "Find gaps" : "Review risks", hint: surface === "plan" ? "Missing decisions" : "Correctness and safety", icon: ShieldAlert },
		thirdAction,
	];

	const turns = conversation?.turns ?? [];
	const isBusy = phase === "thinking" || phase === "streaming" || phase === "stopping";

	return (
		<aside className="ai-assistant-rail" aria-label={title} style={{ width: localWidth }}>
			<div className="ai-rail-resize-handle" onMouseDown={resizeStart} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setKeyboardWidth(localWidth + 16); } if (event.key === "ArrowRight") { event.preventDefault(); setKeyboardWidth(localWidth - 16); } }} role="separator" aria-label="Resize AI assistant" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={720} aria-valuenow={localWidth} tabIndex={0}><GripVertical size={13} /></div>
			<header className="ai-rail-header"><div className="ai-rail-title-icon"><Sparkles size={15} /></div><div className="ai-rail-title"><strong>{title}</strong><span>{model ? `${model.displayName} · ${aiSourceLabel(model.sourceId)}${model.credentialRoute === "runtime-key" ? " BYOK" : ""}` : "No model selected"}</span></div><button type="button" className="ai-rail-icon-btn" onClick={onClose} aria-label="Close AI assistant"><X size={15} /></button></header>

			<div className="ai-conversation-toolbar" aria-label="AI conversations"><select aria-label="AI conversation" value={conversation?.id ?? ""} disabled={conversationLoading || isBusy} onChange={(event) => void selectConversation(event.target.value)}>{!conversation && <option value="">New conversation</option>}{conversationSummaries.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button type="button" className="ai-rail-icon-btn" onClick={() => void newConversation()} disabled={isBusy} aria-label="New conversation" title="New conversation"><Plus size={14} /></button>{conversation && <><button type="button" className="ai-rail-icon-btn" onClick={() => { setRenameDraft(conversation.title); setRenaming(true); }} disabled={isBusy} aria-label="Rename conversation" title="Rename conversation"><Pencil size={13} /></button><button type="button" className="ai-rail-icon-btn" onClick={() => setDeletePending(true)} disabled={isBusy} aria-label="Delete conversation" title="Delete conversation"><Trash2 size={13} /></button></>}</div>
			{renaming && conversation && <div className="ai-conversation-inline-edit"><input aria-label="Conversation name" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveRename(); if (event.key === "Escape") setRenaming(false); }} /><button type="button" onClick={() => void saveRename()} aria-label="Save conversation name"><Check size={13} /></button><button type="button" onClick={() => setRenaming(false)} aria-label="Cancel rename"><X size={13} /></button></div>}
			{deletePending && conversation && <div className="ai-conversation-delete-confirm" role="alert"><span>Delete “{conversation.title}”?</span><button type="button" onClick={() => void removeCurrentConversation()}>Delete</button><button type="button" onClick={() => setDeletePending(false)}>Cancel</button></div>}

			<div className="ai-context-bar"><div className="ai-context-chips"><span>{context.kind === "diff" ? "whole diff" : context.kind}</span>{"filePath" in context && context.filePath && <span title={context.filePath}>{context.filePath}</span>}{"focusedFilePath" in context && context.focusedFilePath && <span title={`Current UI focus: ${context.focusedFilePath}`}>focus: {context.focusedFilePath}</span>}{"version" in context && <span>v{context.version}</span>}{attachmentPaths.map((path) => <button type="button" className="ai-attachment-chip" key={path} title={`Remove ${path}`} aria-label={`Remove ${path}`} onClick={() => setPrompt((value) => value.replace(`@${path} `, "").replace(`@${path}`, ""))}><Paperclip size={9} />{path}<X size={9} /></button>)}</div><details className="ai-share-details"><summary>Context being shared</summary><p>{context.kind === "diff" ? "The whole review scope is sent: a complete changed-file map plus diff content within the context limit. The focused file is only a navigation hint." : "Only this review context is sent."} No unrelated files, mockups, credentials, or hidden state.</p></details></div>

			<div className="ai-quick-actions" aria-label="AI quick actions">{quickActions.map(({ action, prompt: actionPrompt, label, hint, icon: Icon }) => <button type="button" key={action} disabled={isBusy || !selectedModel} onClick={() => void start(action, actionPrompt)}><Icon size={14} /><span><strong>{label}</strong><small>{hint}</small></span></button>)}</div>

			<div className={`ai-conversation ${!turns.length && !pending ? "is-empty" : ""}`} ref={conversationRef} onScroll={(event) => { const element = event.currentTarget; const distance = element.scrollHeight - element.scrollTop - element.clientHeight; const nearBottom = distance < 72; followOutputRef.current = nearBottom; setShowJump(!nearBottom && (isBusy || !!pending)); }} aria-live="polite">
				{!turns.length && !pending && <div className="ai-empty-state"><div><Sparkles size={20} /></div><strong>What do you want to understand?</strong><p>Ask a focused question, or choose a review action above. Nothing runs until you tell it to.</p></div>}
				{turns.map((turn) => turn.role === "user" ? <div className="ai-message ai-message-user" key={turn.id}>{turn.text}</div> : <article className="ai-response-document" key={turn.id}><Markdown content={turn.text} className="markdown-body ai-response-markdown" /><div className="ai-message-actions"><button type="button" onClick={() => void copyMarkdown(turn)} aria-label={`Copy response ${turn.id}`}>{copiedId === turn.id ? <Check size={12} /> : <Copy size={12} />} {copiedId === turn.id ? "Copied" : "Copy Markdown"}</button></div></article>)}
				{pending && <><div className="ai-message ai-message-user">{pending.user.text}</div>{pending.assistantText ? <article className="ai-response-document"><Markdown content={pending.assistantText} className="markdown-body ai-response-markdown" /></article> : phase === "thinking" || phase === "stopping" ? <div className="ai-thinking" role="status"><span className="ai-thinking-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span><span>{phase === "stopping" ? "Stopping this request" : "Thinking about your request"}</span></div> : null}{pending.warnings.map((warning) => <div className="ai-run-warning" key={warning} role="status">{warning}</div>)}{pending.error && <div className="ai-run-error" role="alert"><span>{pending.error}</span><button type="button" onClick={() => { const retry = pending.user.text; setPending(null); setPhase("idle"); void start("ask", retry); }} aria-label="Retry AI request">Retry</button></div>}</>}
				{!pending && runWarnings.map((warning) => <div className="ai-run-warning" key={`complete-${warning}`} role="status">{warning}</div>)}{persistenceError && <div className="ai-run-warning" role="status">Conversation history unavailable: {persistenceError}</div>}{showJump && <button type="button" className="ai-jump-latest" onClick={() => scrollToLatest()}>Jump to latest</button>}
			</div>

			<div className="ai-rail-composer"><div className="ai-composer-editor"><textarea ref={(element) => { textareaRef.current = element; mention.setTextareaRef(element); }} value={prompt} onChange={(event) => { setPrompt(event.target.value); saveDraft(event.target.value); }} onKeyDown={(event) => { if (mention.handleKeyDown(event)) return; if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && prompt.trim() && !isBusy) { event.preventDefault(); void start("ask"); } }} placeholder="Ask about this review context… Type @ to attach files" aria-label="Ask AI" />{mention.isOpen && <FileMentionDropdown results={mention.results} focusedIndex={mention.focusedIndex} query={mention.query} cursorTop={mention.cursorTop} onSelect={mention.onSelect} onHover={mention.setFocusedIndex} />}</div><div><span className="ai-composer-hint"><Paperclip size={10} /> @ attach files · ⌘↵ send</span><span />{isBusy ? <button type="button" className="ai-stop-btn" onClick={() => void stop()} disabled={phase === "stopping"} aria-label="Stop AI request"><Square size={11} /> {phase === "stopping" ? "Stopping" : "Stop"}</button> : <button type="button" className="ai-send-btn" disabled={!prompt.trim() || !selectedModel || conversationLoading} onClick={() => void start("ask")}><Send size={13} /> Send</button>}</div></div>
		</aside>
	);
}
