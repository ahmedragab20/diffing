import type { RailQuickAction } from "./railHelpers";

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
			{actions.map((item) => {
				const Icon = item.icon;
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
					</button>
				);
			})}
		</div>
	);
}
