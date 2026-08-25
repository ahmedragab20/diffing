// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { InMemoryCommentStore } from "../lib/comments.js";
import { InMemoryPlanStore } from "../lib/plans.js";
import { InMemoryMockupStore } from "../lib/mockups.js";
import { AiService } from "../lib/ai/service.js";
import type { AiBackendAdapter } from "../lib/ai/types.js";
import { DEFAULTS } from "../lib/diff-options.js";

vi.mock("../lib/git.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/git.js")>();
	return { ...actual, getRepoRoot: () => process.cwd() };
});

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		watch: vi.fn(() => ({ unref: vi.fn() })),
	};
});

function adapter(run: AiBackendAdapter["run"] = vi.fn(async (_request, _signal, onEvent) => {
	await onEvent({ type: "text-delta", text: "hello" });
	return "hello";
})): AiBackendAdapter {
	return {
		id: "codex",
		connection: async () => ({ id: "codex", label: "Codex", status: "connected", runtimeAvailable: true, credentialRoutes: ["subscription"], activeRoutes: ["subscription"] }),
		models: async () => [{ id: "codex/subscription/codex/gpt-test", sourceId: "codex", credentialRoute: "subscription", providerId: "codex", modelId: "gpt-test", displayName: "GPT Test" }],
		run,
	};
}

async function app(run?: AiBackendAdapter["run"]) {
	const { createApp } = await import("../server.js");
	return createApp(
		"/tmp/diffing-ai-client",
		DEFAULTS,
		new InMemoryCommentStore(),
		new InMemoryPlanStore(),
		undefined,
		false,
		undefined,
		new InMemoryMockupStore(),
		undefined,
		new AiService([adapter(run)]),
	);
}

describe("AI endpoints", () => {
	it("lists normalized connections and models", async () => {
		const server = await app();
		const connections = await server.request("/api/ai/connections");
		const models = await server.request("/api/ai/models");
		expect((await connections.json()).connections[0].id).toBe("codex");
		expect((await models.json()).models[0].modelId).toBe("gpt-test");
	});

	it("rejects background inference without invoking the adapter", async () => {
		const run = vi.fn(async () => "nope");
		const server = await app(run);
		const response = await server.request("/api/ai/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ trigger: "background", modelId: "codex/subscription/codex/gpt-test", action: "ask", surface: "diff", context: { kind: "diff" } }),
		});
		expect(response.status).toBe(400);
		expect(run).not.toHaveBeenCalled();
	});

	it.each([
		{ label: "renderer metadata text", patch: "[object Object],[object Object]" },
		{ label: "a non-string patch", patch: [{ type: "change" }] },
	])("rejects $label instead of sending unreadable context to the model", async ({ patch }) => {
		const run = vi.fn(async () => "nope");
		const server = await app(run);
		const response = await server.request("/api/ai/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ trigger: "user", conversationId: "bad-context", modelId: "codex/subscription/codex/gpt-test", action: "ask", surface: "diff", context: { kind: "file", filePath: "src/a.ts", patch } }),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "The selected diff context could not be serialized. Refresh the review and try again." });
		expect(run).not.toHaveBeenCalled();
	});

	it("streams only after an explicit user-triggered request", async () => {
		const run = vi.fn(async (_request, _signal, onEvent) => {
			await onEvent({ type: "text-delta", text: "hello" });
			return "hello";
		});
		const server = await app(run);
		const response = await server.request("/api/ai/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ trigger: "user", conversationId: "c1", modelId: "codex/subscription/codex/gpt-test", action: "ask", surface: "diff", context: { kind: "diff", patch: "+x" } }),
		});
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toContain("event: start");
		expect(text).toContain("hello");
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("hydrates explicitly attached FFF file paths into bounded context", async () => {
		let attached: unknown;
		const run = vi.fn(async (request, _signal, onEvent) => {
			attached = request.context.attachments;
			await onEvent({ type: "text-delta", text: "attached" });
			return "attached";
		});
		const server = await app(run);
		const response = await server.request("/api/ai/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ trigger: "user", conversationId: "c2", modelId: "codex/subscription/codex/gpt-test", action: "ask", surface: "diff", context: { kind: "diff", attachmentPaths: ["package.json"] } }),
		});
		expect(response.status).toBe(200);
		await response.text();
		expect(attached).toEqual([expect.objectContaining({ path: "package.json", content: expect.stringContaining('"name": "diffing"') })]);
	});
});
