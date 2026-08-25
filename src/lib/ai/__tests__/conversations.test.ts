import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AI_CONVERSATION_RETENTION_MS,
	FileAiConversationStore,
	InMemoryAiConversationStore,
} from "../conversations.js";

afterEach(() => vi.useRealTimers());

describe("AI conversation stores", () => {
	it("creates, scopes, updates, and deletes local conversations", async () => {
		const store = new InMemoryAiConversationStore();
		const created = await store.create({ surface: "diff", scopeKey: "repo:branch" });
		const updated = await store.update(created.id, {
			title: "Review thread",
			draft: "follow up",
			turns: [
				{ role: "user", text: "What changed?" },
				{ role: "assistant", text: "The diff changes the parser." },
			],
		});
		expect(updated?.title).toBe("Review thread");
		expect((await store.list({ surface: "plan" })).length).toBe(0);
		expect((await store.get(created.id))?.turns).toHaveLength(2);
		expect(await store.remove(created.id)).toBe(true);
		expect(await store.get(created.id)).toBeNull();
	});

	it("prunes expired file-backed conversations on load", async () => {
		const directory = await mkdtemp(join(tmpdir(), "diffing-ai-conversations-"));
		const now = Date.now();
		await writeFile(join(directory, "ai-conversations.json"), JSON.stringify([{
			id: "expired",
			title: "Old",
			surface: "diff",
			scopeKey: "repo",
			createdAt: now - AI_CONVERSATION_RETENTION_MS - 1,
			updatedAt: now - AI_CONVERSATION_RETENTION_MS - 1,
			turns: [{ role: "user", text: "stale" }],
		}]));
		const store = new FileAiConversationStore(directory);
		expect(await store.list()).toEqual([]);
		const persisted = await readFile(join(directory, "ai-conversations.json"), "utf8");
		expect(persisted).toBe("[]");
	});
});
