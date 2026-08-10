import { useCallback, useMemo, useState } from 'react'
import { scrollToLine } from '../utils'
import type { DiffLineEntry } from './useDiffSearch'

/**
 * File-scoped search ("find in file") over the searchable lines of a single
 * diff file — changed lines plus unchanged context lines. The current global
 * search palette (⌘K) searches the whole repo or the whole diff; this session
 * scopes hits to one file so the user can review a specific file's changes
 * line by line.
 *
 * Hits come from `buildFileSearchCorpus` entries (additions + deletions +
 * context), so every hit maps to a rendered diff line and navigation reuses
 * the same `scrollToLine` flash used by palette jumps.
 */
export interface FileSearchSession {
  /** The file currently being searched, or null when the bar is closed. */
  filePath: string | null
  query: string
  hits: DiffLineEntry[]
  /** Index into `hits` of the current match (0 when the query has no hits). */
  index: number
  open: (filePath: string) => void
  close: () => void
  setQuery: (query: string) => void
  next: () => void
  prev: () => void
}

export function useFileSearch(diffEntries: DiffLineEntry[]) {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const hits = useMemo(() => {
    if (!filePath) return []
    const q = query.trim().toLowerCase()
    if (!q) return []
    return diffEntries.filter(
      (entry) => entry.filePath === filePath && entry.content.toLowerCase().includes(q),
    )
  }, [diffEntries, filePath, query])

  // Keep the cursor valid as the query narrows (hits shrink mid-cycle).
  const clampedIndex = hits.length === 0 ? 0 : Math.min(index, hits.length - 1)

  const jumpTo = useCallback(
    (i: number) => {
      const hit = hits[i]
      if (!hit) return
      scrollToLine(hit.filePath, hit.lineNumber, hit.side, query.trim())
    },
    [hits, query],
  )

  const cycle = useCallback(
    (delta: number) => {
      if (hits.length === 0) return
      const next = (clampedIndex + delta + hits.length) % hits.length
      setIndex(next)
      jumpTo(next)
    },
    [hits.length, clampedIndex, jumpTo],
  )

  const next = useCallback(() => cycle(1), [cycle])
  const prev = useCallback(() => cycle(-1), [cycle])

  const open = useCallback((path: string) => {
    setFilePath(path)
    setQuery('')
    setIndex(0)
  }, [])

  const close = useCallback(() => {
    setFilePath(null)
    setQuery('')
    setIndex(0)
  }, [])

  const changeQuery = useCallback((q: string) => {
    setQuery(q)
    setIndex(0)
  }, [])

  return {
    filePath,
    query,
    hits,
    index: clampedIndex,
    open,
    close,
    setQuery: changeQuery,
    next,
    prev,
  }
}
