import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavContext } from '../lib/diffIndex'
import {
  activateSearchSessionHit,
  cycleSearchIndex,
  type SearchSession,
  type SearchSessionSnapshot,
} from '../lib/searchSession'

export function useSearchSession(
  navContext: NavContext,
  onNavigateFile: (path: string) => void,
) {
  const [session, setSession] = useState<SearchSession | null>(null)
  const sessionRef = useRef(session)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const flashStatus = useCallback((message: string) => {
    setStatusMessage(message)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(() => setStatusMessage(null), 2500)
  }, [])

  const setSnapshot = useCallback((snap: SearchSessionSnapshot) => {
    if (snap.hits.length === 0) return
    setSession({
      hits: snap.hits,
      index: Math.min(snap.index, snap.hits.length - 1),
      query: snap.query,
    })
  }, [])

  const cycleHit = useCallback(
    (delta: number) => {
      const cur = sessionRef.current
      if (!cur || cur.hits.length === 0) {
        flashStatus('no active search results')
        return
      }
      const nextIndex = cycleSearchIndex(cur.index, delta, cur.hits.length)
      const result = activateSearchSessionHit(cur, nextIndex, navContext, onNavigateFile)
      setSession({ ...cur, index: nextIndex })
      if (result === 'preview-only') {
        flashStatus(`Preview only — ${cur.hits[nextIndex]!.path}`)
      }
    },
    [flashStatus, navContext, onNavigateFile],
  )

  const nextHit = useCallback(() => cycleHit(1), [cycleHit])
  const prevHit = useCallback(() => cycleHit(-1), [cycleHit])

  return {
    session,
    statusMessage,
    setSnapshot,
    nextHit,
    prevHit,
  }
}
