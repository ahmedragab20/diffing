import { useState } from "react";
import { Bot, CheckCircle2, ChevronRight, Copy, KeyRound, RefreshCw, TerminalSquare } from "lucide-react";
import type { AiSourceId } from "../../lib/ai/types";
import { Modal } from "../primitives/Modal";
import { useOptionalAi } from "./AiContext";

const DIRECT_SOURCES: AiSourceId[] = ["openai", "anthropic", "xai"];

export function AiConnectionsPanel() {
	const ai = useOptionalAi();
	const [keySource, setKeySource] = useState<AiSourceId | null>(null);
	const [key, setKey] = useState("");
	const [remember, setRemember] = useState(true);
	const [command, setCommand] = useState("");
	const [busy, setBusy] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	if (!ai) return null;
	const { connections, models, defaultModel, settingsExpanded, setSettingsExpanded, setDefaultModel, connectKey, setup, disconnect, refresh, loading, error } = ai;
	const connectedCount = connections.filter((connection) => connection.status === "connected").length;

	const saveKey = async () => {
		if (!keySource) return;
		setBusy(true);
		setLocalError(null);
		try {
			await connectKey(keySource, key, remember);
			setKey("");
			setKeySource(null);
		} catch (nextError) {
			setLocalError(nextError instanceof Error ? nextError.message : String(nextError));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<section className="ai-settings-section">
				<button type="button" className="ai-settings-toggle" aria-expanded={settingsExpanded} onClick={() => void setSettingsExpanded(!settingsExpanded)}>
					<span className="ai-settings-toggle-icon"><Bot size={13} /></span>
					<span className="ai-settings-toggle-copy"><strong>AI connections</strong><small>{connectedCount} connected · {models.length} models</small></span>
					<ChevronRight size={13} className={settingsExpanded ? "is-expanded" : ""} />
				</button>
			{settingsExpanded && <div className="ai-connections-settings">
				{connections.map((connection) => (
					<div className="ai-connection-row" key={connection.id}>
						<span className={`ai-connection-dot is-${connection.status}`} aria-hidden="true" />
						<div className="ai-connection-copy">
							<strong>{connection.label}</strong>
							<small>{connection.status.replaceAll("-", " ")}{connection.modelCount ? ` · ${connection.modelCount} models` : ""}</small>
						</div>
						{connection.status === "connected" ? (
							<button className="btn btn-sm" type="button" onClick={() => void disconnect(connection.id).catch((nextError) => setLocalError(nextError instanceof Error ? nextError.message : String(nextError)))}>Disconnect</button>
						) : DIRECT_SOURCES.includes(connection.id) ? (
							<button className="btn btn-sm" type="button" onClick={() => setKeySource(connection.id)}><KeyRound size={12} /> Add key</button>
						) : (
							<div className="ai-connection-actions">
								{connection.credentialRoutes.includes("subscription") && <button className="btn btn-sm" type="button" onClick={() => void setup(connection.id, "subscription").then(setCommand).catch((nextError) => setLocalError(String(nextError)))}><TerminalSquare size={12} /> Sign in</button>}
								{connection.credentialRoutes.includes("runtime-key") && <button className="btn btn-sm" type="button" onClick={() => void setup(connection.id, "runtime-key").then(setCommand).catch((nextError) => setLocalError(String(nextError)))}><KeyRound size={12} /> BYOK</button>}
							</div>
						)}
					</div>
				))}
				<button className="btn btn-sm ai-refresh-connections" type="button" onClick={() => void refresh()} disabled={loading}>
					<RefreshCw size={12} /> Refresh connections
				</button>
				{models.length > 0 && (
					<label className="ai-settings-model-label">
						<span>Default model</span>
						<select value={defaultModel || models.find((model) => model.isDefault)?.id || models[0]?.id || ""} onChange={(event) => void setDefaultModel(event.target.value)}>
							{models.map((model) => <option value={model.id} key={model.id}>{model.displayName} · {model.sourceId}</option>)}
						</select>
					</label>
				)}
				{(error || localError) && <div className="ai-settings-error" role="alert">{localError || error}</div>}
			</div>}
			</section>

			<Modal open={!!keySource} onClose={() => setKeySource(null)} className="ai-key-modal" ariaLabel="Add provider API key" ariaBusy={busy}>
				<div className="modal-header"><KeyRound size={18} /><h2>Add {keySource} API key</h2></div>
				<div className="modal-body">
					<p>The key is sent only to the local diffing server. It is never written to settings.json.</p>
					<input type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" spellCheck={false} aria-label="API key" placeholder="Paste API key" />
					<label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember in the OS credential vault when available</label>
					{localError && <div role="alert" className="ai-settings-error">{localError}</div>}
				</div>
				<div className="modal-actions"><button className="btn" onClick={() => setKeySource(null)}>Cancel</button><button className="btn btn-primary" disabled={!key.trim() || busy} onClick={() => void saveKey()}><CheckCircle2 size={13} /> Connect</button></div>
			</Modal>

			<Modal open={!!command} onClose={() => setCommand("")} className="ai-command-modal" ariaLabel="Configure AI runtime">
				<div className="modal-header"><TerminalSquare size={18} /><h2>Finish setup in your terminal</h2></div>
				<div className="modal-body"><p>Run the provider’s native credential flow, then refresh connections.</p><code>{command}</code></div>
				<div className="modal-actions"><button className="btn" onClick={() => void navigator.clipboard.writeText(command)}><Copy size={13} /> Copy command</button><button className="btn btn-primary" onClick={() => { setCommand(""); void refresh(); }}>Done</button></div>
			</Modal>
		</>
	);
}
