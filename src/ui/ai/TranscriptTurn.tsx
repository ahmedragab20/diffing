import { memo, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { Check, Copy, Quote, RotateCcw } from "lucide-react";
import { Markdown } from "../components/Markdown";
import type { AiConversationTurn } from "../../lib/ai/types";

/**
 * One completed assistant turn.
 *
 * Memoized deliberately: the plan requires not "reparsing the entire
 * transcript per token" and to "memoize completed turns and completed Markdown
 * blocks". A completed turn's content never changes, so re-rendering it while
 * the active response streams is pure waste — and on a long transcript it is
 * the difference between a smooth stream and a stuttering one.
 *
 * The comparator is therefore explicit: a turn re-renders only when its own
 * identity, text, copied state, model label or action callbacks change, never
 * because a sibling is streaming.
 */
export interface TranscriptTurnProps {
	turn: AiConversationTurn;
	copied: boolean;
	onCopy: (turn: AiConversationTurn) => void;
	onRetryFromHere?: (turn: AiConversationTurn) => void;
	onQuote?: (turn: AiConversationTurn, text: string) => void;
	modelLabel?: string;
}

function selectedTextIn(element: HTMLElement): string {
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0)
		return "";
	const range = selection.getRangeAt(0);
	if (!element.contains(range.commonAncestorContainer)) return "";
	return selection.toString().trim();
}

function TranscriptTurnView({
	turn,
	copied,
	onCopy,
	onRetryFromHere,
	onQuote,
	modelLabel,
}: TranscriptTurnProps) {
	const handleQuote = useCallback(
		(event: ReactMouseEvent<HTMLElement>) => {
			const article = event.currentTarget.closest("article");
			const selected = article instanceof HTMLElement ? selectedTextIn(article) : "";
			onQuote?.(turn, selected || turn.text);
		},
		[onQuote, turn],
	);

	return (
		<article className="ai-response-document" data-turn-id={turn.id}>
			<Markdown
				content={turn.text}
				className="markdown-body ai-response-markdown"
			/>
			<div className="ai-message-actions">
				{modelLabel && (
					<span className="ai-turn-model-badge">{modelLabel}</span>
				)}
				<button
					type="button"
					onClick={() => onCopy(turn)}
					aria-label={`Copy response ${turn.id}`}
				>
					{copied ? <Check size={12} /> : <Copy size={12} />}{" "}
					{copied ? "Copied" : "Copy"}
				</button>
				{onRetryFromHere && (
					<button
						type="button"
						onClick={() => onRetryFromHere(turn)}
						aria-label={`Retry from here ${turn.id}`}
					>
						<RotateCcw size={12} /> Retry from here
					</button>
				)}
				{onQuote && (
					<button
						type="button"
						onClick={handleQuote}
						aria-label={`Quote in composer ${turn.id}`}
					>
						<Quote size={12} /> Quote
					</button>
				)}
			</div>
		</article>
	);
}

export const TranscriptTurn = memo(
	TranscriptTurnView,
	(previous, next) =>
		previous.turn.id === next.turn.id &&
		previous.turn.text === next.turn.text &&
		previous.copied === next.copied &&
		previous.onCopy === next.onCopy &&
		previous.onRetryFromHere === next.onRetryFromHere &&
		previous.onQuote === next.onQuote &&
		previous.modelLabel === next.modelLabel,
);
