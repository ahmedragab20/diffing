import { Plug, Sparkles } from "lucide-react";
import type { AiSurface } from "../../lib/ai/types";
import { emptyStateCopy } from "./railHelpers";

export interface AiEmptyStateProps {
	surface: AiSurface;
	onPickExample: (prompt: string) => void;
	showConnect?: boolean;
	onOpenConnections?: () => void;
}

export function AiEmptyState({
	surface,
	onPickExample,
	showConnect = false,
	onOpenConnections,
}: AiEmptyStateProps) {
	const copy = emptyStateCopy(surface);
	return (
		<div className="ai-empty-state">
			<div className="ai-empty-icon">
				<Sparkles size={20} />
			</div>
			<strong>{copy.title}</strong>
			<p>
				Ask a focused question, choose an action above, or type{" "}
				<kbd className="vim-kbd-small">/</kbd> for more.
			</p>
			<div className="ai-empty-examples">
				{copy.examples.map((example) => (
					<button
						type="button"
						key={example}
						className="ai-empty-example"
						onClick={() => onPickExample(example)}
					>
						{example}
					</button>
				))}
			</div>
			{showConnect && onOpenConnections && (
				<button
					type="button"
					className="ai-empty-connect"
					onClick={onOpenConnections}
				>
					<Plug size={14} /> Connect AI
				</button>
			)}
			<p className="ai-empty-shortcuts">
				<kbd className="vim-kbd-small">a</kbd> toggles this panel ·{" "}
				<kbd className="vim-kbd-small">/</kbd> for actions ·{" "}
				<kbd className="vim-kbd-small">Enter</kbd> to send ·{" "}
				<kbd className="vim-kbd-small">?</kbd> for all shortcuts
			</p>
		</div>
	);
}
