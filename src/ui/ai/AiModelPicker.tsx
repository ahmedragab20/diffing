import { useMemo, useState } from "react";
import { Bot, ChevronDown, Search, Sparkles } from "lucide-react";
import { Popover } from "../primitives/Popover";
import { useOptionalAi } from "./AiContext";
import { aiSourceLabel } from "./labels";
import type { AiModel } from "../../lib/ai/types";

export const REASONING_EFFORTS = ["", "low", "medium", "high"] as const;

export function reasoningEffortLabel(effort: string): string {
	if (effort === "low") return "Low";
	if (effort === "medium") return "Medium";
	if (effort === "high") return "High";
	return "Auto";
}

export function nextReasoningEffort(current: string): string {
	const index = REASONING_EFFORTS.indexOf(
		current as (typeof REASONING_EFFORTS)[number],
	);
	return REASONING_EFFORTS[(index + 1) % REASONING_EFFORTS.length] ?? "";
}

export interface AiModelMenuProps {
	models: AiModel[];
	selectedModel: string;
	query: string;
	onQueryChange: (query: string) => void;
	onSelect: (modelId: string) => void;
	onManage?: () => void;
	reasoningEffort?: string;
	onReasoningEffortChange?: (effort: string) => void;
}

export function AiModelMenu({
	models,
	selectedModel,
	query,
	onQueryChange,
	onSelect,
	onManage,
	reasoningEffort,
	onReasoningEffortChange,
}: AiModelMenuProps) {
	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return models;
		return models.filter((model) =>
			`${model.displayName} ${aiSourceLabel(model.sourceId)} ${model.sourceId} ${model.credentialRoute} ${model.providerId}`
				.toLowerCase()
				.includes(needle),
		);
	}, [models, query]);

	return (
		<div className="ai-model-menu">
			<label className="ai-model-search">
				<Search size={12} />
				<input
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					placeholder="Search connected models"
					aria-label="Search connected models"
				/>
			</label>
			<div className="ai-model-options">
				{visible.map((model, index) => {
					const previous = visible[index - 1];
					const group = `${aiSourceLabel(model.sourceId)} · ${model.credentialRoute}`;
					const previousGroup = previous
						? `${aiSourceLabel(previous.sourceId)} · ${previous.credentialRoute}`
						: "";
					return (
						<div key={model.id}>
							{group !== previousGroup && <div className="ai-model-group">{group}</div>}
							<button
								type="button"
								className={`ai-model-option ${model.id === selectedModel ? "is-selected" : ""}`}
								onClick={() => onSelect(model.id)}
							>
								<span>
									<strong>{model.displayName}</strong>
									<small>{model.description || model.modelId}</small>
								</span>
								{model.id === selectedModel && <span>✓</span>}
							</button>
						</div>
					);
				})}
				{visible.length === 0 && (
					<div className="ai-model-empty">No matching connected models.</div>
				)}
			</div>
			{onReasoningEffortChange && (
				<div className="ai-reasoning-control" role="group" aria-label="Reasoning effort">
					<span>Reasoning</span>
					<div className="ai-reasoning-options">
						{REASONING_EFFORTS.map((effort) => (
							<button
								type="button"
								key={effort || "auto"}
								className={reasoningEffort === effort ? "is-selected" : ""}
								aria-pressed={reasoningEffort === effort}
								onClick={() => onReasoningEffortChange(effort)}
							>
								{reasoningEffortLabel(effort)}
							</button>
						))}
					</div>
				</div>
			)}
			<div className="ai-model-session-note">
				<span>Selected model</span>
				<small>Your choice is remembered across reloads.</small>
			</div>
			{onManage && (
				<button type="button" className="btn btn-sm ai-manage-models" onClick={onManage}>
					Manage connections
				</button>
			)}
		</div>
	);
}

export function AiModelPicker({ onOpenAssistant, onManage }: { onOpenAssistant?: () => void; onManage?: () => void }) {
	const ai = useOptionalAi();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const models = ai?.models ?? [];
	const selectedModel = ai?.selectedModel ?? "";
	const current = models.find((model) => model.id === selectedModel);
	if (!ai) return null;
	const { selectModel, loading } = ai;
	if (loading) return <div className="ai-toolbar-loading" role="status" aria-label="Loading AI models"><span className="ai-loading-icon" /><span className="ai-loading-copy"><i /><i /></span></div>;
	if (!models.length) {
		if (!onManage) return null;
		return (
			<button type="button" className="btn btn-sm ai-connect-btn" onClick={onManage}>
				<Bot size={13} /> Connect AI
			</button>
		);
	}
	return (
		<div className="ai-toolbar-controls" data-testid="ai-model-picker">
			<Popover
				open={open}
				onOpenChange={setOpen}
				ariaLabel="AI model"
				className="ai-model-popover"
				trigger={<button type="button" className="btn btn-sm ai-model-trigger"><Bot size={13} /><span>{current ? `${current.displayName} · ${aiSourceLabel(current.sourceId)}${current.credentialRoute === "runtime-key" ? " BYOK" : ""}` : "Choose model"}</span><ChevronDown size={12} /></button>}
			>
				<AiModelMenu
					models={models}
					selectedModel={selectedModel}
					query={query}
					onQueryChange={setQuery}
					onSelect={(modelId) => {
						void selectModel(modelId);
						setOpen(false);
						setQuery("");
					}}
					onManage={
						onManage
							? () => {
									setOpen(false);
									onManage();
								}
							: undefined
					}
				/>
			</Popover>
			{onOpenAssistant && (
				<button type="button" className="btn btn-sm ai-ask-btn" onClick={onOpenAssistant}>
					<Sparkles size={13} /> Ask AI
				</button>
			)}
		</div>
	);
}
