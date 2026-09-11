import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
} from "react";
import type { AiReviewContext, AiSurface } from "../../lib/ai/types";
import type {
	AiConversation,
	AiConversationSummary,
} from "../../lib/ai/conversations";
import {
	createConversation,
	deleteConversation,
	getConversation,
	listConversations,
	updateConversation,
} from "./conversationApi";
import {
	conversationScopeKey,
	localConversation,
} from "./railHelpers";

export interface UseAiConversationsArgs {
	surface: AiSurface;
	context: AiReviewContext;
	selectedModel: string;
	setPrompt: Dispatch<SetStateAction<string>>;
	resetComposer: () => void;
	isBusyRef: MutableRefObject<boolean>;
	resetRunRef: MutableRefObject<() => void>;
	forceScrollRef: MutableRefObject<boolean>;
}

export function useAiConversations({
	surface,
	context,
	selectedModel,
	setPrompt,
	resetComposer,
	isBusyRef,
	resetRunRef,
	forceScrollRef,
}: UseAiConversationsArgs) {
	const [conversation, setConversation] = useState<AiConversation | null>(null);
	const [conversationSummaries, setConversationSummaries] = useState<
		AiConversationSummary[]
	>([]);
	const [conversationLoading, setConversationLoading] = useState(true);
	const [persistenceError, setPersistenceError] = useState<string | null>(null);
	const [renaming, setRenaming] = useState(false);
	const [renameDraft, setRenameDraft] = useState("");
	const [deletePending, setDeletePending] = useState(false);
	const draftTimer = useRef<number | null>(null);
	const latestConversationRef = useRef<AiConversation | null>(null);
	const latestPromptRef = useRef("");
	const scopeKey = useMemo(
		() => conversationScopeKey(surface, context),
		[surface, context],
	);

	useEffect(() => {
		latestConversationRef.current = conversation;
	}, [conversation]);

	const saveDraft = useCallback(
		(nextDraft: string) => {
			latestPromptRef.current = nextDraft;
			if (!conversation || conversation.id.startsWith("local-")) return;
			if (draftTimer.current) window.clearTimeout(draftTimer.current);
			draftTimer.current = window.setTimeout(() => {
				void updateConversation(conversation.id, { draft: nextDraft })
					.then((next) => {
						setConversation((current) =>
							current?.id === next.id
								? { ...current, draft: next.draft, updatedAt: next.updatedAt }
								: current,
						);
					})
					.catch((error) =>
						setPersistenceError(
							error instanceof Error ? error.message : String(error),
						),
					);
			}, 350);
		},
		[conversation],
	);

	useEffect(
		() => () => {
			if (draftTimer.current) window.clearTimeout(draftTimer.current);
			const latestConversation = latestConversationRef.current;
			if (latestConversation && !latestConversation.id.startsWith("local-")) {
				void updateConversation(latestConversation.id, {
					draft: latestPromptRef.current,
				}).catch(() => {});
			}
		},
		[],
	);

	useEffect(() => {
		let alive = true;
		setConversationLoading(true);
		setConversation(null);
		resetRunRef.current();
		setPersistenceError(null);
		void listConversations(surface, scopeKey)
			.then(async (summaries) => {
				if (!alive) return;
				setConversationSummaries(summaries);
				const first = summaries[0];
				if (!first) return;
				const loaded = await getConversation(first.id);
				if (!alive) return;
				setConversation(loaded);
				setPrompt(loaded.draft ?? "");
				latestPromptRef.current = loaded.draft ?? "";
				forceScrollRef.current = true;
			})
			.catch((error) => {
				if (alive)
					setPersistenceError(
						error instanceof Error ? error.message : String(error),
					);
			})
			.finally(() => {
				if (alive) setConversationLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [forceScrollRef, resetRunRef, scopeKey, setPrompt, surface]);

	const ensureConversation = useCallback(async (): Promise<AiConversation> => {
		if (conversation) return conversation;
		try {
			const created = await createConversation({
				surface,
				scopeKey,
				modelId: selectedModel,
			});
			setConversationSummaries((current) => [
				{
					id: created.id,
					title: created.title,
					surface: created.surface,
					scopeKey: created.scopeKey,
					createdAt: created.createdAt,
					updatedAt: created.updatedAt,
					turnCount: 0,
					modelId: created.modelId,
				},
				...current.filter((item) => item.id !== created.id),
			]);
			setConversation(created);
			return created;
		} catch (error) {
			setPersistenceError(error instanceof Error ? error.message : String(error));
			const fallback = localConversation(surface, scopeKey, selectedModel);
			setConversation(fallback);
			return fallback;
		}
	}, [conversation, scopeKey, selectedModel, surface]);

	const newConversation = useCallback(async () => {
		if (isBusyRef.current) return;
		setDeletePending(false);
		setRenaming(false);
		setPrompt("");
		latestPromptRef.current = "";
		resetComposer();
		resetRunRef.current();
		try {
			const created = await createConversation({
				surface,
				scopeKey,
				modelId: selectedModel,
			});
			setConversation(created);
			setConversationSummaries((current) => [
				{
					id: created.id,
					title: created.title,
					surface: created.surface,
					scopeKey: created.scopeKey,
					createdAt: created.createdAt,
					updatedAt: created.updatedAt,
					turnCount: 0,
					modelId: created.modelId,
				},
				...current,
			]);
		} catch (error) {
			setPersistenceError(error instanceof Error ? error.message : String(error));
			setConversation(localConversation(surface, scopeKey, selectedModel));
		}
	}, [
		isBusyRef,
		resetComposer,
		resetRunRef,
		scopeKey,
		selectedModel,
		setPrompt,
		surface,
	]);

	const selectConversation = async (id: string) => {
		if (isBusyRef.current || id === conversation?.id) return;
		resetRunRef.current();
		setConversationLoading(true);
		try {
			const loaded = await getConversation(id);
			setConversation(loaded);
			setPrompt(loaded.draft ?? "");
			latestPromptRef.current = loaded.draft ?? "";
			resetComposer();
			setRenaming(false);
			setDeletePending(false);
			forceScrollRef.current = true;
		} catch (error) {
			setPersistenceError(error instanceof Error ? error.message : String(error));
		} finally {
			setConversationLoading(false);
		}
	};

	const saveRename = async () => {
		if (!conversation || !renameDraft.trim()) return;
		if (conversation.id.startsWith("local-")) {
			setConversation({ ...conversation, title: renameDraft.trim() });
		} else {
			try {
				const next = await updateConversation(conversation.id, {
					title: renameDraft.trim(),
				});
				setConversation(next);
				setConversationSummaries((current) =>
					current.map((item) =>
						item.id === next.id
							? { ...item, title: next.title, updatedAt: next.updatedAt }
							: item,
					),
				);
			} catch (error) {
				setPersistenceError(error instanceof Error ? error.message : String(error));
			}
		}
		setRenaming(false);
	};

	const removeCurrentConversation = async () => {
		if (!conversation || isBusyRef.current) return;
		resetRunRef.current();
		if (conversation.id.startsWith("local-")) {
			setConversation(null);
			setDeletePending(false);
			return;
		}
		try {
			await deleteConversation(conversation.id);
			const remaining = conversationSummaries.filter(
				(item) => item.id !== conversation.id,
			);
			setConversationSummaries(remaining);
			setConversation(null);
			setPrompt("");
			latestPromptRef.current = "";
			if (remaining[0]) await selectConversation(remaining[0].id);
		} catch (error) {
			setPersistenceError(error instanceof Error ? error.message : String(error));
		}
		setDeletePending(false);
	};

	const disposeDraftTimer = useCallback(() => {
		if (draftTimer.current) window.clearTimeout(draftTimer.current);
	}, []);

	return {
		scopeKey,
		conversation,
		setConversation,
		conversationSummaries,
		setConversationSummaries,
		conversationLoading,
		persistenceError,
		setPersistenceError,
		renaming,
		setRenaming,
		renameDraft,
		setRenameDraft,
		deletePending,
		setDeletePending,
		saveDraft,
		ensureConversation,
		newConversation,
		selectConversation,
		saveRename,
		removeCurrentConversation,
		disposeDraftTimer,
		latestPromptRef,
	};
}
