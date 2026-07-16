import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { subscribeLive } from '../live'

const VIEWED_KEY = ['viewed']

async function fetchViewed(): Promise<string[]> {
  const res = await fetch('/api/viewed')
  return res.json()
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
  const { data: viewedList = [] } = useQuery({ queryKey: VIEWED_KEY, queryFn: fetchViewed })

  // Cross-tab sync: the server broadcasts `viewed` whenever any client toggles
  // a file. Refetch confirms our optimistic update against the authoritative
  // state so a file marked viewed in another window is reflected here too.
  useEffect(() => {
    return subscribeLive('viewed', (data) => {
      const list = parseViewedList(data)
      if (list) {
        queryClient.setQueryData<string[]>(VIEWED_KEY, list)
      } else {
        queryClient.invalidateQueries({ queryKey: VIEWED_KEY })
      }
    })
  }, [queryClient])

  const viewedFiles = useMemo(() => new Set(viewedList), [viewedList])

  const setViewed = useCallback(async (filePath: string, viewed: boolean) => {
    // Optimistic update
    queryClient.setQueryData<string[]>(VIEWED_KEY, (prev = []) => {
      if (viewed) {
        return prev.includes(filePath) ? prev : [...prev, filePath]
      }
      return prev.filter((f) => f !== filePath)
    })

    await fetch('/api/viewed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, viewed }),
    })
  }, [queryClient])

  return { viewedFiles, setViewed }
}
