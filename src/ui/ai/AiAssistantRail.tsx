import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
	Copy,
	FileText,
	GripVertical,
	ListTree,
	Paperclip,
	Send,
	ShieldAlert,
	Sparkles,
	Square,
	X,
} from "lucide-react";
import type { AiAction, AiReviewContext, AiSurface } from "../../lib/ai/types";
import { Markdown } from "../components/Markdown";
import { FileMentionDropdown } from "../components/FileMentionDropdown";
import { useFileMention } from "../hooks/useFileMention";
import { useOptionalAi } from "./AiContext";

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
	const [lastPrompt, setLastPrompt] = useState("");
	const [answer, setAnswer] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [localWidth, setLocalWidth] = useState(ai?.railWidth ?? 360);
	const runId = useRef<string | null>(null);
	const conversationId = useRef(crypto.randomUUID());
	const resizeCleanup = useRef<(() => void) | null>(null);
	const model = useMemo(() => ai?.models.find((item) => item.id === ai.selectedModel), [ai?.models, ai?.selectedModel]);
	const mention = useFileMention(prompt, setPrompt);
	const attachmentPaths = useMemo(() => attachedFilePaths(prompt), [prompt]);

	useEffect(() => {
		if (ai?.railWidth) setLocalWidth(ai.railWidth);
	}, [ai?.railWidth]);

	useEffect(() => () => resizeCleanup.current?.(), []);

	const { run, cancel, selectedModel, setRailWidth } = ai;

	const start = async (action: AiAction, overridePrompt?: string) => {
		const requested = (overridePrompt ?? prompt).trim();
		setRunning(true);
		setError(null);
		setAnswer("");
		setLastPrompt(requested);
		try {
			const result = await run({
				surface,
				action,
				context: { ...context, attachmentPaths },
				prompt: requested || undefined,
				conversationId: conversationId.current,
				onDelta: setAnswer,
				onStart: (id) => { runId.current = id; },
			});
			setAnswer(result.text);
			if (!overridePrompt) setPrompt("");
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : String(nextError));
		} finally {
			setRunning(false);
			runId.current = null;
		}
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

	return (
		<aside className="ai-assistant-rail" aria-label={title} style={{ width: localWidth }}>
			<div
				className="ai-rail-resize-handle"
				onMouseDown={resizeStart}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft") { event.preventDefault(); setKeyboardWidth(localWidth + 16); }
					if (event.key === "ArrowRight") { event.preventDefault(); setKeyboardWidth(localWidth - 16); }
				}}
				role="separator"
				aria-label="Resize AI assistant"
				aria-orientation="vertical"
				aria-valuemin={320}
				aria-valuemax={720}
				aria-valuenow={localWidth}
				tabIndex={0}
			>
				<GripVertical size={13} />
			</div>

			<header className="ai-rail-header">
				<div className="ai-rail-title-icon"><Sparkles size={15} /></div>
				<div className="ai-rail-title"><strong>{title}</strong><span>{model ? `${model.displayName} · ${model.sourceId}${model.credentialRoute === "runtime-key" ? " BYOK" : ""}` : "No model selected"}</span></div>
				<button type="button" className="ai-rail-icon-btn" onClick={onClose} aria-label="Close AI assistant"><X size={15} /></button>
			</header>

			<div className="ai-context-bar">
				<div className="ai-context-chips"><span>{context.kind}</span>{"filePath" in context && context.filePath && <span title={context.filePath}>{context.filePath}</span>}{"version" in context && <span>v{context.version}</span>}{attachmentPaths.map((path) => <button type="button" className="ai-attachment-chip" key={path} title={`Remove ${path}`} aria-label={`Remove ${path}`} onClick={() => setPrompt((value) => value.replace(`@${path} `, "").replace(`@${path}`, ""))}><Paperclip size={9} />{path}<X size={9} /></button>)}</div>
				<details className="ai-share-details"><summary>Context being shared</summary><p>Only this review context is sent. No unrelated files, mockups, credentials, or hidden state.</p></details>
			</div>

			<div className="ai-quick-actions" aria-label="AI quick actions">
				{quickActions.map(({ action, prompt: actionPrompt, label, hint, icon: Icon }) => (
					<button type="button" key={action} disabled={running} onClick={() => void start(action, actionPrompt)}>
						<Icon size={14} /><span><strong>{label}</strong><small>{hint}</small></span>
					</button>
				))}
			</div>

			<div className={`ai-conversation ${!answer && !running && !error ? "is-empty" : ""}`} aria-live="polite">
				{!answer && !running && !error && (
					<div className="ai-empty-state"><div><Sparkles size={20} /></div><strong>What do you want to understand?</strong><p>Ask a focused question, or choose a review action above. Nothing runs until you tell it to.</p></div>
				)}
				{lastPrompt && (answer || running || error) && <div className="ai-message ai-message-user">{lastPrompt}</div>}
				{running && !answer && <div className="ai-message ai-message-loading"><span /><span /><span /></div>}
				{answer && <article className="ai-response-document"><Markdown content={answer} className="markdown-body ai-response-markdown" /><div className="ai-message-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(answer)}><Copy size={12} /> Copy Markdown</button></div></article>}
				{error && <div className="ai-run-error" role="alert">{error}</div>}
			</div>

			<div className="ai-rail-composer">
				<div className="ai-composer-editor">
					<textarea
						ref={(element) => mention.setTextareaRef(element)}
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						onKeyDown={(event) => {
							if (mention.handleKeyDown(event)) return;
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && prompt.trim() && !running) { event.preventDefault(); void start("ask"); }
						}}
						placeholder="Ask about this review context… Type @ to attach files"
						aria-label="Ask AI"
					/>
					{mention.isOpen && <FileMentionDropdown results={mention.results} focusedIndex={mention.focusedIndex} query={mention.query} cursorTop={mention.cursorTop} onSelect={mention.onSelect} onHover={mention.setFocusedIndex} />}
				</div>
				<div><span className="ai-composer-hint"><Paperclip size={10} /> @ attach files · ⌘↵ send</span><span />{running ? <button type="button" className="ai-stop-btn" onClick={() => runId.current && void cancel(runId.current)}><Square size={11} /> Stop</button> : <button type="button" className="ai-send-btn" disabled={!prompt.trim() || !selectedModel} onClick={() => void start("ask")}><Send size={13} /> Send</button>}</div>
			</div>
		</aside>
	);
}
