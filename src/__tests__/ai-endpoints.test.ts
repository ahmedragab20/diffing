// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { InMemoryCommentStore } from "../lib/comments.js";
import { InMemoryPlanStore } from "../lib/plans.js";
import { InMemoryMockupStore } from "../lib/mockups.js";
import { InMemoryAiConversationStore } from "../lib/ai/conversations.js";
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

function adapter(
	run: AiBackendAdapter["run"] = vi.fn(async (_request, _signal, onEvent) => {
		await onEvent({ type: "text-delta", text: "hello" });
		return "hello";
	}),
): AiBackendAdapter {
	return {
		id: "codex",
		connection: async () => ({
			id: "codex",
			label: "Codex",
			status: "connected",
			runtimeAvailable: true,
			credentialRoutes: ["subscription"],
			activeRoutes: ["subscription"],
		}),
		models: async () => [
			{
				id: "codex/subscription/codex/gpt-test",
				sourceId: "codex",
				credentialRoute: "subscription",
				providerId: "codex",
				modelId: "gpt-test",
				displayName: "GPT Test",
			},
		],
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
		new InMemoryAiConversationStore(),
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
			body: JSON.stringify({
				trigger: "background",
				modelId: "codex/subscription/codex/gpt-test",
				action: "ask",
				surface: "diff",
				context: { kind: "diff" },
			}),
		});
		expect(response.status).toBe(400);
		expect(run).not.toHaveBeenCalled();
	});

	it.each([
		{ label: "renderer metadata text", patch: "[object Object],[object Object]" },
		{ label: "a non-string patch", patch: [{ type: "change" }] },
	])(
		"rejects $label instead of sending unreadable context to the model",
		async ({ patch }) => {
			const run = vi.fn(async () => "nope");
			const server = await app(run);
			const response = await server.request("/api/ai/run", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					trigger: "user",
					conversationId: "bad-context",
					modelId: "codex/subscription/codex/gpt-test",
					action: "ask",
					surface: "diff",
					context: { kind: "file", filePath: "src/a.ts", patch },
				}),
			});
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error:
					"The selected diff context could not be serialized. Refresh the review and try again.",
			});
			expect(run).not.toHaveBeenCalled();
		},
	);

	it("streams only after an explicit user-triggered request", async () => {
		const run = vi.fn(async (_request, _signal, onEvent) => {
			await onEvent({ type: "text-delta", text: "hello" });
			return "hello";
		});
		const server = await app(run);
		const response = await server.request("/api/ai/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				trigger: "user",
				conversationId: "c1",
				modelId: "codex/subscription/codex/gpt-test",
				action: "ask",
				surface: "diff",
				context: { kind: "diff", patch: "+x" },
			}),
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
			body: JSON.stringify({
				trigger: "user",
				conversationId: "c2",
				modelId: "codex/subscription/codex/gpt-test",
				action: "ask",
				surface: "diff",
				context: { kind: "diff", attachmentPaths: ["package.json"] },
			}),
		});
		expect(response.status).toBe(200);
		await response.text();
		expect(attached).toEqual([
			expect.objectContaining({
				path: "package.json",
				content: expect.stringContaining('"name": "diffing"'),
			}),
		]);
	});

	it("persists multiple scoped conversations without mixing review surfaces", async () => {
		const server = await app();
		const created = await server.request("/api/ai/conversations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				surface: "diff",
				scopeKey: "repo:branch",
				title: "Parser review",
			}),
		});
		expect(created.status).toBe(201);
		const conversation = (await created.json()).conversation;
		const updated = await server.request(
			`/api/ai/conversations/${conversation.id}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					draft: "follow up",
					turns: [
						{ role: "user", text: "What changed?" },
						{ role: "assistant", text: "The parser." },
					],
				}),
			},
		);
		expect((await updated.json()).conversation.turns).toHaveLength(2);
		const scoped = await server.request(
			"/api/ai/conversations?surface=plan&scopeKey=repo:branch",
		);
		expect((await scoped.json()).conversations).toEqual([]);
		const listed = await server.request(
			"/api/ai/conversations?surface=diff&scopeKey=repo:branch",
		);
		expect((await listed.json()).conversations[0]).toMatchObject({
			title: "Parser review",
			turnCount: 2,
		});
	});

	it("accepts mockup conversations and rejects unknown surfaces", async () => {
		const server = await app();
		const created = await server.request("/api/ai/conversations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				surface: "mockup",
				scopeKey: "mockup:mk-1",
				title: "Checkout",
			}),
		});
		expect(created.status).toBe(201);
		expect((await created.json()).conversation.surface).toBe("mockup");
		const bad = await server.request("/api/ai/conversations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ surface: "canvas", scopeKey: "x" }),
		});
		expect(bad.status).toBe(400);
		const listed = await server.request(
			"/api/ai/conversations?surface=mockup&scopeKey=mockup:mk-1",
		);
		expect((await listed.json()).conversations[0]).toMatchObject({
			title: "Checkout",
			surface: "mockup",
		});
	});

	it("runs mockup inference only with an explicit user trigger", async () => {
		const run = vi.fn(async () => "nope");
		const server = await app(run);
		const blocked = await server.request("/api/ai/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				trigger: "background",
				modelId: "codex/subscription/codex/gpt-test",
				action: "critique-mockup",
				surface: "mockup",
				context: {
					kind: "mockup",
					mockupId: "mk-1",
					title: "Checkout",
					version: 1,
				},
			}),
		});
		expect(blocked.status).toBe(400);
		expect(run).not.toHaveBeenCalled();
		const invalidSurface = await server.request("/api/ai/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				trigger: "user",
				conversationId: "c-mock",
				modelId: "codex/subscription/codex/gpt-test",
				action: "ask",
				surface: "canvas",
				context: {
					kind: "mockup",
					mockupId: "mk-1",
					title: "Checkout",
					version: 1,
				},
			}),
		});
		expect(invalidSurface.status).toBe(400);
		expect(run).not.toHaveBeenCalled();
		const allowed = await server.request("/api/ai/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				trigger: "user",
				conversationId: "c-mock",
				modelId: "codex/subscription/codex/gpt-test",
				action: "critique-mockup",
				surface: "mockup",
				context: {
					kind: "mockup-screen",
					mockupId: "mk-1",
					title: "Checkout",
					version: 1,
					html: "<h1>Pay</h1>",
				},
			}),
		});
		expect(allowed.status).toBe(200);
		await allowed.text();
		expect(run).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({
				trigger: "user",
				surface: "mockup",
				action: "critique-mockup",
			}),
			expect.anything(),
			expect.anything(),
		);
	});
});
