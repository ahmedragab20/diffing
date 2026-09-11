import { Sparkles, X } from "lucide-react";
import type { AiModel } from "../../lib/ai/types";
import { aiSourceLabel } from "./labels";
import {
	AiConversationSwitcher,
	type AiConversationSwitcherProps,
} from "./AiConversationSwitcher";

export interface AiRailHeaderProps {
	title: string;
	model: AiModel | undefined;
	onClose: () => void;
	switcher: AiConversationSwitcherProps;
}

export function AiRailHeader({
	title,
	model,
	onClose,
	switcher,
}: AiRailHeaderProps) {
	return (
		<>
			<header className="ai-rail-header">
				<div className="ai-rail-title-icon">
					<Sparkles size={15} />
				</div>
				<div className="ai-rail-title">
					<strong>{title}</strong>
					<span>
						{model
							? `${model.displayName} · ${aiSourceLabel(model.sourceId)}${model.credentialRoute === "runtime-key" ? " BYOK" : ""}`
							: "No model selected"}
					</span>
				</div>
				<button
					type="button"
					className="ai-rail-icon-btn"
					onClick={onClose}
					aria-label="Close AI assistant"
				>
					<X size={15} />
				</button>
			</header>
			<AiConversationSwitcher {...switcher} />
		</>
	);
}
