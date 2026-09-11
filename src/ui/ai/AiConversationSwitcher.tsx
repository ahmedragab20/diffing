import { useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import type {
	AiConversation,
	AiConversationSummary,
} from "../../lib/ai/conversations";
import { Popover } from "../primitives/Popover";
import { timeAgo } from "../utils";

export interface AiConversationSwitcherProps {
	conversation: AiConversation | null;
	conversationSummaries: AiConversationSummary[];
	conversationLoading: boolean;
	isBusy: boolean;
	renaming: boolean;
	renameDraft: string;
	deletePending: boolean;
	onSelect: (id: string) => void;
	onNew: () => void;
	onBeginRename: () => void;
	onRenameDraftChange: (value: string) => void;
	onSaveRename: () => void;
	onCancelRename: () => void;
	onBeginDelete: () => void;
	onConfirmDelete: () => void;
	onCancelDelete: () => void;
}

export function AiConversationSwitcher({
	conversation,
	conversationSummaries,
	conversationLoading,
	isBusy,
	renaming,
	renameDraft,
	deletePending,
	onSelect,
	onNew,
	onBeginRename,
	onRenameDraftChange,
	onSaveRename,
	onCancelRename,
	onBeginDelete,
	onConfirmDelete,
	onCancelDelete,
}: AiConversationSwitcherProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const disabled = conversationLoading || isBusy;

	return (
		<>
			<div className="ai-conversation-toolbar" aria-label="AI conversations">
				<Popover
					open={menuOpen}
					onOpenChange={setMenuOpen}
					ariaLabel="AI conversations"
					className="ai-conversation-popover"
					align="start"
					trigger={
						<button
							type="button"
							className="ai-conversation-trigger"
							aria-label="AI conversation"
							disabled={disabled}
						>
							<span>
								{conversation?.title ?? "New conversation"}
							</span>
							<ChevronDown size={12} />
						</button>
					}
				>
					<div className="ai-conversation-menu">
						{conversationSummaries.length === 0 && (
							<div className="ai-conversation-empty">No conversations yet.</div>
						)}
						{conversationSummaries.map((item) => (
							<button
								type="button"
								key={item.id}
								className={`ai-conversation-option ${item.id === conversation?.id ? "is-selected" : ""}`}
								onClick={() => {
									onSelect(item.id);
									setMenuOpen(false);
								}}
							>
								<span>
									<strong>{item.title}</strong>
									<small>
										{timeAgo(item.updatedAt)} · {item.turnCount}{" "}
										{item.turnCount === 1 ? "turn" : "turns"}
									</small>
								</span>
								{item.id === conversation?.id && <span>✓</span>}
							</button>
						))}
					</div>
				</Popover>
				<button
					type="button"
					className="ai-rail-icon-btn"
					onClick={() => void onNew()}
					disabled={isBusy}
					aria-label="New conversation"
					title="New conversation"
				>
					<Plus size={14} />
				</button>
				{conversation && (
					<>
						<button
							type="button"
							className="ai-rail-icon-btn"
							onClick={onBeginRename}
							disabled={isBusy}
							aria-label="Rename conversation"
							title="Rename conversation"
						>
							<Pencil size={13} />
						</button>
						<button
							type="button"
							className="ai-rail-icon-btn"
							onClick={onBeginDelete}
							disabled={isBusy}
							aria-label="Delete conversation"
							title="Delete conversation"
						>
							<Trash2 size={13} />
						</button>
					</>
				)}
			</div>
			{renaming && conversation && (
				<div className="ai-conversation-inline-edit">
					<input
						aria-label="Conversation name"
						value={renameDraft}
						onChange={(event) => onRenameDraftChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void onSaveRename();
							if (event.key === "Escape") onCancelRename();
						}}
					/>
					<button
						type="button"
						onClick={() => void onSaveRename()}
						aria-label="Save conversation name"
					>
						<Check size={13} />
					</button>
					<button
						type="button"
						onClick={onCancelRename}
						aria-label="Cancel rename"
					>
						<X size={13} />
					</button>
				</div>
			)}
			{deletePending && conversation && (
				<div className="ai-conversation-delete-confirm" role="alert">
					<span>Delete “{conversation.title}”?</span>
					<button type="button" onClick={() => void onConfirmDelete()}>
						Delete
					</button>
					<button type="button" onClick={onCancelDelete}>
						Cancel
					</button>
				</div>
			)}
		</>
	);
}
