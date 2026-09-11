import { Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { AiModel } from "../../lib/ai/types";
import { Popover } from "../primitives/Popover";
import { aiSourceLabel } from "./labels";
import {
	AiModelMenu,
	reasoningEffortLabel,
} from "./AiModelPicker";
import {
	AiConversationSwitcher,
	type AiConversationSwitcherProps,
} from "./AiConversationSwitcher";

export interface AiRailHeaderProps {
	title: string;
	model: AiModel | undefined;
	models: AiModel[];
	selectedModel: string;
	onSelectModel: (modelId: string) => void;
	reasoningEffort: string;
	onReasoningEffortChange: (effort: string) => void;
	onCycleReasoning: () => void;
	modelMenuOpen: boolean;
	onModelMenuOpenChange: (open: boolean) => void;
	onClose: () => void;
	switcher: AiConversationSwitcherProps;
}

export function AiRailHeader({
	title,
	model,
	models,
	selectedModel,
	onSelectModel,
	reasoningEffort,
	onReasoningEffortChange,
	onCycleReasoning,
	modelMenuOpen,
	onModelMenuOpenChange,
	onClose,
	switcher,
}: AiRailHeaderProps) {
	const [query, setQuery] = useState("");
	const modelLabel = model
		? `${model.displayName} · ${aiSourceLabel(model.sourceId)}${model.credentialRoute === "runtime-key" ? " BYOK" : ""}`
		: "No model selected";

	return (
		<>
			<header className="ai-rail-header">
				<div className="ai-rail-title-icon">
					<Sparkles size={15} />
				</div>
				<div className="ai-rail-title">
					<strong>{title}</strong>
					<div className="ai-rail-model-chips">
						<Popover
							open={modelMenuOpen}
							onOpenChange={onModelMenuOpenChange}
							ariaLabel="AI model"
							className="ai-model-popover"
							align="start"
							trigger={
								<button
									type="button"
									className="ai-rail-model-chip"
									aria-label="Choose AI model"
								>
									{modelLabel}
								</button>
							}
						>
							<AiModelMenu
								models={models}
								selectedModel={selectedModel}
								query={query}
								onQueryChange={setQuery}
								onSelect={(modelId) => {
									onSelectModel(modelId);
									onModelMenuOpenChange(false);
									setQuery("");
								}}
								reasoningEffort={reasoningEffort}
								onReasoningEffortChange={onReasoningEffortChange}
							/>
						</Popover>
						<button
							type="button"
							className="ai-rail-reasoning-chip"
							aria-label="Cycle reasoning effort"
							onClick={onCycleReasoning}
						>
							{reasoningEffortLabel(reasoningEffort)}
						</button>
					</div>
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
