import { useState, useEffect } from 'react'

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
  const [error, setError] = useState<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)

  useEffect(() => {
    if (!enabled) return

    setLoading(true)
    setError(null)

    fetch(`/api/diff?staged=${options.staged}&untracked=${options.untracked}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [options.staged, options.untracked, enabled, refreshCount])

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return

    const eventSource = new EventSource('/api/live')

    eventSource.addEventListener('change', () => {
      setRefreshCount((c) => c + 1)
    })

    return () => {
      eventSource.close()
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
    error,
  }
}
