import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { subscribeLive } from '../live'

const VIEWED_KEY = ['viewed']

async function fetchViewed({ signal }: { signal: AbortSignal }): Promise<string[]> {
  const res = await fetch('/api/viewed', { signal })
  if (!res.ok) throw new Error(`Could not load viewed files (HTTP ${res.status})`)
  const list: unknown = await res.json()
  if (!Array.isArray(list) || !list.every((path) => typeof path === 'string')) {
    throw new Error('Invalid viewed files response')
  }
  return list
}

function parseViewedList(data: string): string[] | null {
  try {
    const parsed = JSON.parse(data)
    if (Array.isArray(parsed) && parsed.every((f) => typeof f === 'string')) {
      return parsed
    }
  } catch {
    // ignore malformed payloads
  }
  return null
}

export function useViewed() {
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [pending, setPending] = useState(new Map<string, { id: number; viewed: boolean }>())
  const sequence = useRef(0)
  const queues = useRef(new Map<string, Promise<boolean>>())
  const { data: viewedList = [], error: queryError } = useQuery({ queryKey: VIEWED_KEY, queryFn: fetchViewed })

  // Cross-tab sync: the server broadcasts `viewed` whenever any client toggles
  // a file. Refetch confirms our optimistic update against the authoritative
  // state so a file marked viewed in another window is reflected here too.
  useEffect(() => {
    return subscribeLive('viewed', (data) => {
      const list = parseViewedList(data)
      if (list) {
        void queryClient.cancelQueries({ queryKey: VIEWED_KEY }, { revert: false })
        queryClient.setQueryData<string[]>(VIEWED_KEY, list)
      } else {
        queryClient.invalidateQueries({ queryKey: VIEWED_KEY })
      }
    })
  }, [queryClient])

  // Keep optimistic intents separate from confirmed data. An earlier failure
  // cannot roll back another file, a newer intent, or a live server update.
  const viewedFiles = useMemo(() => {
    const files = new Set(viewedList)
    for (const [path, intent] of pending) {
      if (intent.viewed) files.add(path)
      else files.delete(path)
    }
    return files
  }, [viewedList, pending])

  const setViewed = useCallback((filePath: string, viewed: boolean): Promise<boolean> => {
    const id = ++sequence.current
    setMutationError(null)
    setPending((prev) => new Map(prev).set(filePath, { id, viewed }))
    // Serialize only changes to the same file so rapid toggles arrive in order.
    const previous = queues.current.get(filePath) ?? Promise.resolve(true)
    const request = previous.then(async () => {
      try {
        await queryClient.cancelQueries({ queryKey: VIEWED_KEY }, { revert: false })
        const res = await fetch('/api/viewed', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, viewed }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await queryClient.cancelQueries({ queryKey: VIEWED_KEY }, { revert: false })
        queryClient.setQueryData<string[]>(VIEWED_KEY, (prev = []) =>
          viewed ? (prev.includes(filePath) ? prev : [...prev, filePath]) : prev.filter((path) => path !== filePath),
        )
        return true
      } catch (error) {
        setMutationError(`Could not save viewed state for ${filePath}: ${error instanceof Error ? error.message : 'Request failed'}`)
        return false
      } finally {
        setPending((prev) => {
          if (prev.get(filePath)?.id !== id) return prev
          const next = new Map(prev)
          next.delete(filePath)
          return next
        })
        if (queues.current.get(filePath) === request) queues.current.delete(filePath)
      }
    })
    queues.current.set(filePath, request)
    return request
  }, [queryClient])

  return { viewedFiles, setViewed, error: mutationError ?? queryError?.message ?? null }
}
