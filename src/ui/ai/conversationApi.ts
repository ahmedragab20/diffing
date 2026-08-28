import type {
	AiConversation,
	AiConversationSummary,
	AiConversationTurn,
	AiSurface,
} from "../../lib/ai/conversations";

async function readJson<T>(response: Response): Promise<T> {
	const contentType = response.headers.get("content-type") ?? "";
	const text = await response.text();
	const trimmed = text.trim();
	if (
		trimmed.startsWith("<") ||
		(contentType.includes("text/html") && !contentType.includes("json"))
	) {
		throw new Error(
			response.ok
				? "Conversation history is unavailable."
				: `HTTP ${response.status}`,
		);
	}
	try {
		return (trimmed ? JSON.parse(trimmed) : {}) as T;
	} catch {
		throw new Error(
			response.ok
				? "Conversation history is unavailable."
				: `HTTP ${response.status}`,
		);
	}
}

async function request<T>(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(input, init);
	const body = await readJson<T & { error?: string }>(response);
	if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
	return body;
}

export async function listConversations(
	surface: AiSurface,
	scopeKey: string,
): Promise<AiConversationSummary[]> {
	const query = new URLSearchParams({ surface, scopeKey });
	const body = await request<{ conversations?: AiConversationSummary[] }>(
		`/api/ai/conversations?${query}`,
	);
	return body.conversations ?? [];
}

export async function getConversation(id: string): Promise<AiConversation> {
	const body = await request<{ conversation: AiConversation }>(
		`/api/ai/conversations/${encodeURIComponent(id)}`,
	);
	if (!body.conversation)
		throw new Error("AI conversation response was invalid.");
	return body.conversation;
}

export async function createConversation(input: {
	surface: AiSurface;
	scopeKey: string;
	title?: string;
	modelId?: string;
}): Promise<AiConversation> {
	const body = await request<{ conversation: AiConversation }>(
		"/api/ai/conversations",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
	);
	if (!body.conversation)
		throw new Error("AI conversation response was invalid.");
	return body.conversation;
}

export async function updateConversation(
	id: string,
	patch: {
		title?: string;
		draft?: string;
		modelId?: string;
		turns?: AiConversationTurn[];
	},
): Promise<AiConversation> {
	const body = await request<{ conversation: AiConversation }>(
		`/api/ai/conversations/${encodeURIComponent(id)}`,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(patch),
		},
	);
	if (!body.conversation)
		throw new Error("AI conversation response was invalid.");
	return body.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
	await request<{ ok: true }>(
		`/api/ai/conversations/${encodeURIComponent(id)}`,
		{ method: "DELETE" },
	);
}
