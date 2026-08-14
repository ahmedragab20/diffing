import { join } from "node:path";
import { readFile, writeFile, mkdir, rm, unlink } from "node:fs/promises";
import { getRepoRoot, getProjectStorageDir } from "./git.js";
import type { CommentReply } from "./types.js";
import type {
	Mockup,
	MockupComment,
	MockupDecision,
	MockupScreen,
	MockupScreenInput,
	MockupVersion,
} from "./mockup-types.js";
import {
	defaultScreenLabel,
	normalizeSubmitScreens,
} from "./mockup-types.js";

export function mockupSourceDir(storageDir: string, mockupId: string): string {
	return join(storageDir, "mockup-sources", mockupId);
}

export function mockupScreenFilePath(
	storageDir: string,
	mockupId: string,
	screenId: string,
): string {
	return join(mockupSourceDir(storageDir, mockupId), `${screenId}.html`);
}

export interface MockupUpsertInput {
	id?: string;
	title: string;
	screens: MockupScreen[];
	source?: string;
	model?: string;
}

export interface MockupScreenOpResult {
	mockup: Mockup | null;
	error?: string;
	versionMismatch?: { expectedVersion: number; currentVersion: number };
	/** patchScreen only: how many times expectedText matched before patching. */
	occurrences?: number;
}

/** One op in an atomic thread batch (see MockupStore.applyThreadBatch). */
export type MockupThreadOp =
	| {
			op: "reply";
			commentId: string;
			body: string;
			role?: string;
			model?: string;
	  }
	| { op: "edit"; commentId: string; replyId?: string; body: string }
	| { op: "delete"; commentId: string; replyId?: string }
	| { op: "resolve"; commentId: string }
	| { op: "unresolve"; commentId: string };

export interface MockupThreadOpResult {
	op: MockupThreadOp["op"];
	commentId: string;
	replyId?: string;
	ok: boolean;
}

export interface ThreadBatchResult {
	mockup: Mockup | null;
	error?: string;
	results: MockupThreadOpResult[];
}

export interface MockupStore {
	getAll(): Promise<Mockup[]>;
	get(id: string): Promise<Mockup | null>;
	upsert(input: MockupUpsertInput): Promise<Mockup>;
	update(
		id: string,
		fields: {
			title?: string;
			screens?: MockupScreen[];
			source?: string;
			model?: string;
		},
	): Promise<Mockup | null>;
	remove(id: string): Promise<boolean>;
	setDecision(
		id: string,
		decision: MockupDecision,
		decisionComment?: string,
	): Promise<Mockup | null>;
	addComment(mockupId: string, comment: MockupComment): Promise<Mockup | null>;
	updateComment(
		mockupId: string,
		commentId: string,
		fields: { body?: string; status?: MockupComment["status"] },
	): Promise<Mockup | null>;
	removeComment(mockupId: string, commentId: string): Promise<Mockup | null>;
	addReply(
		mockupId: string,
		commentId: string,
		reply: CommentReply,
	): Promise<Mockup | null>;
	removeReply(
		mockupId: string,
		commentId: string,
		replyId: string,
	): Promise<Mockup | null>;
	updateReply(
		mockupId: string,
		commentId: string,
		replyId: string,
		body: string,
	): Promise<Mockup | null>;
	getVersion(id: string, version: number): Promise<MockupVersion | null>;

	/**
	 * One-screen upsert (add or replace). Bumps the mockup version and records a
	 * version snapshot. Returns a versionMismatch when expectedVersion differs
	 * from the current version (no mutation applied).
	 */
	upsertScreen(
		id: string,
		screen: MockupScreenInput,
		opts?: { expectedVersion?: number },
	): Promise<MockupScreenOpResult>;

	/**
	 * One-screen remove. Bumps the mockup version. Rejects removing the last
	 * screen so a reviewable mockup always has at least one screen.
	 */
	removeScreen(
		id: string,
		screenId: string,
		opts?: { expectedVersion?: number },
	): Promise<MockupScreenOpResult>;

	/**
	 * Exact-text patch on one screen: replaces the first literal occurrence of
	 * expectedText. Bumps the mockup version. `occurrences` reports how many
	 * times expectedText appeared before the patch.
	 */
	patchScreen(
		id: string,
		screenId: string,
		patch: { expectedText: string; replacement: string },
		opts?: { expectedVersion?: number },
	): Promise<MockupScreenOpResult>;

	/**
	 * Atomic thread batch: every op is validated against the current mockup
	 * before any is applied, so the batch is all-or-nothing. Thread ops never
	 * bump the mockup version (they do not change the design).
	 */
	applyThreadBatch(
		mockupId: string,
		ops: MockupThreadOp[],
	): Promise<ThreadBatchResult>;
}

function newId(): string {
	return crypto.randomUUID();
}

function snapshotScreens(screens: MockupScreen[]): MockupScreen[] {
	return screens.map((s) => ({ id: s.id, label: s.label, html: s.html }));
}

function backfillMockup(mockup: Mockup): void {
	const currentVersion = mockup.version ?? 1;
	const have = Array.isArray(mockup.versions) ? mockup.versions.length : 0;
	if (!mockup.versions || have === 0 || have < currentVersion) {
		const createdAt = mockup.updatedAt ?? mockup.createdAt ?? Date.now();
		const haveEntries = Array.isArray(mockup.versions) ? mockup.versions : [];
		const next: MockupVersion[] = [];
		for (let i = 1; i <= currentVersion; i++) {
			const existing = haveEntries.find((v) => v.version === i);
			next.push(
				existing ?? {
					version: i,
					title: mockup.title,
					screens: snapshotScreens(mockup.screens ?? []),
					source: mockup.source,
					model: mockup.model,
					createdAt,
				},
			);
		}
		mockup.versions = next.filter(
			(v) => v.version >= 1 && v.version <= currentVersion,
		);
	}
	if (!mockup.screens) mockup.screens = [];
	if (!mockup.comments) mockup.comments = [];
	for (const c of mockup.comments) {
		if (typeof c.createdAtMockupVersion !== "number") {
			c.createdAtMockupVersion = mockup.version ?? 1;
		}
		if (!c.replies) c.replies = [];
	}
}

function applyUpsert(
	mockups: Mockup[],
	input: MockupUpsertInput,
	now: number,
): Mockup {
	if (input.id) {
		const existing = mockups.find((m) => m.id === input.id);
		if (existing) {
			existing.title = input.title;
			existing.screens = snapshotScreens(input.screens);
			if (input.source !== undefined) existing.source = input.source;
			if (input.model !== undefined) existing.model = input.model;
			existing.version += 1;
			existing.updatedAt = now;
			if (!existing.versions) existing.versions = [];
			existing.versions.push({
				version: existing.version,
				title: existing.title,
				screens: snapshotScreens(existing.screens),
				source: existing.source,
				model: existing.model,
				createdAt: now,
			});
			existing.decision = "pending";
			existing.decisionComment = undefined;
			existing.decidedAt = undefined;
			return existing;
		}
	}
	const mockup: Mockup = {
		id: input.id || newId(),
		title: input.title,
		screens: snapshotScreens(input.screens),
		source: input.source,
		model: input.model,
		createdAt: now,
		updatedAt: now,
		version: 1,
		decision: "pending",
		comments: [],
		versions: [
			{
				version: 1,
				title: input.title,
				screens: snapshotScreens(input.screens),
				source: input.source,
				model: input.model,
				createdAt: now,
			},
		],
	};
	mockups.push(mockup);
	return mockup;
}

function applyComment<T>(
	mockups: Mockup[],
	mockupId: string,
	fn: (mockup: Mockup) => T | null,
): T | null {
	const mockup = mockups.find((m) => m.id === mockupId);
	if (!mockup) return null;
	if (!mockup.comments) mockup.comments = [];
	return fn(mockup);
}

function syncCurrentVersion(mockup: Mockup): void {
	if (!mockup.versions || mockup.versions.length === 0) {
		mockup.versions = [];
	}
	if (mockup.versions.length === 0) {
		mockup.versions.push({
			version: mockup.version,
			title: mockup.title,
			screens: snapshotScreens(mockup.screens),
			source: mockup.source,
			model: mockup.model,
			createdAt: mockup.updatedAt,
		});
		return;
	}
	const last = mockup.versions[mockup.versions.length - 1];
	last.title = mockup.title;
	last.screens = snapshotScreens(mockup.screens);
	last.source = mockup.source;
	last.model = mockup.model;
}

// ── Screen ops + thread batch (shared by both stores) ───────────────────────

function versionMismatch(
	expected: number | undefined,
	current: number,
): { expectedVersion: number; currentVersion: number } | undefined {
	if (expected === undefined) return undefined;
	if (expected !== current) {
		return { expectedVersion: expected, currentVersion: current };
	}
	return undefined;
}

function bumpMockupVersion(mockup: Mockup, now: number): void {
	mockup.version += 1;
	mockup.updatedAt = now;
	if (!mockup.versions) mockup.versions = [];
	mockup.versions.push({
		version: mockup.version,
		title: mockup.title,
		screens: snapshotScreens(mockup.screens),
		source: mockup.source,
		model: mockup.model,
		createdAt: now,
	});
}

function applyScreenUpsert(
	mockup: Mockup,
	screen: MockupScreenInput,
	now: number,
): void {
	const html = screen.html.replace(/\r\n/g, "\n");
	const existing = mockup.screens.find((s) => s.id === screen.id);
	if (existing) {
		existing.html = html;
		if (screen.label?.trim()) existing.label = screen.label.trim();
	} else {
		mockup.screens.push({
			id: screen.id!,
			label: screen.label?.trim() || defaultScreenLabel(screen.id!),
			html,
		});
	}
	bumpMockupVersion(mockup, now);
}

function applyScreenPatch(
	screen: MockupScreen,
	patch: { expectedText: string; replacement: string },
): number {
	const idx = screen.html.indexOf(patch.expectedText);
	if (idx === -1) return 0;
	const count = screen.html.split(patch.expectedText).length - 1;
	screen.html =
		screen.html.slice(0, idx) +
		patch.replacement +
		screen.html.slice(idx + patch.expectedText.length);
	return count;
}

/** Validate every op against the mockup before applying any (all-or-nothing). */
function validateThreadBatch(
	mockup: Mockup,
	ops: MockupThreadOp[],
): string | null {
	const comments = mockup.comments ?? [];
	for (let i = 0; i < ops.length; i++) {
		const item = ops[i];
		const c = comments.find((x) => x.id === item.commentId);
		if (!c) {
			return `operations[${i}]: comment ${item.commentId} not found`;
		}
		if (
			(item.op === "edit" || item.op === "delete") &&
			item.replyId &&
			!(c.replies ?? []).some((r) => r.id === item.replyId)
		) {
			return `operations[${i}]: reply ${item.replyId} not found on comment ${item.commentId}`;
		}
	}
	return null;
}

/** Apply ops after validation passed — every lookup is guaranteed to hit. */
function applyThreadOps(
	mockup: Mockup,
	ops: MockupThreadOp[],
	now: number,
): MockupThreadOpResult[] {
	const results: MockupThreadOpResult[] = [];
	for (const item of ops) {
		const c = mockup.comments.find((x) => x.id === item.commentId)!;
		switch (item.op) {
			case "reply": {
				const reply: CommentReply = {
					id: crypto.randomUUID(),
					body: item.body,
					createdAt: now,
					role:
						item.role === "agent"
							? "agent"
							: item.role === "user"
								? "user"
								: item.model
									? "agent"
									: "user",
					model: item.model,
				};
				if (typeof c.createdAtMockupVersion === "number") {
					reply.createdAtPlanVersion = c.createdAtMockupVersion;
				}
				if (!c.replies) c.replies = [];
				c.replies.push(reply);
				results.push({
					op: "reply",
					commentId: item.commentId,
					replyId: reply.id,
					ok: true,
				});
				break;
			}
			case "edit": {
				if (item.replyId) {
					const r = c.replies.find((x) => x.id === item.replyId)!;
					r.body = item.body;
				} else {
					c.body = item.body;
				}
				results.push({
					op: "edit",
					commentId: item.commentId,
					replyId: item.replyId,
					ok: true,
				});
				break;
			}
			case "delete": {
				if (item.replyId) {
					const idx = c.replies.findIndex((x) => x.id === item.replyId);
					c.replies.splice(idx, 1);
					results.push({
						op: "delete",
						commentId: item.commentId,
						replyId: item.replyId,
						ok: true,
					});
				} else {
					const idx = mockup.comments.findIndex(
						(x) => x.id === item.commentId,
					);
					mockup.comments.splice(idx, 1);
					results.push({
						op: "delete",
						commentId: item.commentId,
						ok: true,
					});
				}
				break;
			}
			case "resolve":
				c.status = "resolved";
				results.push({ op: "resolve", commentId: item.commentId, ok: true });
				break;
			case "unresolve":
				c.status = "open";
				results.push({ op: "unresolve", commentId: item.commentId, ok: true });
				break;
		}
	}
	return results;
}

/**
 * Shared HTTP/CLI/MCP shape for the atomic thread batch. Validates every op's
 * shape before any store mutation; errors carry the offending op index.
 */
export function normalizeThreadOperations(
	raw: unknown,
): { ok: true; ops: MockupThreadOp[] } | { ok: false; error: string; index?: number } {
	if (!Array.isArray(raw) || raw.length === 0) {
		return { ok: false, error: "operations[] is required" };
	}
	const ops: MockupThreadOp[] = [];
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i] as Record<string, unknown> | null;
		if (!item || typeof item !== "object") {
			return { ok: false, error: `operations[${i}] must be an object`, index: i };
		}
		const op = item.op;
		const commentId = typeof item.commentId === "string" ? item.commentId : "";
		if (!commentId) {
			return {
				ok: false,
				error: `operations[${i}].commentId is required`,
				index: i,
			};
		}
		switch (op) {
			case "reply": {
				const body = typeof item.body === "string" ? item.body : "";
				if (!body.trim()) {
					return {
						ok: false,
						error: `operations[${i}].body is required`,
						index: i,
					};
				}
				ops.push({
					op: "reply",
					commentId,
					body,
					role: typeof item.role === "string" ? item.role : undefined,
					model: typeof item.model === "string" ? item.model : undefined,
				});
				break;
			}
			case "edit": {
				const replyId = typeof item.replyId === "string" ? item.replyId : "";
				const body = typeof item.body === "string" ? item.body : "";
				if (!body.trim()) {
					return {
						ok: false,
						error: `operations[${i}].body is required`,
						index: i,
					};
				}
				ops.push({
					op: "edit",
					commentId,
					replyId: replyId || undefined,
					body,
				});
				break;
			}
			case "delete": {
				const replyId =
					typeof item.replyId === "string" ? item.replyId : undefined;
				ops.push({ op: "delete", commentId, replyId });
				break;
			}
			case "resolve":
			case "unresolve":
				ops.push({ op, commentId });
				break;
			default:
				return {
					ok: false,
					error: `operations[${i}].op must be reply|edit|delete|resolve|unresolve`,
					index: i,
				};
		}
	}
	return { ok: true, ops };
}

export class InMemoryMockupStore implements MockupStore {
	private mockups: Mockup[] = [];

	async getAll(): Promise<Mockup[]> {
		return this.mockups;
	}

	async get(id: string): Promise<Mockup | null> {
		const mockup = this.mockups.find((m) => m.id === id) ?? null;
		if (mockup) backfillMockup(mockup);
		return mockup;
	}

	async getVersion(id: string, version: number): Promise<MockupVersion | null> {
		const mockup = this.mockups.find((m) => m.id === id);
		if (!mockup) return null;
		backfillMockup(mockup);
		return mockup.versions.find((v) => v.version === version) ?? null;
	}

	async upsert(input: MockupUpsertInput): Promise<Mockup> {
		const mockup = applyUpsert(this.mockups, input, Date.now());
		backfillMockup(mockup);
		return mockup;
	}

	async update(
		id: string,
		fields: {
			title?: string;
			screens?: MockupScreen[];
			source?: string;
			model?: string;
		},
	): Promise<Mockup | null> {
		const mockup = this.mockups.find((m) => m.id === id);
		if (!mockup) return null;
		if (fields.title !== undefined) mockup.title = fields.title;
		if (fields.screens !== undefined)
			mockup.screens = snapshotScreens(fields.screens);
		if (fields.source !== undefined) mockup.source = fields.source;
		if (fields.model !== undefined) mockup.model = fields.model;
		mockup.updatedAt = Date.now();
		syncCurrentVersion(mockup);
		backfillMockup(mockup);
		return mockup;
	}

	async remove(id: string): Promise<boolean> {
		const idx = this.mockups.findIndex((m) => m.id === id);
		if (idx === -1) return false;
		this.mockups.splice(idx, 1);
		return true;
	}

	async setDecision(
		id: string,
		decision: MockupDecision,
		decisionComment?: string,
	): Promise<Mockup | null> {
		const mockup = this.mockups.find((m) => m.id === id);
		if (!mockup) return null;
		mockup.decision = decision;
		mockup.decisionComment = decisionComment?.trim() || undefined;
		mockup.decidedAt = Date.now();
		mockup.updatedAt = mockup.decidedAt;
		return mockup;
	}

	async addComment(
		mockupId: string,
		comment: MockupComment,
	): Promise<Mockup | null> {
		return applyComment(this.mockups, mockupId, (mockup) => {
			if (typeof comment.createdAtMockupVersion !== "number") {
				comment.createdAtMockupVersion = mockup.version ?? 1;
			}
			mockup.comments.push(comment);
			return mockup;
		});
	}

	async updateComment(
		mockupId: string,
		commentId: string,
		fields: { body?: string; status?: MockupComment["status"] },
	): Promise<Mockup | null> {
		return applyComment(this.mockups, mockupId, (mockup) => {
			const c = mockup.comments.find((x) => x.id === commentId);
			if (!c) return null;
			if (fields.body !== undefined) c.body = fields.body;
			if (fields.status !== undefined) c.status = fields.status;
			return mockup;
		});
	}

	async removeComment(
		mockupId: string,
		commentId: string,
	): Promise<Mockup | null> {
		return applyComment(this.mockups, mockupId, (mockup) => {
			const idx = mockup.comments.findIndex((x) => x.id === commentId);
			if (idx === -1) return null;
			mockup.comments.splice(idx, 1);
			return mockup;
		});
	}

	async addReply(
		mockupId: string,
		commentId: string,
		reply: CommentReply,
	): Promise<Mockup | null> {
		return applyComment(this.mockups, mockupId, (mockup) => {
			const c = mockup.comments.find((x) => x.id === commentId);
			if (!c) return null;
			if (
				typeof c.createdAtMockupVersion === "number" &&
				typeof reply.createdAtPlanVersion !== "number"
			) {
				reply.createdAtPlanVersion = c.createdAtMockupVersion;
			}
			if (!c.replies) c.replies = [];
			c.replies.push(reply);
			return mockup;
		});
	}

	async removeReply(
		mockupId: string,
		commentId: string,
		replyId: string,
	): Promise<Mockup | null> {
		return applyComment(this.mockups, mockupId, (mockup) => {
			const c = mockup.comments.find((x) => x.id === commentId);
			if (!c) return null;
			const idx = c.replies.findIndex((r) => r.id === replyId);
			if (idx === -1) return null;
			c.replies.splice(idx, 1);
			return mockup;
		});
	}

	async updateReply(
		mockupId: string,
		commentId: string,
		replyId: string,
		body: string,
	): Promise<Mockup | null> {
		return applyComment(this.mockups, mockupId, (mockup) => {
			const c = mockup.comments.find((x) => x.id === commentId);
			if (!c) return null;
			const reply = c.replies.find((r) => r.id === replyId);
			if (!reply) return null;
			reply.body = body;
			return mockup;
		});
	}

	async upsertScreen(
		id: string,
		screen: MockupScreenInput,
		opts?: { expectedVersion?: number },
	): Promise<MockupScreenOpResult> {
		const mockup = this.mockups.find((m) => m.id === id);
		if (!mockup) return { mockup: null, error: "Mockup not found" };
		const vm = versionMismatch(opts?.expectedVersion, mockup.version);
		if (vm) return { mockup: null, versionMismatch: vm };
		applyScreenUpsert(mockup, screen, Date.now());
		return { mockup };
	}

	async removeScreen(
		id: string,
		screenId: string,
		opts?: { expectedVersion?: number },
	): Promise<MockupScreenOpResult> {
		const mockup = this.mockups.find((m) => m.id === id);
		if (!mockup) return { mockup: null, error: "Mockup not found" };
		const vm = versionMismatch(opts?.expectedVersion, mockup.version);
		if (vm) return { mockup: null, versionMismatch: vm };
		const idx = mockup.screens.findIndex((s) => s.id === screenId);
		if (idx === -1) return { mockup: null, error: `Screen ${screenId} not found` };
		if (mockup.screens.length <= 1) {
			return { mockup: null, error: "Cannot remove the last screen" };
		}
		mockup.screens.splice(idx, 1);
		bumpMockupVersion(mockup, Date.now());
		return { mockup };
	}

	async patchScreen(
		id: string,
		screenId: string,
		patch: { expectedText: string; replacement: string },
		opts?: { expectedVersion?: number },
	): Promise<MockupScreenOpResult> {
		const mockup = this.mockups.find((m) => m.id === id);
		if (!mockup) return { mockup: null, error: "Mockup not found" };
		const vm = versionMismatch(opts?.expectedVersion, mockup.version);
		if (vm) return { mockup: null, versionMismatch: vm };
		const screen = mockup.screens.find((s) => s.id === screenId);
		if (!screen) return { mockup: null, error: `Screen ${screenId} not found` };
		if (!patch.expectedText) {
			return { mockup: null, error: "expectedText is required" };
		}
		if (patch.replacement === undefined) {
			return { mockup: null, error: "replacement is required" };
		}
		const occurrences = applyScreenPatch(screen, patch);
		if (occurrences === 0) return { mockup: null, error: "Exact text not found" };
		bumpMockupVersion(mockup, Date.now());
		return { mockup, occurrences };
	}

	async applyThreadBatch(
		mockupId: string,
		ops: MockupThreadOp[],
	): Promise<ThreadBatchResult> {
		const mockup = this.mockups.find((m) => m.id === mockupId);
		if (!mockup) return { mockup: null, error: "Mockup not found", results: [] };
		backfillMockup(mockup);
		const error = validateThreadBatch(mockup, ops);
		if (error) return { mockup: null, error, results: [] };
		const results = applyThreadOps(mockup, ops, Date.now());
		return { mockup, results };
	}
}

export class FileMockupStore implements MockupStore {
	private dirPath: string;
	private filePath: string;

	constructor(storageDir?: string) {
		this.dirPath = storageDir ?? getProjectStorageDir();
		this.filePath = join(this.dirPath, "mockups.json");
	}

	async getAll(): Promise<Mockup[]> {
		try {
			const data = await readFile(this.filePath, "utf-8");
			const mockups: Mockup[] = JSON.parse(data);
			let anyHealed = false;
			for (const m of mockups) {
				backfillMockup(m);
				if (!m.sourcePath) {
					m.sourcePath = mockupSourceDir(this.dirPath, m.id);
					anyHealed = true;
				}
			}
			if (anyHealed) {
				try {
					await this.save(mockups);
				} catch {
					// best-effort
				}
			}
			return mockups;
		} catch {
			return [];
		}
	}

	async get(id: string): Promise<Mockup | null> {
		return (await this.getAll()).find((m) => m.id === id) ?? null;
	}

	async getVersion(id: string, version: number): Promise<MockupVersion | null> {
		const mockup = await this.get(id);
		if (!mockup) return null;
		return mockup.versions.find((v) => v.version === version) ?? null;
	}

	private async save(mockups: Mockup[]): Promise<void> {
		try {
			await mkdir(this.dirPath, { recursive: true });
			try {
				const repoRoot = getRepoRoot();
				await writeFile(join(this.dirPath, "repo_path.txt"), repoRoot, "utf-8");
			} catch {
				// Ignore if outside git repo or in mock sandboxes
			}
			await writeFile(this.filePath, JSON.stringify(mockups, null, 2), "utf-8");
		} catch (err) {
			console.error("Failed to save mockups to file:", err);
		}
	}

	private async writeSourceMirror(mockup: Mockup): Promise<void> {
		try {
			const dir = mockupSourceDir(this.dirPath, mockup.id);
			await mkdir(dir, { recursive: true });
			for (const screen of mockup.screens) {
				await writeFile(join(dir, `${screen.id}.html`), screen.html, "utf-8");
			}
			mockup.sourcePath = dir;
		} catch (err) {
			console.error("Failed to write mockup source mirror:", err);
		}
	}

	async upsert(input: MockupUpsertInput): Promise<Mockup> {
		const mockups = await this.getAll();
		const mockup = applyUpsert(mockups, input, Date.now());
		backfillMockup(mockup);
		await this.writeSourceMirror(mockup);
		await this.save(mockups);
		return mockup;
	}

	async update(
		id: string,
		fields: {
			title?: string;
			screens?: MockupScreen[];
			source?: string;
			model?: string;
		},
	): Promise<Mockup | null> {
		const mockups = await this.getAll();
		const mockup = mockups.find((m) => m.id === id);
		if (!mockup) return null;
		if (fields.title !== undefined) mockup.title = fields.title;
		if (fields.screens !== undefined)
			mockup.screens = snapshotScreens(fields.screens);
		if (fields.source !== undefined) mockup.source = fields.source;
		if (fields.model !== undefined) mockup.model = fields.model;
		mockup.updatedAt = Date.now();
		syncCurrentVersion(mockup);
		backfillMockup(mockup);
		if (fields.screens !== undefined) await this.writeSourceMirror(mockup);
		await this.save(mockups);
		return mockup;
	}

	async remove(id: string): Promise<boolean> {
		const mockups = await this.getAll();
		const idx = mockups.findIndex((m) => m.id === id);
		if (idx === -1) return false;
		mockups.splice(idx, 1);
		await this.save(mockups);
		// Mirrored source cleanup: the mockup is gone, so its screen mirrors must
		// not linger in mockup-sources/.
		try {
			await rm(mockupSourceDir(this.dirPath, id), {
				recursive: true,
				force: true,
			});
		} catch {
			// best-effort
		}
		return true;
	}

	async setDecision(
		id: string,
		decision: MockupDecision,
		decisionComment?: string,
	): Promise<Mockup | null> {
		const mockups = await this.getAll();
		const mockup = mockups.find((m) => m.id === id);
		if (!mockup) return null;
		mockup.decision = decision;
		mockup.decisionComment = decisionComment?.trim() || undefined;
		mockup.decidedAt = Date.now();
		mockup.updatedAt = mockup.decidedAt;
		await this.save(mockups);
		return mockup;
	}

	private async mutate(
		mockupId: string,
		fn: (mockup: Mockup) => boolean,
	): Promise<Mockup | null> {
		const mockups = await this.getAll();
		const mockup = mockups.find((m) => m.id === mockupId);
		if (!mockup) return null;
		if (!mockup.comments) mockup.comments = [];
		const ok = fn(mockup);
		if (!ok) return null;
		backfillMockup(mockup);
		await this.save(mockups);
		return mockup;
	}

	async addComment(
		mockupId: string,
		comment: MockupComment,
	): Promise<Mockup | null> {
		return this.mutate(mockupId, (mockup) => {
			if (typeof comment.createdAtMockupVersion !== "number") {
				comment.createdAtMockupVersion = mockup.version ?? 1;
			}
			mockup.comments.push(comment);
			return true;
		});
	}

	async updateComment(
		mockupId: string,
		commentId: string,
		fields: { body?: string; status?: MockupComment["status"] },
	): Promise<Mockup | null> {
		return this.mutate(mockupId, (mockup) => {
			const c = mockup.comments.find((x) => x.id === commentId);
			if (!c) return false;
			if (fields.body !== undefined) c.body = fields.body;
			if (fields.status !== undefined) c.status = fields.status;
			return true;
		});
	}

	async removeComment(
		mockupId: string,
		commentId: string,
	): Promise<Mockup | null> {
		return this.mutate(mockupId, (mockup) => {
			const idx = mockup.comments.findIndex((x) => x.id === commentId);
			if (idx === -1) return false;
			mockup.comments.splice(idx, 1);
			return true;
		});
	}

	async addReply(
		mockupId: string,
		commentId: string,
		reply: CommentReply,
	): Promise<Mockup | null> {
		return this.mutate(mockupId, (mockup) => {
			const c = mockup.comments.find((x) => x.id === commentId);
			if (!c) return false;
			if (
				typeof c.createdAtMockupVersion === "number" &&
				typeof reply.createdAtPlanVersion !== "number"
			) {
				reply.createdAtPlanVersion = c.createdAtMockupVersion;
			}
			if (!c.replies) c.replies = [];
			c.replies.push(reply);
			return true;
		});
	}

	async removeReply(
		mockupId: string,
		commentId: string,
		replyId: string,
	): Promise<Mockup | null> {
		return this.mutate(mockupId, (mockup) => {
			const c = mockup.comments.find((x) => x.id === commentId);
			if (!c) return false;
			const idx = c.replies.findIndex((r) => r.id === replyId);
			if (idx === -1) return false;
			c.replies.splice(idx, 1);
			return true;
		});
	}

	async updateReply(
		mockupId: string,
		commentId: string,
		replyId: string,
		body: string,
	): Promise<Mockup | null> {
		return this.mutate(mockupId, (mockup) => {
			const c = mockup.comments.find((x) => x.id === commentId);
			if (!c) return false;
			const reply = c.replies.find((r) => r.id === replyId);
			if (!reply) return false;
			reply.body = body;
			return true;
		});
	}

	async upsertScreen(
		id: string,
		screen: MockupScreenInput,
		opts?: { expectedVersion?: number },
	): Promise<MockupScreenOpResult> {
		const mockups = await this.getAll();
		const mockup = mockups.find((m) => m.id === id);
		if (!mockup) return { mockup: null, error: "Mockup not found" };
		const vm = versionMismatch(opts?.expectedVersion, mockup.version);
		if (vm) return { mockup: null, versionMismatch: vm };
		applyScreenUpsert(mockup, screen, Date.now());
		await this.writeSourceMirror(mockup);
		await this.save(mockups);
		return { mockup };
	}

	async removeScreen(
		id: string,
		screenId: string,
		opts?: { expectedVersion?: number },
	): Promise<MockupScreenOpResult> {
		const mockups = await this.getAll();
		const mockup = mockups.find((m) => m.id === id);
		if (!mockup) return { mockup: null, error: "Mockup not found" };
		const vm = versionMismatch(opts?.expectedVersion, mockup.version);
		if (vm) return { mockup: null, versionMismatch: vm };
		const idx = mockup.screens.findIndex((s) => s.id === screenId);
		if (idx === -1) return { mockup: null, error: `Screen ${screenId} not found` };
		if (mockup.screens.length <= 1) {
			return { mockup: null, error: "Cannot remove the last screen" };
		}
		mockup.screens.splice(idx, 1);
		bumpMockupVersion(mockup, Date.now());
		try {
			await unlink(join(mockupSourceDir(this.dirPath, id), `${screenId}.html`));
		} catch {
			// best-effort mirror cleanup
		}
		await this.save(mockups);
		return { mockup };
	}

	async patchScreen(
		id: string,
		screenId: string,
		patch: { expectedText: string; replacement: string },
		opts?: { expectedVersion?: number },
	): Promise<MockupScreenOpResult> {
		const mockups = await this.getAll();
		const mockup = mockups.find((m) => m.id === id);
		if (!mockup) return { mockup: null, error: "Mockup not found" };
		const vm = versionMismatch(opts?.expectedVersion, mockup.version);
		if (vm) return { mockup: null, versionMismatch: vm };
		const screen = mockup.screens.find((s) => s.id === screenId);
		if (!screen) return { mockup: null, error: `Screen ${screenId} not found` };
		if (!patch.expectedText) {
			return { mockup: null, error: "expectedText is required" };
		}
		if (patch.replacement === undefined) {
			return { mockup: null, error: "replacement is required" };
		}
		const occurrences = applyScreenPatch(screen, patch);
		if (occurrences === 0) return { mockup: null, error: "Exact text not found" };
		bumpMockupVersion(mockup, Date.now());
		await this.writeSourceMirror(mockup);
		await this.save(mockups);
		return { mockup, occurrences };
	}

	async applyThreadBatch(
		mockupId: string,
		ops: MockupThreadOp[],
	): Promise<ThreadBatchResult> {
		const mockups = await this.getAll();
		const mockup = mockups.find((m) => m.id === mockupId);
		if (!mockup) return { mockup: null, error: "Mockup not found", results: [] };
		backfillMockup(mockup);
		const error = validateThreadBatch(mockup, ops);
		if (error) return { mockup: null, error, results: [] };
		const results = applyThreadOps(mockup, ops, Date.now());
		await this.save(mockups);
		return { mockup, results };
	}
}

/** Shared by HTTP/CLI so submit shapes stay one path. */
export function screensFromSubmitBody(body: {
	html?: unknown;
	screens?: unknown;
}): ReturnType<typeof normalizeSubmitScreens> {
	const html = typeof body.html === "string" ? body.html : undefined;
	const screens = Array.isArray(body.screens)
		? body.screens.map((item) => {
				const rec = item as { id?: unknown; label?: unknown; html?: unknown };
				return {
					id: typeof rec.id === "string" ? rec.id : undefined,
					label: typeof rec.label === "string" ? rec.label : undefined,
					html: typeof rec.html === "string" ? rec.html : "",
				};
			})
		: undefined;
	return normalizeSubmitScreens({ html, screens });
}
