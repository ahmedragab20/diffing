import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getProjectStorageDir } from "./git.js";
import { writeJsonAtomically } from "./json-atomic.js";
import type { CommentReply } from "./types.js";
import {
	DEFAULT_DESIGN_SYSTEM_ID,
	cloneTokens,
	emptyTokens,
	slugifyDesignId,
	snapshotRevision,
	type DesignComponent,
	type DesignSystem,
	type DesignSystemComment,
	type DesignSystemSource,
	type DesignSystemStatus,
	type DesignTokens,
} from "./design-system-types.js";

export interface DesignSystemUpsertInput {
	id?: string;
	title?: string;
	tokens?: DesignTokens;
	guidelines?: string;
	components?: DesignComponent[];
	sources?: DesignSystemSource[];
	status?: DesignSystemStatus;
}

export interface DesignSystemStore {
	getAll(): Promise<DesignSystem[]>;
	get(id: string): Promise<DesignSystem | null>;
	getDefault(): Promise<DesignSystem | null>;
	upsert(input: DesignSystemUpsertInput): Promise<DesignSystem>;
	propose(id: string, input: DesignSystemUpsertInput): Promise<DesignSystem | null>;
	publish(id: string): Promise<DesignSystem | null>;
	remove(id: string): Promise<boolean>;
	addComponent(
		id: string,
		component: Omit<DesignComponent, "createdAt"> & { createdAt?: number },
	): Promise<DesignSystem | null>;
	removeComponent(id: string, componentId: string): Promise<DesignSystem | null>;
	addComment(
		id: string,
		comment: Omit<DesignSystemComment, "id" | "createdAt" | "replies" | "status"> & {
			status?: "open" | "resolved";
		},
	): Promise<DesignSystem | null>;
	updateComment(
		id: string,
		commentId: string,
		fields: { body?: string; status?: "open" | "resolved" },
	): Promise<DesignSystem | null>;
	addReply(
		id: string,
		commentId: string,
		reply: CommentReply,
	): Promise<DesignSystem | null>;
}

function newId(): string {
	return crypto.randomUUID();
}

function backfill(system: DesignSystem): void {
	if (!system.tokens) system.tokens = emptyTokens();
	if (!system.tokens.raw) system.tokens.raw = {};
	if (!system.tokens.color) system.tokens.color = {};
	if (!system.tokens.font) system.tokens.font = {};
	if (!system.tokens.radius) system.tokens.radius = {};
	if (!system.tokens.shadow) system.tokens.shadow = {};
	if (!system.tokens.space) {
		system.tokens.space = { unit: 4, scale: [4, 8, 12, 16, 24, 32, 48] };
	}
	if (!system.components) system.components = [];
	if (!system.sources) system.sources = [];
	if (!system.comments) system.comments = [];
	if (!system.revisions) system.revisions = [];
	if (!system.guidelines) system.guidelines = "";
	if (!system.status) system.status = system.revision > 0 ? "published" : "draft";
}

function applyFields(system: DesignSystem, input: DesignSystemUpsertInput, now: number): void {
	if (input.title?.trim()) system.title = input.title.trim();
	if (input.tokens) system.tokens = cloneTokens(input.tokens);
	if (input.guidelines !== undefined) system.guidelines = input.guidelines;
	if (input.components) {
		system.components = input.components.map((c) => ({ ...c }));
	}
	if (input.sources) system.sources = input.sources.map((s) => ({ ...s }));
	if (input.status) system.status = input.status;
	system.updatedAt = now;
}

export class InMemoryDesignSystemStore implements DesignSystemStore {
	private systems: DesignSystem[] = [];

	async getAll(): Promise<DesignSystem[]> {
		for (const s of this.systems) backfill(s);
		return this.systems;
	}

	async get(id: string): Promise<DesignSystem | null> {
		const system = this.systems.find((s) => s.id === id) ?? null;
		if (system) backfill(system);
		return system;
	}

	async getDefault(): Promise<DesignSystem | null> {
		const published = this.systems.find(
			(s) => s.id === DEFAULT_DESIGN_SYSTEM_ID && s.status === "published",
		);
		if (published) {
			backfill(published);
			return published;
		}
		const any = this.systems.find((s) => s.status === "published") ?? this.systems[0];
		if (any) backfill(any);
		return any ?? null;
	}

	async upsert(input: DesignSystemUpsertInput): Promise<DesignSystem> {
		const now = Date.now();
		const id = slugifyDesignId(input.id ?? DEFAULT_DESIGN_SYSTEM_ID) ?? DEFAULT_DESIGN_SYSTEM_ID;
		const existing = this.systems.find((s) => s.id === id);
		if (existing) {
			applyFields(existing, input, now);
			return existing;
		}
		const system: DesignSystem = {
			id,
			title: input.title?.trim() || "Default",
			revision: 0,
			status: input.status ?? "draft",
			tokens: input.tokens ? cloneTokens(input.tokens) : emptyTokens(),
			guidelines: input.guidelines ?? "",
			components: (input.components ?? []).map((c) => ({ ...c })),
			sources: (input.sources ?? []).map((s) => ({ ...s })),
			createdAt: now,
			updatedAt: now,
			revisions: [],
			comments: [],
		};
		this.systems.push(system);
		return system;
	}

	async propose(id: string, input: DesignSystemUpsertInput): Promise<DesignSystem | null> {
		const system = await this.get(id);
		if (!system) return null;
		const now = Date.now();
		applyFields(system, input, now);
		system.status = "draft";
		return system;
	}

	async publish(id: string): Promise<DesignSystem | null> {
		const system = await this.get(id);
		if (!system) return null;
		const now = Date.now();
		system.revision += 1;
		system.status = "published";
		system.updatedAt = now;
		system.publishedAt = now;
		system.revisions.push(snapshotRevision(system));
		return system;
	}

	async remove(id: string): Promise<boolean> {
		const idx = this.systems.findIndex((s) => s.id === id);
		if (idx === -1) return false;
		this.systems.splice(idx, 1);
		return true;
	}

	async addComponent(
		id: string,
		component: Omit<DesignComponent, "createdAt"> & { createdAt?: number },
	): Promise<DesignSystem | null> {
		const system = await this.get(id);
		if (!system) return null;
		const slug = slugifyDesignId(component.id);
		if (!slug) return null;
		const next: DesignComponent = {
			...component,
			id: slug,
			createdAt: component.createdAt ?? Date.now(),
		};
		const idx = system.components.findIndex((c) => c.id === slug);
		if (idx >= 0) system.components[idx] = next;
		else system.components.push(next);
		system.updatedAt = Date.now();
		system.status = "draft";
		return system;
	}

	async removeComponent(id: string, componentId: string): Promise<DesignSystem | null> {
		const system = await this.get(id);
		if (!system) return null;
		const before = system.components.length;
		system.components = system.components.filter((c) => c.id !== componentId);
		if (system.components.length === before) return system;
		system.updatedAt = Date.now();
		system.status = "draft";
		return system;
	}

	async addComment(
		id: string,
		comment: Omit<DesignSystemComment, "id" | "createdAt" | "replies" | "status"> & {
			status?: "open" | "resolved";
		},
	): Promise<DesignSystem | null> {
		const system = await this.get(id);
		if (!system) return null;
		system.comments.push({
			id: newId(),
			kind: comment.kind,
			target: comment.target,
			body: comment.body,
			status: comment.status ?? "open",
			createdAt: Date.now(),
			replies: [],
		});
		system.updatedAt = Date.now();
		return system;
	}

	async updateComment(
		id: string,
		commentId: string,
		fields: { body?: string; status?: "open" | "resolved" },
	): Promise<DesignSystem | null> {
		const system = await this.get(id);
		if (!system) return null;
		const comment = system.comments.find((c) => c.id === commentId);
		if (!comment) return null;
		if (fields.body !== undefined) comment.body = fields.body;
		if (fields.status) comment.status = fields.status;
		system.updatedAt = Date.now();
		return system;
	}

	async addReply(
		id: string,
		commentId: string,
		reply: CommentReply,
	): Promise<DesignSystem | null> {
		const system = await this.get(id);
		if (!system) return null;
		const comment = system.comments.find((c) => c.id === commentId);
		if (!comment) return null;
		comment.replies.push(reply);
		system.updatedAt = Date.now();
		return system;
	}
}

export class FileDesignSystemStore implements DesignSystemStore {
	private dirPath: string;
	private filePath: string;
	private memory = new InMemoryDesignSystemStore();
	private loaded = false;

	constructor(storageDir?: string) {
		this.dirPath = storageDir ?? getProjectStorageDir();
		this.filePath = join(this.dirPath, "design-system.json");
	}

	private async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as { systems?: DesignSystem[] };
			const systems = Array.isArray(parsed.systems) ? parsed.systems : [];
			(this.memory as unknown as { systems: DesignSystem[] }).systems = systems;
			for (const system of systems) backfill(system);
		} catch {
			/* first run */
		}
	}

	private async persist(): Promise<void> {
		await mkdir(this.dirPath, { recursive: true });
		const systems = await this.memory.getAll();
		writeJsonAtomically(this.filePath, { systems });
		try {
			const tokens = systems.find((s) => s.status === "published") ?? systems[0];
			if (tokens) {
				const { tokensToCss } = await import("./design-system-types.js");
				const dir = join(this.dirPath, "design-system");
				await mkdir(dir, { recursive: true });
				await writeFile(join(dir, `${tokens.id}.css`), tokensToCss(tokens.tokens), "utf8");
			}
		} catch {
			/* mirror is best-effort */
		}
	}

	async getAll(): Promise<DesignSystem[]> {
		await this.load();
		return this.memory.getAll();
	}
	async get(id: string): Promise<DesignSystem | null> {
		await this.load();
		return this.memory.get(id);
	}
	async getDefault(): Promise<DesignSystem | null> {
		await this.load();
		return this.memory.getDefault();
	}
	async upsert(input: DesignSystemUpsertInput): Promise<DesignSystem> {
		await this.load();
		const system = await this.memory.upsert(input);
		await this.persist();
		return system;
	}
	async propose(id: string, input: DesignSystemUpsertInput): Promise<DesignSystem | null> {
		await this.load();
		const system = await this.memory.propose(id, input);
		if (system) await this.persist();
		return system;
	}
	async publish(id: string): Promise<DesignSystem | null> {
		await this.load();
		const system = await this.memory.publish(id);
		if (system) await this.persist();
		return system;
	}
	async remove(id: string): Promise<boolean> {
		await this.load();
		const ok = await this.memory.remove(id);
		if (ok) await this.persist();
		return ok;
	}
	async addComponent(
		id: string,
		component: Omit<DesignComponent, "createdAt"> & { createdAt?: number },
	): Promise<DesignSystem | null> {
		await this.load();
		const system = await this.memory.addComponent(id, component);
		if (system) await this.persist();
		return system;
	}
	async removeComponent(id: string, componentId: string): Promise<DesignSystem | null> {
		await this.load();
		const system = await this.memory.removeComponent(id, componentId);
		if (system) await this.persist();
		return system;
	}
	async addComment(
		id: string,
		comment: Omit<DesignSystemComment, "id" | "createdAt" | "replies" | "status"> & {
			status?: "open" | "resolved";
		},
	): Promise<DesignSystem | null> {
		await this.load();
		const system = await this.memory.addComment(id, comment);
		if (system) await this.persist();
		return system;
	}
	async updateComment(
		id: string,
		commentId: string,
		fields: { body?: string; status?: "open" | "resolved" },
	): Promise<DesignSystem | null> {
		await this.load();
		const system = await this.memory.updateComment(id, commentId, fields);
		if (system) await this.persist();
		return system;
	}
	async addReply(
		id: string,
		commentId: string,
		reply: CommentReply,
	): Promise<DesignSystem | null> {
		await this.load();
		const system = await this.memory.addReply(id, commentId, reply);
		if (system) await this.persist();
		return system;
	}
}
