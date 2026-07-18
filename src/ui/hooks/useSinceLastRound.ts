import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { subscribeLive } from '../live'

export interface SinceLastRound {
  hasBaseline: boolean
  round: number
  changed: string[]
  added: string[]
  removed: string[]
  /** changed ∪ added — files the human should re-check */
  reviewFiles: string[]
}

const KEY = ['review-since-last'] as const

/**
 * Live delta of the working-tree (or PR) diff vs the last "Send to agent"
 * baseline. Refetches when comments handoff or the tree changes.
 */
export function useSinceLastRound(enabled = true) {
  const queryClient = useQueryClient()
  const query = useQuery<SinceLastRound>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch('/api/review/since-last')
      if (!res.ok) {
        return {
          hasBaseline: false,
          round: 0,
          changed: [],
          added: [],
          removed: [],
          reviewFiles: [],
        }
      }
      return res.json()
    },
    enabled,
    staleTime: 2_000,
  })

  useEffect(() => {
    if (!enabled) return
    const bump = () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
    }
    const unsubChange = subscribeLive('change', bump)
    const unsubAgent = subscribeLive('agent-status', bump)
    return () => {
      unsubChange()
      unsubAgent()
    }
  }, [enabled, queryClient])

  const data = query.data
  const reviewSet = useMemo(
    () => new Set(data?.reviewFiles ?? []),
    [data?.reviewFiles],
  )

  return {
    sinceLast: data ?? null,
    reviewSet,
    hasBaseline: Boolean(data?.hasBaseline),
    loading: query.isLoading,
    refetch: query.refetch,
  }
}
