import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getProjectStorageDir } from "../git.js";
import { writeJsonAtomically } from "../json-atomic.js";
import type {
	AiConversationContextLabel,
	AiConversationTurn,
	AiSurface,
} from "./types.js";

export const AI_CONVERSATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const AI_CONVERSATION_MAX_COUNT = 40;
export const AI_CONVERSATION_MAX_TURNS = 100;
export const AI_CONVERSATION_MAX_MESSAGE_BYTES = 256 * 1024;
export const AI_CONVERSATIONS_MAX_STORE_BYTES = 4 * 1024 * 1024;

export type {
	AiConversationContextLabel,
	AiConversationTurn,
	AiSurface,
} from "./types.js";

export interface AiConversation {
	id: string;
	title: string;
	surface: AiSurface;
	scopeKey: string;
	createdAt: number;
	updatedAt: number;
	modelId?: string;
	draft?: string;
	turns: AiConversationTurn[];
}

export interface AiConversationSummary {
	id: string;
	title: string;
	surface: AiSurface;
	scopeKey: string;
	createdAt: number;
	updatedAt: number;
	turnCount: number;
	modelId?: string;
}

export interface AiConversationCreateInput {
	surface: AiSurface;
	scopeKey: string;
	title?: string;
	modelId?: string;
}

export interface AiConversationUpdateInput {
	title?: string;
	draft?: string;
	modelId?: string;
	turns?: AiConversationTurn[];
}

export interface AiConversationStore {
	list(scope?: {
		surface?: AiSurface;
		scopeKey?: string;
	}): Promise<AiConversationSummary[]>;
	get(id: string): Promise<AiConversation | null>;
	create(input: AiConversationCreateInput): Promise<AiConversation>;
	update(
		id: string,
		input: AiConversationUpdateInput,
	): Promise<AiConversation | null>;
	remove(id: string): Promise<boolean>;
}

const SURFACES = new Set<AiSurface>(["diff", "pr-diff", "plan", "mockup"]);

function boundedText(value: unknown, maxBytes: number): string | undefined {
	if (typeof value !== "string") return undefined;
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	let end = value.length;
	while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes)
		end -= 256;
	return value.slice(0, Math.max(0, end));
}

function normalizeContext(
	value: unknown,
): AiConversationContextLabel | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	const context: AiConversationContextLabel = {};
	if (typeof candidate.kind === "string")
		context.kind = candidate.kind.slice(0, 40);
	if (typeof candidate.filePath === "string")
		context.filePath = candidate.filePath.slice(0, 512);
	if (typeof candidate.label === "string")
		context.label = candidate.label.slice(0, 160);
	if (
		typeof candidate.version === "number" &&
		Number.isFinite(candidate.version)
	)
		context.version = Math.max(0, Math.floor(candidate.version));
	if (Array.isArray(candidate.attachmentPaths)) {
		context.attachmentPaths = candidate.attachmentPaths
			.filter((path): path is string => typeof path === "string")
			.map((path) => path.slice(0, 512))
			.slice(0, 8);
	}
	if (Array.isArray(candidate.selectionLabels)) {
		context.selectionLabels = candidate.selectionLabels
			.filter((label): label is string => typeof label === "string")
			.map((label) => label.slice(0, 640))
			.slice(0, 8);
	}
	if (Array.isArray(candidate.imageAttachments)) {
		context.imageAttachments = candidate.imageAttachments
			.filter(
				(item): item is Record<string, unknown> =>
					!!item && typeof item === "object",
			)
			.map((item) => ({
				url: typeof item.url === "string" ? item.url.slice(0, 512) : "",
				name: typeof item.name === "string" ? item.name.slice(0, 160) : "image",
				mimeType:
					typeof item.mimeType === "string"
						? item.mimeType.slice(0, 80)
						: "image/png",
				size:
					typeof item.size === "number" && Number.isFinite(item.size)
						? Math.max(0, Math.floor(item.size))
						: undefined,
			}))
			.filter((item) => item.url.startsWith("/api/attachments/"))
			.slice(0, 4);
	}
	return Object.keys(context).length ? context : undefined;
}

function normalizeTurn(value: unknown): AiConversationTurn | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Record<string, unknown>;
	if (candidate.role !== "user" && candidate.role !== "assistant") return null;
	const text = boundedText(candidate.text, AI_CONVERSATION_MAX_MESSAGE_BYTES);
	if (!text) return null;
	return {
		id:
			typeof candidate.id === "string" && candidate.id
				? candidate.id.slice(0, 80)
				: randomUUID(),
		role: candidate.role,
		text,
		createdAt:
			typeof candidate.createdAt === "number" &&
			Number.isFinite(candidate.createdAt)
				? candidate.createdAt
				: Date.now(),
		modelId: boundedText(candidate.modelId, 512),
		context: normalizeContext(candidate.context),
	};
}

function normalizeConversation(value: unknown): AiConversation | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.id !== "string" ||
		!candidate.id ||
		!SURFACES.has(candidate.surface as AiSurface)
	)
		return null;
	const now = Date.now();
	const createdAt =
		typeof candidate.createdAt === "number" &&
		Number.isFinite(candidate.createdAt)
			? candidate.createdAt
			: now;
	const updatedAt =
		typeof candidate.updatedAt === "number" &&
		Number.isFinite(candidate.updatedAt)
			? candidate.updatedAt
			: createdAt;
	const turns = Array.isArray(candidate.turns)
		? candidate.turns
				.map(normalizeTurn)
				.filter((turn): turn is AiConversationTurn => !!turn)
				.slice(-AI_CONVERSATION_MAX_TURNS)
		: [];
	return {
		id: candidate.id.slice(0, 80),
		title: boundedText(candidate.title, 160) || "New conversation",
		surface: candidate.surface as AiSurface,
		scopeKey: boundedText(candidate.scopeKey, 512) || "default",
		createdAt,
		updatedAt,
		modelId: boundedText(candidate.modelId, 512),
		draft: boundedText(candidate.draft, 16 * 1024),
		turns,
	};
}

function prune(
	conversations: AiConversation[],
	now = Date.now(),
): AiConversation[] {
	return conversations
		.filter(
			(conversation) =>
				now - conversation.updatedAt <= AI_CONVERSATION_RETENTION_MS,
		)
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, AI_CONVERSATION_MAX_COUNT);
}

function summary(conversation: AiConversation): AiConversationSummary {
	return {
		id: conversation.id,
		title: conversation.title,
		surface: conversation.surface,
		scopeKey: conversation.scopeKey,
		createdAt: conversation.createdAt,
		updatedAt: conversation.updatedAt,
		turnCount: conversation.turns.length,
		modelId: conversation.modelId,
	};
}

function boundedStore(conversations: AiConversation[]): AiConversation[] {
	let next = prune(conversations);
	while (
		next.length &&
		Buffer.byteLength(JSON.stringify(next), "utf8") >
			AI_CONVERSATIONS_MAX_STORE_BYTES
	)
		next = next.slice(0, -1);
	return next;
}

export class InMemoryAiConversationStore implements AiConversationStore {
	private conversations: AiConversation[] = [];

	async list(scope?: {
		surface?: AiSurface;
		scopeKey?: string;
	}): Promise<AiConversationSummary[]> {
		this.conversations = boundedStore(this.conversations);
		return this.conversations
			.filter(
				(conversation) => !scope?.surface || conversation.surface === scope.surface,
			)
			.filter(
				(conversation) =>
					!scope?.scopeKey || conversation.scopeKey === scope.scopeKey,
			)
			.map(summary);
	}

	async get(id: string): Promise<AiConversation | null> {
		this.conversations = boundedStore(this.conversations);
		return (
			this.conversations.find((conversation) => conversation.id === id) ?? null
		);
	}

	async create(input: AiConversationCreateInput): Promise<AiConversation> {
		const now = Date.now();
		const conversation: AiConversation = {
			id: randomUUID(),
			title: boundedText(input.title, 160) || "New conversation",
			surface: input.surface,
			scopeKey: boundedText(input.scopeKey, 512) || "default",
			createdAt: now,
			updatedAt: now,
			modelId: boundedText(input.modelId, 512),
			turns: [],
		};
		this.conversations = boundedStore([conversation, ...this.conversations]);
		return conversation;
	}

	async update(
		id: string,
		input: AiConversationUpdateInput,
	): Promise<AiConversation | null> {
		const current = await this.get(id);
		if (!current) return null;
		const next: AiConversation = {
			...current,
			title:
				input.title === undefined
					? current.title
					: boundedText(input.title, 160) || "New conversation",
			draft:
				input.draft === undefined
					? current.draft
					: boundedText(input.draft, 16 * 1024),
			modelId:
				input.modelId === undefined
					? current.modelId
					: boundedText(input.modelId, 512),
			turns:
				input.turns === undefined
					? current.turns
					: input.turns
							.map(normalizeTurn)
							.filter((turn): turn is AiConversationTurn => !!turn)
							.slice(-AI_CONVERSATION_MAX_TURNS),
			updatedAt: Date.now(),
		};
		this.conversations = boundedStore(
			this.conversations.map((conversation) =>
				conversation.id === id ? next : conversation,
			),
		);
		return next;
	}

	async remove(id: string): Promise<boolean> {
		const before = this.conversations.length;
		this.conversations = this.conversations.filter(
			(conversation) => conversation.id !== id,
		);
		return this.conversations.length !== before;
	}
}

export class FileAiConversationStore implements AiConversationStore {
	private readonly filePath: string;
	private conversations: AiConversation[] | null = null;
	private mutationQueue: Promise<void> = Promise.resolve();

	constructor(storageDir = getProjectStorageDir()) {
		this.filePath = join(storageDir, "ai-conversations.json");
	}

	private async load(): Promise<AiConversation[]> {
		if (this.conversations) return this.conversations;
		try {
			const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
			this.conversations = Array.isArray(parsed)
				? parsed
						.map(normalizeConversation)
						.filter((conversation): conversation is AiConversation => !!conversation)
				: [];
		} catch {
			this.conversations = [];
		}
		return this.conversations;
	}

	private async save(next: AiConversation[]): Promise<void> {
		this.conversations = boundedStore(next);
		const snapshot = this.conversations;
		this.mutationQueue = this.mutationQueue
			.catch(() => {})
			.then(async () => {
				writeJsonAtomically(this.filePath, snapshot);
			});
		await this.mutationQueue;
	}

	async list(scope?: {
		surface?: AiSurface;
		scopeKey?: string;
	}): Promise<AiConversationSummary[]> {
		const conversations = await this.load();
		const next = boundedStore(conversations);
		if (next.length !== conversations.length) await this.save(next);
		return next
			.filter(
				(conversation) => !scope?.surface || conversation.surface === scope.surface,
			)
			.filter(
				(conversation) =>
					!scope?.scopeKey || conversation.scopeKey === scope.scopeKey,
			)
			.map(summary);
	}

	async get(id: string): Promise<AiConversation | null> {
		const conversations = await this.load();
		const next = boundedStore(conversations);
		if (next.length !== conversations.length) await this.save(next);
		return next.find((conversation) => conversation.id === id) ?? null;
	}

	async create(input: AiConversationCreateInput): Promise<AiConversation> {
		const now = Date.now();
		const created: AiConversation = {
			id: randomUUID(),
			title: boundedText(input.title, 160) || "New conversation",
			surface: input.surface,
			scopeKey: boundedText(input.scopeKey, 512) || "default",
			createdAt: now,
			updatedAt: now,
			modelId: boundedText(input.modelId, 512),
			turns: [],
		};
		await this.save([created, ...(await this.load())]);
		return created;
	}

	async update(
		id: string,
		input: AiConversationUpdateInput,
	): Promise<AiConversation | null> {
		const conversations = await this.load();
		const current = conversations.find((conversation) => conversation.id === id);
		if (!current) return null;
		const updated: AiConversation = {
			...current,
			title:
				input.title === undefined
					? current.title
					: boundedText(input.title, 160) || "New conversation",
			draft:
				input.draft === undefined
					? current.draft
					: boundedText(input.draft, 16 * 1024),
			modelId:
				input.modelId === undefined
					? current.modelId
					: boundedText(input.modelId, 512),
			turns:
				input.turns === undefined
					? current.turns
					: input.turns
							.map(normalizeTurn)
							.filter((turn): turn is AiConversationTurn => !!turn)
							.slice(-AI_CONVERSATION_MAX_TURNS),
			updatedAt: Date.now(),
		};
		await this.save(
			conversations.map((conversation) =>
				conversation.id === id ? updated : conversation,
			),
		);
		return updated;
	}

	async remove(id: string): Promise<boolean> {
		const conversations = await this.load();
		const removed = conversations.some((conversation) => conversation.id === id);
		if (removed)
			await this.save(
				conversations.filter((conversation) => conversation.id !== id),
			);
		return removed;
	}
}
