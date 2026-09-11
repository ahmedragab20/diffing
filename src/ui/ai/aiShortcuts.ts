import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AiSurface } from "../../lib/ai/types";

export type AiShortcutId =
	| "toggle-rail"
	| "focus-composer"
	| "send"
	| "stop"
	| "new-conversation"
	| "prev-conversation"
	| "next-conversation"
	| "quick-action-1"
	| "quick-action-2"
	| "quick-action-3"
	| "open-model-picker"
	| "cycle-reasoning"
	| "copy-last-response"
	| "retry-last"
	| "add-selection-to-ask"
	| "attach-image"
	| "clear-composer"
	| "close-rail"
	| "toggle-context-details"
	| "toggle-findings"
	| "insert-file-mention"
	| "ask-about-active-file";

export interface AiShortcut {
	id: AiShortcutId;
	keys: string[];
	description: string;
	scope: "global" | "rail" | "composer";
	surfaces: AiSurface[] | "all";
	/** Extra chords for the same action, shown as additional help rows. */
	aliases?: string[][];
}

const MOD = "⌘";

export const AI_SHORTCUTS: readonly AiShortcut[] = [
	{
		id: "toggle-rail",
		keys: ["a"],
		aliases: [[MOD, "I"]],
		description: "Toggle Ask AI (open and focus composer)",
		scope: "global",
		surfaces: "all",
	},
	{
		id: "focus-composer",
		keys: ["a"],
		description: "Focus the Ask AI composer (when the rail is already open)",
		scope: "global",
		surfaces: "all",
	},
	{
		id: "new-conversation",
		keys: ["A"],
		aliases: [[MOD, "Shift", "N"]],
		description: "Open Ask AI with a new conversation",
		scope: "global",
		surfaces: "all",
	},
	{
		id: "ask-about-active-file",
		keys: ["g", "a"],
		description: "Ask about the active file",
		scope: "global",
		surfaces: ["diff", "pr-diff"],
	},
	{
		id: "add-selection-to-ask",
		keys: [MOD, "Shift", "A"],
		description: "Add the current line selection to Ask AI",
		scope: "global",
		surfaces: ["diff"],
	},
	{
		id: "send",
		keys: ["Enter"],
		aliases: [[MOD, "↵"]],
		description: "Send the current prompt",
		scope: "composer",
		surfaces: "all",
	},
	{
		id: "stop",
		keys: [MOD, "."],
		description: "Stop the running request",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "prev-conversation",
		keys: [MOD, "["],
		description: "Previous conversation",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "next-conversation",
		keys: [MOD, "]"],
		description: "Next conversation",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "quick-action-1",
		keys: [MOD, "1"],
		description: "Run quick action 1",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "quick-action-2",
		keys: [MOD, "2"],
		description: "Run quick action 2",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "quick-action-3",
		keys: [MOD, "3"],
		description: "Run quick action 3",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "open-model-picker",
		keys: [MOD, "M"],
		description: "Open the model picker",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "cycle-reasoning",
		keys: [MOD, "Shift", "E"],
		description: "Cycle reasoning effort",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "copy-last-response",
		keys: [MOD, "Shift", "Y"],
		description: "Copy the last assistant response",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "retry-last",
		keys: [MOD, "Shift", "Enter"],
		description: "Retry the last failed request",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "attach-image",
		keys: [MOD, "U"],
		description: "Attach an image",
		scope: "composer",
		surfaces: "all",
	},
	{
		id: "clear-composer",
		keys: [MOD, "Shift", "X"],
		description: "Clear the composer",
		scope: "composer",
		surfaces: "all",
	},
	{
		id: "close-rail",
		keys: ["Esc"],
		description: "Close Ask AI",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "toggle-context-details",
		keys: [MOD, "Shift", "."],
		description: "Toggle context-being-shared details",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "toggle-findings",
		keys: [],
		description: "Toggle cited findings",
		scope: "rail",
		surfaces: "all",
	},
	{
		id: "insert-file-mention",
		keys: [MOD, "Shift", "F"],
		description: "Insert a file mention",
		scope: "composer",
		surfaces: "all",
	},
];

const BY_ID = new Map(AI_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

export function aiShortcutKeys(id: AiShortcutId): string[] {
	return BY_ID.get(id)?.keys.slice() ?? [];
}

export function shortcutAppliesToSurface(
	shortcut: AiShortcut,
	surface: AiSurface,
): boolean {
	return shortcut.surfaces === "all" || shortcut.surfaces.includes(surface);
}

export function helpItemsForSurface(surface: AiSurface): {
	keys: string[];
	description: string;
}[] {
	const items: { keys: string[]; description: string }[] = [];
	const seen = new Set<string>();
	for (const shortcut of AI_SHORTCUTS) {
		if (!shortcutAppliesToSurface(shortcut, surface)) continue;
		if (shortcut.keys.length === 0) continue;
		if (shortcut.id === "focus-composer") continue;
		const rows = [shortcut.keys, ...(shortcut.aliases ?? [])];
		for (const keys of rows) {
			const fingerprint = `${keys.join("+")}::${shortcut.description}`;
			if (seen.has(fingerprint)) continue;
			seen.add(fingerprint);
			items.push({ keys, description: shortcut.description });
		}
	}
	return items;
}

function isModKey(part: string): boolean {
	return part === "⌘" || part === "Mod" || part === "Ctrl" || part === "Cmd";
}

function isShiftKey(part: string): boolean {
	return part === "Shift";
}

function isAltKey(part: string): boolean {
	return part === "Alt" || part === "⌥";
}

function isModifierPart(part: string): boolean {
	return isModKey(part) || isShiftKey(part) || isAltKey(part);
}

function normalizeEventKey(key: string): string {
	if (key === "↵") return "enter";
	if (key === "Esc" || key === "Escape") return "escape";
	return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

function chordKeyMatches(eventKey: string, eventCode: string, part: string): boolean {
	const expected = normalizeEventKey(part);
	const actual = normalizeEventKey(eventKey);
	if (expected === "." || expected === "period") {
		return actual === "." || actual === ">" || eventCode === "Period";
	}
	if (expected === "enter") return actual === "enter";
	if (expected === "escape") return actual === "escape";
	return actual === expected;
}

function eventMatchesBinding(
	event: KeyboardEvent | ReactKeyboardEvent,
	keys: string[],
): boolean {
	if (keys.length === 0) return false;
	const wantsMod = keys.some(isModKey);
	const wantsShift = keys.some(isShiftKey);
	const wantsAlt = keys.some(isAltKey);
	const keyParts = keys.filter((part) => !isModifierPart(part));
	if (keyParts.length !== 1) return false;
	const keyPart = keyParts[0];
	const eventMod = event.metaKey || event.ctrlKey;
	if (eventMod !== wantsMod) return false;
	if (event.altKey !== wantsAlt) return false;
	const code = "code" in event ? String(event.code ?? "") : "";
	if (!wantsMod) {
		if (keyPart === "Esc" || keyPart === "Escape")
			return event.key === "Escape" || event.key === "Esc";
		if (keyPart === "Enter" || keyPart === "↵") return event.key === "Enter";
		return event.key === keyPart;
	}
	if (event.shiftKey !== wantsShift) return false;
	return chordKeyMatches(event.key, code, keyPart);
}

export function matchesAiShortcut(
	event: KeyboardEvent | ReactKeyboardEvent,
	id: AiShortcutId,
): boolean {
	const shortcut = BY_ID.get(id);
	if (!shortcut) return false;
	if (eventMatchesBinding(event, shortcut.keys)) return true;
	return (shortcut.aliases ?? []).some((keys) => eventMatchesBinding(event, keys));
}

export const DIFF_RESERVED_BARE_KEYS = [
	"j",
	"k",
	"J",
	"K",
	"g",
	"G",
	"v",
	"e",
	"m",
	"t",
	"b",
	"w",
	"#",
	"n",
	"N",
	"F",
	"i",
	"I",
	"/",
	"f",
	"s",
	"z",
	"?",
	"[",
	"]",
] as const;

export const PLAN_RESERVED_BARE_KEYS = [
	"j",
	"k",
	"J",
	"K",
	"m",
	"z",
	"c",
	"o",
	"t",
	"b",
	"w",
	"n",
	"e",
	"?",
] as const;

export const MOCKUP_RESERVED_BARE_KEYS = [
	"j",
	"k",
	"J",
	"K",
	"1",
	"2",
	"3",
	"c",
	"e",
	"v",
	"z",
	"b",
	"[",
	"]",
	"?",
] as const;

export function bareKeysForSurface(surface: AiSurface): string[] {
	const keys: string[] = [];
	for (const shortcut of AI_SHORTCUTS) {
		if (!shortcutAppliesToSurface(shortcut, surface)) continue;
		if (shortcut.scope !== "global") continue;
		const bindings = [shortcut.keys, ...(shortcut.aliases ?? [])];
		for (const binding of bindings) {
			if (binding.length === 1 && !isModifierPart(binding[0])) keys.push(binding[0]);
		}
	}
	return keys;
}
