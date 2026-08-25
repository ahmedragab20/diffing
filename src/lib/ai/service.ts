import { randomUUID } from "node:crypto";
import { buildAiPrompt } from "./context.js";
import { createDefaultAdapters } from "./adapters.js";
import { SystemSecretStore, type SecretStore } from "./secrets.js";
import type {
	AiBackendAdapter,
	AiConnection,
	AiCredentialRoute,
	AiModel,
	AiRunEvent,
	AiRunRequest,
	AiSourceId,
} from "./types.js";

export class AiService {
	private readonly adapters = new Map<AiSourceId, AiBackendAdapter>();
	private readonly runs = new Map<string, { conversationId: string; controller: AbortController }>();
	private readonly conversations = new Set<string>();

	constructor(adapters?: AiBackendAdapter[], secrets: SecretStore = new SystemSecretStore()) {
		for (const adapter of adapters ?? createDefaultAdapters(secrets)) this.adapters.set(adapter.id, adapter);
	}

	async connections(): Promise<AiConnection[]> {
		return Promise.all([...this.adapters.values()].map(async (adapter) => {
			try {
				return await adapter.connection();
			} catch (error) {
				return {
					id: adapter.id,
					label: adapter.id,
					status: "error" as const,
					runtimeAvailable: true,
					credentialRoutes: [],
					activeRoutes: [],
					detail: error instanceof Error ? error.message : String(error),
				};
			}
		}));
	}

	async models(): Promise<AiModel[]> {
		const groups = await Promise.all([...this.adapters.values()].map((adapter) => adapter.models().catch(() => [])));
		return groups.flat();
	}

	async connectKey(source: AiSourceId, key: string, remember: boolean): Promise<void> {
		const adapter = this.adapters.get(source);
		if (!adapter?.connectKey) throw new Error(`${source} does not accept a direct key in diffing.`);
		await adapter.connectKey(key, remember);
	}

	async disconnect(source: AiSourceId): Promise<void> {
		const adapter = this.adapters.get(source);
		if (!adapter) throw new Error(`Unknown AI source: ${source}`);
		await adapter.disconnect?.();
	}

	setupCommand(source: AiSourceId, route: AiCredentialRoute, providerId?: string): string {
		const command = this.adapters.get(source)?.setupCommand?.(route, providerId);
		if (!command) throw new Error(`${source} does not expose a ${route} setup flow.`);
		return command;
	}

	cancel(runId: string): boolean {
		const active = this.runs.get(runId);
		if (!active) return false;
		active.controller.abort();
		return true;
	}

	async run(request: AiRunRequest, onEvent: (event: AiRunEvent) => void | Promise<void>): Promise<string> {
		if (request.trigger !== "user") throw new Error("AI inference requires an explicit user trigger.");
		if (!request.conversationId?.trim()) throw new Error("conversationId is required.");
		if (request.conversationId.length > 160) throw new Error("conversationId is too long.");
		if (!request.modelId || request.modelId.length > 512) throw new Error("modelId is invalid.");
		if (this.conversations.has(request.conversationId)) throw new Error("An AI request is already running for this conversation.");
		const [source] = request.modelId.split("/") as [AiSourceId];
		const adapter = this.adapters.get(source);
		if (!adapter) throw new Error(`Unknown model source: ${source}`);
		const runId = randomUUID();
		const controller = new AbortController();
		this.runs.set(runId, { conversationId: request.conversationId, controller });
		this.conversations.add(request.conversationId);
		const built = buildAiPrompt(request);
		const providerRequest = { ...request, prompt: built.prompt };
		await onEvent({ type: "start", runId, modelId: request.modelId });
		if (built.truncated) await onEvent({ type: "warning", message: "Review context was truncated to the configured limit." });
		try {
			const text = await adapter.run(providerRequest, controller.signal, onEvent);
			await onEvent({ type: "complete", text });
			return text;
		} finally {
			this.runs.delete(runId);
			this.conversations.delete(request.conversationId);
		}
	}
}
