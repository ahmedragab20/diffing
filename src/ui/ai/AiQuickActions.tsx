import { aiShortcutKeys } from "./aiShortcuts";
import type { RailQuickAction } from "./railHelpers";

const QUICK_ACTION_IDS = [
	"quick-action-1",
	"quick-action-2",
	"quick-action-3",
] as const;

export interface AiQuickActionsProps {
	actions: RailQuickAction[];
	disabled: boolean;
	onRun: (action: RailQuickAction) => void;
}

export function AiQuickActions({
	actions,
	disabled,
	onRun,
}: AiQuickActionsProps) {
	return (
		<div className="ai-quick-actions" aria-label="AI quick actions">
			{actions.map((item, index) => {
				const Icon = item.icon;
				const hintKeys = QUICK_ACTION_IDS[index];
				return (
					<button
						type="button"
						key={item.action}
						disabled={disabled}
						onClick={() => onRun(item)}
					>
						<Icon size={14} />
						<span>
							<strong>{item.label}</strong>
							<small>{item.hint}</small>
						</span>
						{hintKeys && (
							<kbd className="vim-kbd-small">
								{aiShortcutKeys(hintKeys).join("")}
							</kbd>
						)}
					</button>
				);
			})}
		</div>
	);
}
