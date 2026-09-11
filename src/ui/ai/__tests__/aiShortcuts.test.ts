import { describe, expect, it } from "vitest";
import type { AiSurface } from "../../../lib/ai/types";
import {
	AI_SHORTCUTS,
	DIFF_RESERVED_BARE_KEYS,
	MOCKUP_RESERVED_BARE_KEYS,
	PLAN_RESERVED_BARE_KEYS,
	aiShortcutKeys,
	bareKeysForSurface,
	matchesAiShortcut,
	type AiShortcutId,
} from "../aiShortcuts";

function event(
	key: string,
	mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; code?: string } = {},
): KeyboardEvent {
	return {
		key,
		metaKey: Boolean(mods.metaKey),
		ctrlKey: Boolean(mods.ctrlKey),
		shiftKey: Boolean(mods.shiftKey),
		altKey: Boolean(mods.altKey),
		code: mods.code ?? "",
	} as KeyboardEvent;
}

const IDS = AI_SHORTCUTS.map((shortcut) => shortcut.id);

describe("AI shortcut registry", () => {
	it("gives every id a unique entry", () => {
		expect(new Set(IDS).size).toBe(IDS.length);
	});

	it("has keys for every id except button-only bindings", () => {
		for (const shortcut of AI_SHORTCUTS) {
			if (shortcut.id === "toggle-findings") {
				expect(shortcut.keys).toEqual([]);
				continue;
			}
			expect(shortcut.keys.length).toBeGreaterThan(0);
			expect(aiShortcutKeys(shortcut.id).length).toBeGreaterThan(0);
		}
	});

	it("covers the documented shortcut ids", () => {
		const expected: AiShortcutId[] = [
			"toggle-rail",
			"focus-composer",
			"send",
			"stop",
			"new-conversation",
			"prev-conversation",
			"next-conversation",
			"quick-action-1",
			"quick-action-2",
			"quick-action-3",
			"open-model-picker",
			"cycle-reasoning",
			"copy-last-response",
			"retry-last",
			"add-selection-to-ask",
			"attach-image",
			"clear-composer",
			"close-rail",
			"toggle-context-details",
			"toggle-findings",
			"insert-file-mention",
			"ask-about-active-file",
		];
		expect(IDS.sort()).toEqual([...expected].sort());
	});

	it("matches meta and ctrl as Mod", () => {
		expect(matchesAiShortcut(event("i", { metaKey: true }), "toggle-rail")).toBe(
			true,
		);
		expect(matchesAiShortcut(event("i", { ctrlKey: true }), "toggle-rail")).toBe(
			true,
		);
		expect(matchesAiShortcut(event("i"), "toggle-rail")).toBe(false);
		expect(
			matchesAiShortcut(event("i", { metaKey: true, shiftKey: true }), "toggle-rail"),
		).toBe(false);
	});

	it("matches Shift+A for a new conversation but not bare a", () => {
		expect(matchesAiShortcut(event("A"), "new-conversation")).toBe(true);
		expect(matchesAiShortcut(event("a"), "new-conversation")).toBe(false);
		expect(
			matchesAiShortcut(
				event("n", { metaKey: true, shiftKey: true }),
				"new-conversation",
			),
		).toBe(true);
	});

	it("matches Mod+. for stop and Mod+Shift+. for context details", () => {
		expect(matchesAiShortcut(event(".", { metaKey: true }), "stop")).toBe(true);
		expect(
			matchesAiShortcut(event(".", { ctrlKey: true }), "stop"),
		).toBe(true);
		expect(
			matchesAiShortcut(
				event(">", { metaKey: true, shiftKey: true, code: "Period" }),
				"toggle-context-details",
			),
		).toBe(true);
		expect(
			matchesAiShortcut(event(".", { metaKey: true, shiftKey: true }), "stop"),
		).toBe(false);
	});

	it("uses yank, effort, and clear chords that avoid browser collisions", () => {
		expect(aiShortcutKeys("copy-last-response")).toEqual(["⌘", "Shift", "Y"]);
		expect(aiShortcutKeys("cycle-reasoning")).toEqual(["⌘", "Shift", "E"]);
		expect(aiShortcutKeys("clear-composer")).toEqual(["⌘", "Shift", "X"]);
		expect(
			matchesAiShortcut(
				event("c", { metaKey: true, shiftKey: true }),
				"copy-last-response",
			),
		).toBe(false);
		expect(
			matchesAiShortcut(
				event("r", { metaKey: true, shiftKey: true }),
				"cycle-reasoning",
			),
		).toBe(false);
		expect(
			matchesAiShortcut(event("l", { metaKey: true }), "clear-composer"),
		).toBe(false);
		expect(
			matchesAiShortcut(
				event("y", { metaKey: true, shiftKey: true }),
				"copy-last-response",
			),
		).toBe(true);
		expect(
			matchesAiShortcut(
				event("e", { metaKey: true, shiftKey: true }),
				"cycle-reasoning",
			),
		).toBe(true);
		expect(
			matchesAiShortcut(
				event("x", { metaKey: true, shiftKey: true }),
				"clear-composer",
			),
		).toBe(true);
	});

	it("does not treat sequence bindings as single-event chords", () => {
		expect(matchesAiShortcut(event("g"), "ask-about-active-file")).toBe(false);
		expect(matchesAiShortcut(event("a"), "ask-about-active-file")).toBe(false);
	});

	it("does not collide with reserved bare keys on each surface", () => {
		const reserved: Record<AiSurface, readonly string[]> = {
			diff: DIFF_RESERVED_BARE_KEYS,
			"pr-diff": DIFF_RESERVED_BARE_KEYS,
			plan: PLAN_RESERVED_BARE_KEYS,
			mockup: MOCKUP_RESERVED_BARE_KEYS,
		};
		for (const surface of Object.keys(reserved) as AiSurface[]) {
			for (const key of bareKeysForSurface(surface)) {
				expect(reserved[surface]).not.toContain(key);
			}
		}
	});
});
