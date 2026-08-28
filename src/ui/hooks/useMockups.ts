import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommentSeverity } from "../../lib/types";
import type {
	Mockup,
	MockupAnchorKind,
	MockupDecision,
	MockupMode,
	MockupRect,
	MockupSummary,
	MockupViewport,
} from "../../lib/mockup-types";
import { subscribeLive } from "../live";

const MOCKUPS_KEY = ["mockups"];
const MOCKUP_SUMMARIES_KEY = [...MOCKUPS_KEY, "summaries"];

function asSummary(raw: unknown): MockupSummary | null {
	if (!raw || typeof raw !== "object") return null;
	const m = raw as Partial<Mockup> & Partial<MockupSummary>;
	if (typeof m.id !== "string" || typeof m.title !== "string") return null;
	const comments = Array.isArray(m.comments) ? m.comments : [];
	const screens = Array.isArray(m.screens)
		? m.screens.map((s) => ({
				id: typeof s.id === "string" ? s.id : "main",
				label: typeof s.label === "string" ? s.label : s.id,
			}))
		: [];
	const counts = m.commentCounts;
	return {
		id: m.id,
		title: m.title,
		screens,
		source: m.source,
		model: m.model,
		createdAt: m.createdAt ?? 0,
		updatedAt: m.updatedAt ?? 0,
		version: m.version ?? 1,
		decision: m.decision ?? "pending",
		decidedAt: m.decidedAt,
		versionCount:
			typeof m.versionCount === "number"
				? m.versionCount
				: Array.isArray(m.versions)
					? m.versions.length
					: 1,
		commentCounts: {
			total: counts?.total ?? comments.length,
			open: counts?.open ?? comments.filter((c) => c.status === "open").length,
			resolved:
				counts?.resolved ?? comments.filter((c) => c.status === "resolved").length,
		},
		designSystemId: m.designSystemId,
		planId: m.planId,
	};
}

async function fetchMockups(): Promise<MockupSummary[]> {
	const res = await fetch("/api/mockups");
	if (!res.ok) return [];
	const data = await res.json();
	if (!Array.isArray(data)) return [];
	return data
		.map(asSummary)
		.filter((item): item is MockupSummary => item != null);
}

async function fetchMockup(id: string): Promise<Mockup | null> {
	const res = await fetch(`/api/mockups/${encodeURIComponent(id)}`);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error("Failed to load mockup");
	return res.json() as Promise<Mockup>;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
	const data = (await res.json().catch(() => null)) as {
		error?: unknown;
	} | null;
	return typeof data?.error === "string" && data.error.trim()
		? data.error
		: fallback;
}

function summarizeMockup(mockup: Mockup): MockupSummary {
	return {
		id: mockup.id,
		title: mockup.title,
		screens: mockup.screens.map(({ id, label }) => ({ id, label })),
		source: mockup.source,
		model: mockup.model,
		createdAt: mockup.createdAt,
		updatedAt: mockup.updatedAt,
		version: mockup.version,
		decision: mockup.decision,
		decidedAt: mockup.decidedAt,
		versionCount: mockup.versions.length,
		commentCounts: {
			total: (mockup.comments ?? []).length,
			open: (mockup.comments ?? []).filter((comment) => comment.status === "open")
				.length,
			resolved: (mockup.comments ?? []).filter(
				(comment) => comment.status === "resolved",
			).length,
		},
		designSystemId: mockup.designSystemId,
		planId: mockup.planId,
	};
}

interface AgentStatus {
	round: number;
	waiters: number;
	lastDecidedAt: number | null;
}

export interface AddMockupCommentParams {
	mockupId: string;
	screenId: string;
	kind: MockupAnchorKind;
	body: string;
	target?: string;
	selector?: string;
	html?: string;
	contextHtml?: string;
	x?: number;
	y?: number;
	sectionX?: number;
	sectionY?: number;
	snapshot?: string;
	rect?: MockupRect;
	severity?: CommentSeverity;
	createdAtMockupVersion?: number;
	/** Per-document nonce from the served screen document (X-Diffing-Mockup-Nonce). */
	nonce?: string;
	/** Layout width the comment was anchored at (part of comment scope). */
	viewport?: MockupViewport;
	theme?: "light" | "dark";
	/** Stable section-relative DOM path fingerprint for block comments. */
	fingerprint?: string;
}

export function useMockups(activeId: string | null) {
	const queryClient = useQueryClient();
	const { data: mockups = [], isLoading: summariesLoading } = useQuery({
		queryKey: MOCKUP_SUMMARIES_KEY,
		queryFn: fetchMockups,
	});
	const { data: activeMockup = null, isLoading: detailLoading } = useQuery({
		queryKey: [...MOCKUPS_KEY, "detail", activeId],
		queryFn: () => fetchMockup(activeId!),
		enabled: Boolean(activeId),
	});

	useEffect(() => {
		return subscribeLive("mockups", () => {
			queryClient.invalidateQueries({ queryKey: MOCKUPS_KEY });
		});
	}, [queryClient]);

	const [agentStatus, setAgentStatus] = useState<AgentStatus>({
		round: 0,
		waiters: 0,
		lastDecidedAt: null,
	});
	useEffect(() => {
		let cancelled = false;
		fetch("/api/mockup-review/status")
			.then((r) => r.json())
			.then((s) => {
				if (!cancelled) setAgentStatus(s);
			})
			.catch(() => {});
		const unsubscribe = subscribeLive("mockup-review-status", (data) => {
			try {
				setAgentStatus(JSON.parse(data));
			} catch {
				/* ignore */
			}
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const writeMockup = useCallback(
		(mockup: Mockup) => {
			queryClient.setQueryData<Mockup>(
				[...MOCKUPS_KEY, "detail", mockup.id],
				mockup,
			);
			const summary = summarizeMockup(mockup);
			queryClient.setQueryData<MockupSummary[]>(
				MOCKUP_SUMMARIES_KEY,
				(prev = []) =>
					prev.some((item) => item.id === mockup.id)
						? prev.map((item) => (item.id === mockup.id ? summary : item))
						: [...prev, summary],
			);
		},
		[queryClient],
	);

	const addComment = useMutation({
		mutationFn: async ({ mockupId, ...rest }: AddMockupCommentParams) => {
			const res = await fetch(`/api/mockups/${mockupId}/comments`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(rest),
			});
			if (!res.ok) throw new Error("Failed to add comment");
			return res.json() as Promise<Mockup>;
		},
		onSuccess: writeMockup,
	});

	const removeComment = useMutation({
		mutationFn: async ({
			mockupId,
			commentId,
		}: {
			mockupId: string;
			commentId: string;
		}) => {
			const res = await fetch(`/api/mockups/${mockupId}/comments/${commentId}`, {
				method: "DELETE",
			});
			if (!res.ok) throw new Error("Failed to delete comment");
			return res.json() as Promise<Mockup>;
		},
		onSuccess: writeMockup,
	});

	const updateReply = useMutation({
		mutationFn: async ({
			mockupId,
			commentId,
			replyId,
			body,
		}: {
			mockupId: string;
			commentId: string;
			replyId: string;
			body: string;
		}) => {
			const res = await fetch(
				`/api/mockups/${mockupId}/comments/${commentId}/replies/${replyId}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ body }),
				},
			);
			if (!res.ok) throw new Error("Failed to update reply");
			return res.json() as Promise<Mockup>;
		},
		onSuccess: writeMockup,
	});

	const removeReply = useMutation({
		mutationFn: async ({
			mockupId,
			commentId,
			replyId,
		}: {
			mockupId: string;
			commentId: string;
			replyId: string;
		}) => {
			const res = await fetch(
				`/api/mockups/${mockupId}/comments/${commentId}/replies/${replyId}`,
				{ method: "DELETE" },
			);
			if (!res.ok) throw new Error("Failed to delete reply");
			return res.json() as Promise<Mockup>;
		},
		onSuccess: writeMockup,
	});

	const updateComment = useMutation({
		mutationFn: async ({
			mockupId,
			commentId,
			body,
			status,
		}: {
			mockupId: string;
			commentId: string;
			body?: string;
			status?: "open" | "resolved";
		}) => {
			const res = await fetch(`/api/mockups/${mockupId}/comments/${commentId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ body, status }),
			});
			if (!res.ok) throw new Error("Failed to update comment");
			return res.json() as Promise<Mockup>;
		},
		onSuccess: writeMockup,
	});

	const addReply = useMutation({
		mutationFn: async ({
			mockupId,
			commentId,
			body,
		}: {
			mockupId: string;
			commentId: string;
			body: string;
		}) => {
			const res = await fetch(
				`/api/mockups/${mockupId}/comments/${commentId}/replies`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ body, role: "user" }),
				},
			);
			if (!res.ok) throw new Error("Failed to reply");
			return res.json() as Promise<Mockup>;
		},
		onSuccess: writeMockup,
	});

	const submitDecision = useMutation({
		mutationFn: async ({
			mockupId,
			decision,
			comment,
			mode,
			screen,
			viewport,
		}: {
			mockupId: string;
			decision: MockupDecision;
			comment?: string;
			mode?: MockupMode;
			screen?: string;
			viewport?: MockupViewport;
		}) => {
			const res = await fetch(`/api/mockups/${mockupId}/decision`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					decision,
					decisionComment: comment,
					mode,
					screen,
					viewport,
				}),
			});
			if (!res.ok) throw new Error("Failed to submit review");
			return res.json();
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: MOCKUPS_KEY }),
	});

	const saveScreens = useMutation({
		mutationFn: async ({
			mockupId,
			screens,
		}: {
			mockupId: string;
			screens: Array<{ id: string; html: string; label?: string }>;
		}) => {
			const res = await fetch(`/api/mockups/${mockupId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ screens }),
			});
			if (!res.ok) throw new Error(await readApiError(res, "Failed to save"));
			return res.json() as Promise<Mockup>;
		},
		onSuccess: writeMockup,
	});

	const bumpScreen = useMutation({
		mutationFn: async ({
			mockupId,
			screenId,
			html,
			expectedVersion,
		}: {
			mockupId: string;
			screenId: string;
			html: string;
			expectedVersion?: number;
		}) => {
			const res = await fetch(
				`/api/mockups/${mockupId}/screens/${encodeURIComponent(screenId)}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ html, expectedVersion }),
				},
			);
			if (!res.ok) {
				throw new Error(await readApiError(res, "Failed to save as new version"));
			}
			return res.json() as Promise<Mockup>;
		},
		onSuccess: writeMockup,
	});

	const applySuggestion = useMutation({
		mutationFn: async ({
			mockupId,
			commentId,
			expectedVersion,
		}: {
			mockupId: string;
			commentId: string;
			expectedVersion?: number;
		}) => {
			const res = await fetch(
				`/api/mockups/${mockupId}/comments/${commentId}/apply-suggestion`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ expectedVersion }),
				},
			);
			if (!res.ok) {
				throw new Error(
					await readApiError(res, "The suggestion could not be applied."),
				);
			}
			return res.json() as Promise<Mockup>;
		},
		onSuccess: writeMockup,
	});

	const removeMockup = useMutation({
		mutationFn: async (id: string) => {
			const res = await fetch(`/api/mockups/${id}`, { method: "DELETE" });
			if (!res.ok) throw new Error("Failed to delete");
		},
		onSuccess: (_data, id) => {
			queryClient.setQueryData<MockupSummary[]>(
				MOCKUP_SUMMARIES_KEY,
				(prev = []) => prev.filter((mockup) => mockup.id !== id),
			);
			queryClient.removeQueries({
				queryKey: [...MOCKUPS_KEY, "detail", id],
			});
		},
	});

	return {
		mockups,
		activeMockup,
		isLoading: summariesLoading || (Boolean(activeId) && detailLoading),
		addComment: addComment.mutateAsync,
		updateComment: updateComment.mutateAsync,
		removeComment: removeComment.mutateAsync,
		addReply: addReply.mutateAsync,
		updateReply: updateReply.mutateAsync,
		removeReply: removeReply.mutateAsync,
		submitDecision: submitDecision.mutateAsync,
		submitting: submitDecision.isPending,
		saveScreens: saveScreens.mutateAsync,
		bumpScreen: bumpScreen.mutateAsync,
		applySuggestion: applySuggestion.mutateAsync,
		removeMockup: removeMockup.mutate,
		agentWaiting: agentStatus.waiters > 0,
	};
}
