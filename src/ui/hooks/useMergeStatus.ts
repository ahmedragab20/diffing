import { useEffect, useState, useCallback } from 'react'

export interface MergeStatus {
  inMerge: boolean
  conflicts: string[]
}

/**
 * Polls `/api/merge-status` (refetched whenever the diff updates) so the UI
 * can surface the @pierre/diffs UnresolvedFile resolver for conflicted files.
 */
export function useMergeStatus(refreshKey?: unknown) {
  const [status, setStatus] = useState<MergeStatus>({ inMerge: false, conflicts: [] })

  const refresh = useCallback(() => {
    fetch('/api/merge-status')
      .then((res) => (res.ok ? res.json() : { inMerge: false, conflicts: [] }))
      .then(setStatus)
      .catch(() => setStatus({ inMerge: false, conflicts: [] }))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, refreshKey])

  return { status, refresh }
}
