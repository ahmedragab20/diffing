import { useEffect, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { Scope, SearchResponse } from '../lib/searchTypes'

/** Debounce a fast-changing value (the search box) before it drives queries. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

export interface UseSearchArgs {
  scope: Scope
  query: string
  /** Regex mode — only honoured for the `text` scope. */
  regex: boolean
  /** Restrict results to the current diff's files. */
  changedOnly: boolean
  /** The current diff's file paths (sent to the server when `changedOnly`). */
  changedPaths: string[]
  /** Don't query while the palette is closed. */
  open: boolean
}

/** Minimum query length per scope before we hit the server. Files allows the
 *  empty query (a frecency-ranked browse list); symbols need ≥2 chars so a
 *  single common letter doesn't dump the repo. */
function minLength(scope: Scope): number {
  if (scope === 'symbols') return 2
  if (scope === 'text') return 1
  return 0
}

export function useSearch({ scope, query, regex, changedOnly, changedPaths, open }: UseSearchArgs) {
  const debounced = useDebouncedValue(query, 130)
  const trimmed = debounced.trim()
  const enabled = open && trimmed.length >= minLength(scope)

  const result = useQuery<SearchResponse>({
    queryKey: ['search', scope, trimmed, scope === 'text' ? regex : false, changedOnly, changedOnly ? changedPaths : null],
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    queryFn: async ({ signal }): Promise<SearchResponse> => {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          scope,
          query: trimmed,
          regex: scope === 'text' ? regex : false,
          changedPaths: changedOnly ? changedPaths : undefined,
        }),
      })
      if (!res.ok) throw new Error(`Search request failed (${res.status})`)
      return (await res.json()) as SearchResponse
    },
  })

  return {
    ...result,
    /** True once a query has run for the current (debounced) input. */
    enabled,
    /** Whether the debounced query still has characters pending. */
    pending: query.trim() !== trimmed,
    minLength: minLength(scope),
  }
}

/** Best-effort: tell the server a result was opened, improving fff frecency. */
export function trackSelection(query: string, path: string): void {
  fetch('/api/search/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, path }),
  }).catch(() => {})
}
