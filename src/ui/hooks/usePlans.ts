import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Plan, PlanDecision, PlanVersion, PlanMode } from '../../lib/plan-types'
import { subscribeLive } from '../live'

const PLANS_KEY = ['plans']

async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch('/api/plans')
  return res.json()
}

interface PlanAgentStatus {
  round: number
  waiters: number
  lastDecidedAt: number | null
}

export interface PlanAgentActivity {
  at: number
  planId: string
  commentId: string
  model?: string
  body: string
}

interface AddCommentParams {
  planId: string
  lineNumber: number
  startLineNumber?: number
  lineContent: string
  sectionTitle?: string
  body: string
  /**
   * The plan version the comment is anchored to. Defaults to the plan's
   * current version; pass an older number when the user is commenting on a
   * historical version they're browsing in the UI.
   */
  createdAtPlanVersion?: number
}

/**
 * Plan-review counterpart to {@link useComments}: reads the plan store, follows
 * live `plans` / `plan-review-status` pushes, and exposes the comment/reply CRUD
 * plus the approve/reject/request-changes handoff. All mutations write back the
 * server's returned plan so the cache stays authoritative even across the SSE
 * refresh.
 */
export function usePlans() {
  const queryClient = useQueryClient()
  const { data: plans = [], isLoading } = useQuery({ queryKey: PLANS_KEY, queryFn: fetchPlans })

  // Realtime: the server pushes a `plans` event whenever the store changes
  // (a human or agent submitted / commented / replied / resolved).
  useEffect(() => {
    return subscribeLive('plans', () => {
      queryClient.invalidateQueries({ queryKey: PLANS_KEY })
    })
  }, [queryClient])

  // Follow the plan handoff so the decision bar can show whether an agent is
  // connected and waiting for a verdict.
  const [agentStatus, setAgentStatus] = useState<PlanAgentStatus>({ round: 0, waiters: 0, lastDecidedAt: null })
  useEffect(() => {
    let cancelled = false
    fetch('/api/plan-review/status')
      .then((r) => r.json())
      .then((s) => {
        if (!cancelled) setAgentStatus(s)
      })
      .catch(() => {})
    const unsubscribe = subscribeLive('plan-review-status', (data) => {
      try {
        setAgentStatus(JSON.parse(data))
      } catch {
        /* ignore malformed */
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // Flash a toast when an agent replies to a plan comment. Seed the seen-set on
  // first load so pre-existing replies don't flash.
  const seenReplyIds = useRef<Set<string> | null>(null)
  const [agentActivity, setAgentActivity] = useState<PlanAgentActivity | null>(null)
  useEffect(() => {
    const firstLoad = seenReplyIds.current === null
    if (seenReplyIds.current === null) seenReplyIds.current = new Set()
    const seen = seenReplyIds.current

    let latest: PlanAgentActivity | null = null
    for (const plan of plans) {
      for (const comment of plan.comments ?? []) {
        for (const reply of comment.replies ?? []) {
          if (seen.has(reply.id)) continue
          seen.add(reply.id)
          const isAgent = reply.role === 'agent' || (reply.role == null && !!reply.model)
          if (!firstLoad && isAgent) {
            if (!latest || reply.createdAt > latest.at) {
              latest = {
                at: reply.createdAt,
                planId: plan.id,
                commentId: comment.id,
                model: reply.model,
                body: reply.body,
              }
            }
          }
        }
      }
    }
    if (latest) setAgentActivity(latest)
  }, [plans])

  const writePlan = useCallback(
    (plan: Plan) => {
      queryClient.setQueryData<Plan[]>(PLANS_KEY, (prev = []) =>
        prev.some((p) => p.id === plan.id) ? prev.map((p) => (p.id === plan.id ? plan : p)) : [...prev, plan],
      )
    },
    [queryClient],
  )

  const addCommentMutation = useMutation({
    mutationFn: async ({ planId, ...rest }: AddCommentParams) => {
      const res = await fetch(`/api/plans/${planId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rest),
      })
      return res.json() as Promise<Plan>
    },
    onSuccess: writePlan,
  })

  const editCommentMutation = useMutation({
    mutationFn: async ({ planId, commentId, body, status }: { planId: string; commentId: string; body?: string; status?: 'open' | 'resolved' }) => {
      const res = await fetch(`/api/plans/${planId}/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, status }),
      })
      return res.json() as Promise<Plan>
    },
    onSuccess: writePlan,
  })

  const removeCommentMutation = useMutation({
    mutationFn: async ({ planId, commentId }: { planId: string; commentId: string }) => {
      const res = await fetch(`/api/plans/${planId}/comments/${commentId}`, { method: 'DELETE' })
      return res.json() as Promise<Plan>
    },
    onSuccess: writePlan,
  })

  const addReplyMutation = useMutation({
    mutationFn: async ({ planId, commentId, body }: { planId: string; commentId: string; body: string }) => {
      const res = await fetch(`/api/plans/${planId}/comments/${commentId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, role: 'user' }),
      })
      return res.json() as Promise<Plan>
    },
    onSuccess: writePlan,
  })

  const editReplyMutation = useMutation({
    mutationFn: async ({ planId, commentId, replyId, body }: { planId: string; commentId: string; replyId: string; body: string }) => {
      const res = await fetch(`/api/plans/${planId}/comments/${commentId}/replies/${replyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      return res.json() as Promise<Plan>
    },
    onSuccess: writePlan,
  })

  const removeReplyMutation = useMutation({
    mutationFn: async ({ planId, commentId, replyId }: { planId: string; commentId: string; replyId: string }) => {
      const res = await fetch(`/api/plans/${planId}/comments/${commentId}/replies/${replyId}`, { method: 'DELETE' })
      return res.json() as Promise<Plan>
    },
    onSuccess: writePlan,
  })

  const decisionMutation = useMutation({
    mutationFn: async ({ planId, decision, decisionComment, mode }: { planId: string; decision: PlanDecision; decisionComment?: string; mode?: PlanMode }) => {
      const res = await fetch(`/api/plans/${planId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, decisionComment: decisionComment?.trim() || undefined, mode }),
      })
      if (!res.ok) throw new Error('Failed to submit plan decision')
      return res.json() as Promise<{ ok: boolean; round: number; decision: PlanDecision; openCommentCount: number; waiters: number }>
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PLANS_KEY }),
  })

  const removePlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      await fetch(`/api/plans/${planId}`, { method: 'DELETE' })
      return planId
    },
    onSuccess: (planId) => {
      queryClient.setQueryData<Plan[]>(PLANS_KEY, (prev = []) => prev.filter((p) => p.id !== planId))
    },
  })

  return {
    plans,
    getPlan: useCallback((id: string) => plans.find((p) => p.id === id) ?? null, [plans]),
    addPlanComment: useCallback((p: AddCommentParams) => addCommentMutation.mutate(p), [addCommentMutation.mutate]),
    editPlanComment: useCallback(
      (planId: string, commentId: string, body: string) => editCommentMutation.mutate({ planId, commentId, body }),
      [editCommentMutation.mutate],
    ),
    resolvePlanComment: useCallback(
      (planId: string, commentId: string) => editCommentMutation.mutate({ planId, commentId, status: 'resolved' }),
      [editCommentMutation.mutate],
    ),
    unresolvePlanComment: useCallback(
      (planId: string, commentId: string) => editCommentMutation.mutate({ planId, commentId, status: 'open' }),
      [editCommentMutation.mutate],
    ),
    removePlanComment: useCallback(
      (planId: string, commentId: string) => removeCommentMutation.mutate({ planId, commentId }),
      [removeCommentMutation.mutate],
    ),
    addPlanReply: useCallback(
      (planId: string, commentId: string, body: string) => addReplyMutation.mutate({ planId, commentId, body }),
      [addReplyMutation.mutate],
    ),
    editPlanReply: useCallback(
      (planId: string, commentId: string, replyId: string, body: string) => editReplyMutation.mutate({ planId, commentId, replyId, body }),
      [editReplyMutation.mutate],
    ),
    removePlanReply: useCallback(
      (planId: string, commentId: string, replyId: string) => removeReplyMutation.mutate({ planId, commentId, replyId }),
      [removeReplyMutation.mutate],
    ),
    removePlan: useCallback((planId: string) => removePlanMutation.mutate(planId), [removePlanMutation.mutate]),
    submitDecision: useCallback(
      (planId: string, decision: PlanDecision, decisionComment?: string, mode?: PlanMode) =>
        decisionMutation.mutateAsync({ planId, decision, decisionComment, mode }),
      [decisionMutation.mutateAsync],
    ),
    submitting: decisionMutation.isPending,
    agentWaiting: agentStatus.waiters > 0,
    agentActivity,
    clearAgentActivity: useCallback(() => setAgentActivity(null), []),
    isLoading,
  }
}

/**
 * Standalone hook for the plan version-switcher UI. Returns the ordered
 * list of submitted versions for `planId` (oldest-first) plus helpers to
 * resolve a specific version's body — first from the in-memory cache (the
 * `Plan.versions[]` array comes back with every plan), then falling back
 * to a network call against `/api/plans/:id/versions/:n` if the user
 * navigates to a version we don't have yet (e.g. live SSE arrived without
 * the full array).
 */
export function usePlanVersions(planId: string | null | undefined) {
  const queryClient = useQueryClient()
  const plan = useQuery({
    queryKey: [...PLANS_KEY, planId],
    queryFn: async () => (planId ? fetchPlanById(planId) : null),
    enabled: !!planId,
  })

  // Keep the per-plan query fresh when the server broadcasts a `plans` SSE
  // event. `usePlans` does the same invalidation for the full list; we mirror
  // it here so this hook is self-sufficient for components that use it
  // without also calling `usePlans`.
  useEffect(() => {
    return subscribeLive('plans', () => {
      queryClient.invalidateQueries({ queryKey: PLANS_KEY })
    })
  }, [queryClient])

  const versions = useMemo<PlanVersion[]>(() => plan.data?.versions ?? [], [plan.data])

  const fetchVersion = useCallback(
    async (n: number): Promise<PlanVersion | null> => {
      if (!planId) return null
      // Cache fast path
      const cached = versions.find((v) => v.version === n)
      if (cached) return cached
      try {
        const res = await fetch(`/api/plans/${planId}/versions/${n}`)
        if (res.status === 404) return null
        if (!res.ok) return null
        const data = (await res.json()) as { version: PlanVersion }
        return data.version
      } catch {
        return null
      }
    },
    [planId, versions],
  )

  return {
    versions,
    currentVersion: plan.data?.version ?? null,
    isLoading: plan.isLoading,
    error: plan.error,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: PLANS_KEY })
      return plan.refetch()
    },
    fetchVersion,
  }
}

/**
 * Resolve a single historical version's body. Returns `null` while the
 * plan cache is loading. If the version is missing locally, falls back to
 * a `GET /api/plans/:id/versions/:n` round-trip.
 */
export function usePlanVersion(planId: string | null | undefined, version: number | null | undefined) {
  const { versions, currentVersion, fetchVersion, isLoading } = usePlanVersions(planId)
  const [networkVersion, setNetworkVersion] = useState<PlanVersion | null>(null)
  // Only invalidate `networkVersion` when the requested version or plan
  // actually changes. Re-running the effect on every `versions` array identity
  // change would briefly flip the returned `version` to null, which is wrong
  // (and trips up tests that poll for the cached value).
  const lastResolvedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const key = `${planId ?? ''}::${version ?? ''}`
    if (lastResolvedKeyRef.current !== key) {
      lastResolvedKeyRef.current = key
      setNetworkVersion(null)
    }
    if (version == null || !planId) return
    const cached = versions.find((v) => v.version === version)
    if (cached) {
      setNetworkVersion(cached)
      return
    }
    let cancelled = false
    fetchVersion(version).then((v) => {
      if (!cancelled) setNetworkVersion(v)
    })
    return () => {
      cancelled = true
    }
  }, [version, planId, versions, fetchVersion])

  const fromCache = version != null ? versions.find((v) => v.version === version) : undefined
  return {
    version: fromCache ?? networkVersion,
    isCurrent: version != null && version === currentVersion,
    isLoading: isLoading && !fromCache && !networkVersion,
  }
}

async function fetchPlanById(id: string): Promise<Plan | null> {
  const res = await fetch(`/api/plans/${id}`)
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json()
}
