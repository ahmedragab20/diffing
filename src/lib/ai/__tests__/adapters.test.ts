import { describe, expect, it, vi } from "vitest";
import { DirectProviderAdapter } from "../adapters.js";
import type { SecretStore } from "../secrets.js";
import type { AiRunRequest } from "../types.js";

function secrets(value: string | null = "secret-key"): SecretStore {
	return {
		get: vi.fn(async () => value),
		set: vi.fn(async () => "session" as const),
		delete: vi.fn(async () => {}),
	};
}

describe("DirectProviderAdapter", () => {
	it("discovers account models without exposing the key in connection state", async () => {
		const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			expect((init?.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
			return new Response(JSON.stringify({ data: [{ id: "gpt-text" }, { id: "text-embedding-3-small" }] }), { status: 200 });
		}) as unknown as typeof fetch;
		const adapter = new DirectProviderAdapter(
			{ id: "openai", label: "OpenAI", baseUrl: "https://api.test", envKey: "DIFFING_TEST_OPENAI_KEY" },
			secrets(),
			fetchImpl,
		);
		const connection = await adapter.connection();
		expect(JSON.stringify(connection)).not.toContain("secret-key");
		const models = await adapter.models();
		expect(models.map((model) => model.modelId)).toEqual(["gpt-text"]);
	});

	it("keeps a direct key session-only when remember is false", async () => {
		const store = secrets(null);
		const adapter = new DirectProviderAdapter(
			{ id: "xai", label: "xAI", baseUrl: "https://api.test", envKey: "DIFFING_TEST_XAI_KEY" },
			store,
			vi.fn() as unknown as typeof fetch,
		);
		await adapter.connectKey("xai-key", false);
		expect(store.set).toHaveBeenCalledWith("xai", "xai-key", false);
	});

	it.each([
		["openai", "response.output_text.delta"],
		["xai", "response.output_text.delta"],
		["anthropic", "content_block_delta"],
	] as const)("streams every %s text delta", async (source, eventType) => {
		const events = source === "anthropic"
			? [
				{ type: eventType, delta: { type: "text_delta", text: "# Heading\n" } },
				{ type: eventType, delta: { type: "text_delta", text: "Body" } },
			]
			: [
				{ type: eventType, delta: "# Heading\n" },
				{ type: eventType, delta: "Body" },
			];
		const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
		const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			expect(JSON.parse(String(init?.body)).stream).toBe(true);
			return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
		}) as unknown as typeof fetch;
		const adapter = new DirectProviderAdapter(
			{ id: source, label: source, baseUrl: "https://api.test", envKey: `DIFFING_TEST_${source.toUpperCase()}_KEY` },
			secrets(),
			fetchImpl,
		);
		const deltas: string[] = [];
		const request: AiRunRequest = {
			trigger: "user",
			conversationId: "c1",
			modelId: `${source}/direct-key/${source}/model`,
			surface: "diff",
			action: "ask",
			prompt: "Question",
			context: { kind: "diff" },
		};
		const text = await adapter.run(request, new AbortController().signal, (event) => { if (event.type === "text-delta") deltas.push(event.text); });
		expect(deltas).toEqual(["# Heading\n", "Body"]);
		expect(text).toBe("# Heading\nBody");
	});
});
