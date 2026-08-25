import { useMemo, useState } from "react";
import { Bot, ChevronDown, Search, Sparkles } from "lucide-react";
import { Popover } from "../primitives/Popover";
import { useOptionalAi } from "./AiContext";

export function AiModelPicker({ onOpenAssistant, onManage }: { onOpenAssistant?: () => void; onManage?: () => void }) {
	const ai = useOptionalAi();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const models = ai?.models ?? [];
	const selectedModel = ai?.selectedModel ?? "";
	const current = models.find((model) => model.id === selectedModel);
	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return models;
		return models.filter((model) => `${model.displayName} ${model.sourceId} ${model.credentialRoute} ${model.providerId}`.toLowerCase().includes(needle));
	}, [models, query]);
	if (!ai) return null;
	const { selectModel, loading, defaultModel } = ai;
	const defaultEntry = models.find((model) => model.id === defaultModel);
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
				trigger={<button type="button" className="btn btn-sm ai-model-trigger"><Bot size={13} /><span>{current ? `${current.displayName} · ${current.sourceId}${current.credentialRoute === "runtime-key" ? " BYOK" : ""}` : "Choose model"}</span><ChevronDown size={12} /></button>}
			>
				<div className="ai-model-menu">
					<label className="ai-model-search"><Search size={12} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search connected models" aria-label="Search connected models" /></label>
					<div className="ai-model-options">
						{visible.map((model, index) => {
							const previous = visible[index - 1];
							const group = `${model.sourceId} · ${model.credentialRoute}`;
							const previousGroup = previous ? `${previous.sourceId} · ${previous.credentialRoute}` : "";
							return <div key={model.id}>{group !== previousGroup && <div className="ai-model-group">{group}</div>}<button type="button" className={`ai-model-option ${model.id === selectedModel ? "is-selected" : ""}`} onClick={() => { void selectModel(model.id); setOpen(false); setQuery(""); }}><span><strong>{model.displayName}</strong><small>{model.description || model.modelId}</small></span>{model.id === selectedModel && <span>✓</span>}</button></div>;
						})}
						{visible.length === 0 && <div className="ai-model-empty">No matching connected models.</div>}
					</div>
					<div className="ai-model-session-note"><span>Session model</span><small>Reload uses default: {defaultEntry?.displayName || "first available"}. Change it in Settings → AI connections.</small></div>
					{onManage && <button type="button" className="btn btn-sm ai-manage-models" onClick={() => { setOpen(false); onManage(); }}>Manage connections</button>}
				</div>
			</Popover>
			{onOpenAssistant && (
				<button type="button" className="btn btn-sm ai-ask-btn" onClick={onOpenAssistant}>
					<Sparkles size={13} /> Ask AI
				</button>
			)}
		</div>
	);
}
