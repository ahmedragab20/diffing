import { Fragment, memo } from "react";
import { Markdown } from "../components/Markdown";
import { ActivityList } from "./ActivityList";
import { FindingCard } from "./FindingCard";
import { TranscriptTurn } from "./TranscriptTurn";
import type { RunActivity } from "../../lib/ai/activity";
import type { NotebookEntry } from "../../lib/ai/notebook";
import type { AiConversationTurn, AiModel } from "../../lib/ai/types";
import type { CitationStatus } from "./FindingCard";

/**
 * The composed transcript the assistant rail mounts: completed turns, the
 * in-flight response, run activity, cited findings, and retry after a
 * terminal failure.
 *
 * Composition rules that are not cosmetic:
 *  - Completed turns render through the memoized component, so a streamed
 *    token does not re-parse the transcript above it.
 *  - The active response is rendered separately and never merged into the
 *    completed list, so a stream cannot rewrite settled history.
 *  - Activity sits with the active response, not at the top, so a long
 *    transcript does not push the run's status off screen.
 */
export interface TranscriptShellProps {
	turns: AiConversationTurn[];
	activity: RunActivity;
	/** The streaming response, if one is in flight. */
	streaming?: { turn: AiConversationTurn; text: string } | null;
	findings?: NotebookEntry[];
	verification?: Record<string, CitationStatus>;
	copiedId?: string | null;
	onCopy: (turn: AiConversationTurn) => void;
	onRetry?: () => void;
	onRetryFromHere?: (turn: AiConversationTurn) => void;
	onQuote?: (turn: AiConversationTurn, text: string) => void;
	models?: AiModel[];
	streamingModel?: string;
}

function dayKey(timestamp?: number): string | null {
	if (!timestamp) return null;
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDay(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function modelLabelFor(
	turn: AiConversationTurn,
	models: AiModel[] | undefined,
): string | undefined {
	if (!turn.modelId) return undefined;
	return (
		models?.find((model) => model.id === turn.modelId)?.displayName ??
		turn.modelId
	);
}

function UserTurn({ turn }: { turn: AiConversationTurn }) {
	const images = turn.context?.imageAttachments ?? [];
	const attachments = turn.context?.attachmentPaths ?? [];
	const selections = turn.context?.selectionLabels ?? [];
	const hasChips =
		!!turn.context?.filePath ||
		!!turn.context?.label ||
		attachments.length > 0 ||
		selections.length > 0;
	return (
		<article className="ai-message ai-message-user" data-turn-id={turn.id}>
			<span>{turn.text}</span>
			{hasChips && (
				<div className="ai-turn-chips">
					{turn.context?.label && (
						<span className="ai-turn-chip">{turn.context.label}</span>
					)}
					{turn.context?.filePath && (
						<span className="ai-turn-chip" title={turn.context.filePath}>
							{turn.context.filePath}
						</span>
					)}
					{selections.map((label) => (
						<span className="ai-turn-chip" key={label}>
							{label}
						</span>
					))}
					{attachments.map((path) => (
						<span className="ai-turn-chip" key={path}>
							@{path}
						</span>
					))}
				</div>
			)}
			{images.length > 0 && (
				<div className="ai-message-images">
					{images.map((image) => (
						<img
							key={image.url}
							src={image.url}
							alt={image.name}
							title={image.name}
						/>
					))}
				</div>
			)}
		</article>
	);
}

function TranscriptShellView({
	turns,
	activity,
	streaming,
	findings = [],
	verification,
	copiedId,
	onCopy,
	onRetry,
	onRetryFromHere,
	onQuote,
	models,
	streamingModel,
}: TranscriptShellProps) {
	const terminalFailure =
		activity.phase === "failed" ||
		activity.phase === "interrupted" ||
		activity.phase === "canceled";
	const waiting =
		activity.phase === "preparing" ||
		activity.phase === "responding" ||
		activity.phase === "cancel-requested";

	return (
		<div className="ai-transcript" data-phase={activity.phase}>
			{turns.length === 0 && !streaming && findings.length === 0 && (
				<p className="ai-transcript-empty">
					Nothing has been asked in this conversation yet.
				</p>
			)}

			{turns.map((turn, index) => {
				const previous = turns[index - 1];
				const showDay =
					!!turn.createdAt &&
					dayKey(previous?.createdAt) !== dayKey(turn.createdAt) &&
					(index === 0 || dayKey(previous?.createdAt) !== null);
				const body =
					turn.role === "user" ? (
						<UserTurn turn={turn} />
					) : (
						<TranscriptTurn
							turn={turn}
							copied={copiedId === turn.id}
							onCopy={onCopy}
							onRetryFromHere={onRetryFromHere}
							onQuote={onQuote}
							modelLabel={modelLabelFor(turn, models)}
						/>
					);
				return (
					<Fragment key={turn.id ?? `${turn.role}-${index}`}>
						{showDay && turn.createdAt && (
							<div className="ai-day-separator">{formatDay(turn.createdAt)}</div>
						)}
						{body}
					</Fragment>
				);
			})}

			{findings.length > 0 && (
				<section className="ai-transcript-findings" aria-label="Cited findings">
					{findings.map((entry) => (
						<FindingCard
							key={entry.id}
							entry={entry}
							verification={verification}
						/>
					))}
				</section>
			)}

			{streaming && (
				<>
					<UserTurn turn={streaming.turn} />
					{streaming.text ? (
						<>
							<article className="ai-response-document" data-streaming="true">
								<Markdown
									content={streaming.text}
									className="markdown-body ai-response-markdown"
								/>
							</article>
							<div className="ai-streaming-meta" role="status">
								{streamingModel || "Model"} ·{" "}
								{(activity.elapsedMs / 1000).toFixed(1)}s
							</div>
						</>
					) : waiting ? (
						<div className="ai-thinking" role="status">
							<span className="ai-thinking-mark" aria-hidden="true" />
							<span>
								{activity.phase === "cancel-requested"
									? "Stopping this request"
									: "Thinking about your request"}
							</span>
						</div>
					) : null}
				</>
			)}

			<ActivityList activity={activity} />

			{terminalFailure && onRetry && (
				<div className="ai-transcript-retry">
					<button type="button" className="btn btn-sm" onClick={onRetry}>
						Try again
					</button>
					{/* A retry is a new attempt, never an overwrite of this one. */}
					<span>This starts a new attempt and keeps the one above.</span>
				</div>
			)}
		</div>
	);
}

export const TranscriptShell = memo(TranscriptShellView);
