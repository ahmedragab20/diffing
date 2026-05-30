import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment, ReviewDecision } from '../../lib/types'
import { formatComments } from '../../lib/comment-format'
import { subscribeLive } from '../live'

const COMMENTS_KEY = ['comments']

async function fetchComments(): Promise<ReviewComment[]> {
  const res = await fetch('/api/comments')
  return res.json()
}

export interface AgentActivity {
  at: number
  commentId: string
  filePath: string
  model?: string
  body: string
}

interface AgentStatus {
  round: number
  waiters: number
  lastSentAt: number | null
}

export function useComments() {
  const queryClient = useQueryClient()
  const { data: comments = [] } = useQuery({ queryKey: COMMENTS_KEY, queryFn: fetchComments })

  // Realtime: the server pushes a `comments` event whenever the store changes
  // (a user or agent added / replied / resolved / deleted). Refetch on push
  // instead of polling, so user<->agent exchanges feel instant.
  useEffect(() => {
    return subscribeLive('comments', () => {
      queryClient.invalidateQueries({ queryKey: COMMENTS_KEY })
    })
  }, [queryClient])

  // Track the agent-handoff state so the "Send to agent" button can show
  // whether an agent is connected and waiting. Seed once, then follow the
  // server's `agent-status` pushes (an agent connected/left, or a round sent).
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ round: 0, waiters: 0, lastSentAt: null })
  useEffect(() => {
    let cancelled = false
    fetch('/api/review/status')
      .then((r) => r.json())
      .then((s) => { if (!cancelled) setAgentStatus(s) })
      .catch(() => {})
    const unsubscribe = subscribeLive('agent-status', (data) => {
      try { setAgentStatus(JSON.parse(data)) } catch { /* ignore malformed */ }
    })
    return () => { cancelled = true; unsubscribe() }
  }, [])

  // Surface fresh agent replies so the UI can flash a "the agent responded"
  // indicator. We track which reply ids we've already seen; on the first load
  // we just seed the set (no flash for pre-existing history).
  const seenReplyIds = useRef<Set<string> | null>(null)
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(null)

  useEffect(() => {
    const firstLoad = seenReplyIds.current === null
    if (seenReplyIds.current === null) seenReplyIds.current = new Set()
    const seen = seenReplyIds.current

    let latest: AgentActivity | null = null
    for (const comment of comments) {
      for (const reply of comment.replies ?? []) {
        if (seen.has(reply.id)) continue
        seen.add(reply.id)
        const isAgent = reply.role === 'agent' || (reply.role == null && !!reply.model)
        if (!firstLoad && isAgent) {
          if (!latest || reply.createdAt > latest.at) {
            latest = {
              at: reply.createdAt,
              commentId: comment.id,
              filePath: comment.filePath,
              model: reply.model,
              body: reply.body,
            }
          }
        }
      }
    }
    if (latest) setAgentActivity(latest)
  }, [comments])

  const addMutation = useMutation({
    mutationFn: async (params: { filePath: string; side: 'deletions' | 'additions'; lineNumber: number; startLineNumber?: number; lineContent: string; body: string }) => {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (comment) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) => [...prev, comment])
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/comments/${id}`, { method: 'DELETE' })
      return id
    },
    onSuccess: (id) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) => prev.filter((c) => c.id !== id))
    },
  })

  const editMutation = useMutation({
    mutationFn: async ({ id, body, status }: { id: string; body?: string; status?: ReviewComment['status'] }) => {
      const res = await fetch(`/api/comments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, status }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const addReplyMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const res = await fetch(`/api/comments/${id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, role: 'user' }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const removeReplyMutation = useMutation({
    mutationFn: async ({ commentId, replyId }: { commentId: string; replyId: string }) => {
      const res = await fetch(`/api/comments/${commentId}/replies/${replyId}`, { method: 'DELETE' })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const editReplyMutation = useMutation({
    mutationFn: async ({ commentId, replyId, body }: { commentId: string; replyId: string; body: string }) => {
      const res = await fetch(`/api/comments/${commentId}/replies/${replyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const sendToAgentMutation = useMutation({
    mutationFn: async ({ decision, generalComment }: { decision?: ReviewDecision; generalComment?: string }) => {
      const res = await fetch('/api/review/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, generalComment: generalComment?.trim() || undefined }),
      })
      if (!res.ok) throw new Error('Failed to send to agent')
      return res.json() as Promise<{ ok: boolean; round: number; openCount: number; decision?: ReviewDecision; waiters: number }>
    },
  })

  const applySuggestionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/comments/${id}/apply-suggestion`, {
        method: 'POST',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to apply suggestion')
      }
      return res.json() as Promise<{ ok: boolean }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMMENTS_KEY })
    },
  })

  const addComment = useCallback(
    (filePath: string, side: 'deletions' | 'additions', lineNumber: number, lineContent: string, body: string, startLineNumber?: number) => {
      addMutation.mutate({ filePath, side, lineNumber, startLineNumber, lineContent, body })
    },
    [addMutation.mutate],
  )

  const removeComment = useCallback(
    (id: string) => {
      removeMutation.mutate(id)
    },
    [removeMutation.mutate],
  )

  const editComment = useCallback(
    (id: string, body: string) => {
      editMutation.mutate({ id, body })
    },
    [editMutation.mutate],
  )

  const resolveComment = useCallback(
    (id: string) => {
      editMutation.mutate({ id, status: 'resolved' })
    },
    [editMutation.mutate],
  )

  const unresolveComment = useCallback(
    (id: string) => {
      editMutation.mutate({ id, status: 'open' })
    },
    [editMutation.mutate],
  )

  const addReply = useCallback(
    (id: string, body: string) => {
      addReplyMutation.mutate({ id, body })
    },
    [addReplyMutation.mutate],
  )

  const removeReply = useCallback(
    (commentId: string, replyId: string) => {
      removeReplyMutation.mutate({ commentId, replyId })
    },
    [removeReplyMutation.mutate],
  )

  const editReply = useCallback(
    (commentId: string, replyId: string, body: string) => {
      editReplyMutation.mutate({ commentId, replyId, body })
    },
    [editReplyMutation.mutate],
  )

  const applySuggestion = useCallback(
    async (id: string) => {
      await applySuggestionMutation.mutateAsync(id)
    },
    [applySuggestionMutation.mutateAsync],
  )

  const formatAllComments = useCallback((): string => formatComments(comments), [comments])

  const getAnnotationsForFile = useCallback(
    (filePath: string): DiffLineAnnotation<ReviewComment>[] => {
      return comments
        .filter((c) => c.filePath === filePath)
        .map((c) => ({
          side: c.side,
          lineNumber: c.lineNumber,
          metadata: c,
        }))
    },
    [comments],
  )

  const copyAllComments = useCallback(async () => {
    const text = formatAllComments()
    await navigator.clipboard.writeText(text)
  }, [formatAllComments])

  const sendToAgent = useCallback(
    (decision?: ReviewDecision, generalComment?: string) =>
      sendToAgentMutation.mutateAsync({ decision, generalComment }),
    [sendToAgentMutation.mutateAsync],
  )

  return {
    comments,
    addComment,
    removeComment,
    editComment,
    resolveComment,
    unresolveComment,
    addReply,
    removeReply,
    editReply,
    applySuggestion,
    getAnnotationsForFile,
    formatAllComments,
    copyAllComments,
    agentActivity,
    clearAgentActivity: useCallback(() => setAgentActivity(null), []),
    sendToAgent,
    sending: sendToAgentMutation.isPending,
    agentWaiting: agentStatus.waiters > 0,
  }
}
