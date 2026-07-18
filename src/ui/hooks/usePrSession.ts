import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { subscribeLive } from '../live'
import type { PrSession, PrExistingComment, PrDecision } from '../../lib/pr-session'
import type { ReviewComment } from '../../lib/types'

const PR_SESSION_KEY = ['pr-session'] as const

interface PrSessionResponse {
  prMode: boolean
  ref: string
  owner: string
  repo: string
  pullNumber: number
  baseSha: string
  headSha: string
  title: string
  url: string
  author: { login: string; avatarUrl?: string } | null
  additions: number
  deletions: number
  changedFiles: number
  existingComments: PrExistingComment[]
  submittedAt?: number
  submittedReviewId?: number
  submittedReviewUrl?: string
  authSource?: 'gh' | 'token'
}

/**
 * Resolves the active PR session. Returns `null` (with `loaded` false until the
 * first response) when the server is in local mode. Subscribes to the
 * `pr-session` SSE channel so a refresh from another tab / the CLI subcommand
 * re-renders the UI immediately.
 */
export function usePrSession() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery<PrSessionResponse | null>({
    queryKey: PR_SESSION_KEY,
    queryFn: async () => {
      const res = await fetch('/api/gh/session')
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as PrSessionResponse & { prMode?: boolean }
      // Soft "not in PR mode" probe returns 200 + { prMode: false }.
      if (json?.prMode === false) return null
      return json
    },
    retry: false,
  })

  useEffect(() => {
    return subscribeLive('pr-session', () => {
      queryClient.invalidateQueries({ queryKey: PR_SESSION_KEY })
    })
  }, [queryClient])

  return {
    session: data,
    loaded: !isLoading,
    error,
  }
}

interface PrCommentsResponse extends Array<ReviewComment> {}

const PR_COMMENTS_KEY = ['pr-comments'] as const

/**
 * Read/write the user's in-progress PR comments (stored in `pr-session.json`,
 * NOT `comments.json`). The hook is split from `useComments` so the wrong
 * storage backend can never accidentally be used.
 */
export function usePrComments(enabled: boolean) {
  const queryClient = useQueryClient()
  const { data: comments = [] } = useQuery<PrCommentsResponse>({
    queryKey: PR_COMMENTS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/gh/pr-session/comments')
      if (res.status === 404) return []
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled,
  })

  // Real-time: the server pushes a `pr-session` event when the file changes
  // (whether from this UI, the CLI subcommand, or an external editor). Re-fetch
  // both the session and the comments so the list stays in sync.
  useEffect(() => {
    return subscribeLive('pr-session', () => {
      queryClient.invalidateQueries({ queryKey: PR_COMMENTS_KEY })
    })
  }, [queryClient])

  const addMutation = useMutation({
    mutationFn: async (params: {
      filePath: string
      side: 'deletions' | 'additions'
      lineNumber: number
      startLineNumber?: number
      lineContent: string
      body: string
    }) => {
      const res = await fetch('/api/gh/pr-session/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (comment) => {
      queryClient.setQueryData<ReviewComment[]>(PR_COMMENTS_KEY, (prev = []) => [...prev, comment])
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/gh/pr-session/comments/${id}`, { method: 'DELETE' })
      return id
    },
    onSuccess: (id) => {
      queryClient.setQueryData<ReviewComment[]>(PR_COMMENTS_KEY, (prev = []) => prev.filter((c) => c.id !== id))
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, body, status }: { id: string; body?: string; status?: ReviewComment['status'] }) => {
      const res = await fetch(`/api/gh/pr-session/comments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, status }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(PR_COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const replyMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const res = await fetch(`/api/gh/pr-session/comments/${id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, role: 'user' }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(PR_COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const resolveComment = useCallback(
    (id: string) => {
      updateMutation.mutate({ id, status: 'resolved' })
    },
    [updateMutation],
  )

  const unresolveComment = useCallback(
    (id: string) => {
      updateMutation.mutate({ id, status: 'open' })
    },
    [updateMutation],
  )

  // Reply edit/delete are local-only draft helpers; PR drafts don't yet have
  // dedicated reply routes for edit/delete, so no-op until those land.
  const editReply = useCallback((_commentId: string, _replyId: string, _body: string) => {}, [])
  const removeReply = useCallback((_commentId: string, _replyId: string) => {}, [])

  return {
    comments,
    addComment: addMutation.mutate,
    removeComment: removeMutation.mutate,
    updateComment: updateMutation.mutate,
    addReply: replyMutation.mutate,
    resolveComment,
    unresolveComment,
    editComment: (id: string, body: string) => updateMutation.mutate({ id, body }),
    editReply,
    removeReply,
  }
}

export interface SubmitPrReviewInput {
  decision: PrDecision
  body: string
  dryRun?: boolean
}

export interface SubmitPrReviewResult {
  ok: boolean
  reviewId?: number
  reviewUrl?: string
  authSource: 'gh' | 'token' | 'none'
  error?: string
  dryRun?: boolean
  failedComments?: number
}

export function useSubmitPrReview() {
  const queryClient = useQueryClient()
  return useMutation<SubmitPrReviewResult, Error, SubmitPrReviewInput>({
    mutationFn: async (input) => {
      const res = await fetch('/api/gh/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: input.decision,
          body: input.body,
          dryRun: input.dryRun,
        }),
      })
      const data = (await res.json()) as SubmitPrReviewResult
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PR_SESSION_KEY })
    },
  })
}

export function useRefreshPrSession() {
  const queryClient = useQueryClient()
  return useMutation<{ ok: true; headSha: string }, Error, void>({
    mutationFn: async () => {
      const res = await fetch('/api/gh/pr/refresh', { method: 'POST' })
      const data = (await res.json()) as { ok: boolean; headSha?: string; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data as { ok: true; headSha: string }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PR_SESSION_KEY })
      queryClient.invalidateQueries({ queryKey: PR_COMMENTS_KEY })
    },
  })
}

export type { PrSession, PrExistingComment, PrDecision }
