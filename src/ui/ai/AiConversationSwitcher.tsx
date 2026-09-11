import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type {
	AiConversation,
	AiConversationSummary,
} from "../../lib/ai/conversations";

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
	return (
		<>
			<div className="ai-conversation-toolbar" aria-label="AI conversations">
				<select
					aria-label="AI conversation"
					value={conversation?.id ?? ""}
					disabled={conversationLoading || isBusy}
					onChange={(event) => void onSelect(event.target.value)}
				>
					{!conversation && <option value="">New conversation</option>}
					{conversationSummaries.map((item) => (
						<option key={item.id} value={item.id}>
							{item.title}
						</option>
					))}
				</select>
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
