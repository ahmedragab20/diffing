import { useState, useEffect, useRef } from 'react'
import { subscribeLive } from '../live'

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

interface DiffData {
  patch: string
  repoName: string
  branch: string
  customMode: boolean
  binaryFiles: BinaryFileInfo[]
  tabSizeMap: Record<string, number>
  untrackedFiles: string[]
}

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

const EMPTY_ARRAY: any[] = []
const EMPTY_OBJECT: Record<string, number> = {}

export function useDiff(options: DiffOptions, enabled = true) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const hasData = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    // Only the very first load shows the full skeleton. Background refreshes
    // (triggered by `change` events while you keep working) update the diff in
    // place so the whole view never blanks out mid-review.
    if (hasData.current) setRefreshing(true)
    else setLoading(true)
    setError(null)

    fetch(`/api/diff?staged=${options.staged}&untracked=${options.untracked}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => {
        if (cancelled) return
        hasData.current = true
        setData(json)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setRefreshing(false)
      })

    return () => {
      cancelled = true
    }
  }, [options.staged, options.untracked, enabled, refreshCount])

  useEffect(() => {
    if (!enabled) return
    // Coalesce bursty change events. Tools like an IDE's git integration touch
    // several `.git` files in quick succession; debouncing avoids a refetch
    // stampede from a single logical change.
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeLive('change', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setRefreshCount((c) => c + 1), 150)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [enabled])

  return {
    patch: data?.patch ?? null,
    repoName: data?.repoName ?? '',
    branch: data?.branch ?? '',
    customMode: data?.customMode ?? false,
    binaryFiles: data?.binaryFiles ?? EMPTY_ARRAY,
    tabSizeMap: data?.tabSizeMap ?? EMPTY_OBJECT,
    untrackedFiles: data?.untrackedFiles ?? EMPTY_ARRAY,
    loading,
    refreshing,
    error,
  }
}
