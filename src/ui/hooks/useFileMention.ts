import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { FileHit, FilesResponse } from '../lib/searchTypes'

interface MentionState {
  atStart: number
  query: string
}

function findMentionTrigger(text: string, cursorPos: number): MentionState | null {
  const before = text.slice(0, cursorPos)
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = before[i]
    if (ch === '@') {
      if (i === 0 || /\s/.test(before[i - 1])) {
        const query = before.slice(i + 1)
        if (!/\s/.test(query)) {
          return { atStart: i, query }
        }
      }
      return null
    }
    if (ch === '\n') return null
  }
  return null
}

export interface UseFileMentionResult {
  isOpen: boolean
  results: FileHit[]
  focusedIndex: number
  query: string
  isFetching: boolean
  cursorTop: number
  handleKeyDown: (e: React.KeyboardEvent) => boolean
  onSelect: (path: string) => void
  setFocusedIndex: (i: number) => void
  setTextareaRef: (el: HTMLTextAreaElement | null) => void
}

export function useFileMention(
  text: string,
  setText: (text: string) => void,
): UseFileMentionResult {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mention, setMention] = useState<MentionState | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [cursorTop, setCursorTop] = useState(0)
  const lastCursorRef = useRef(0)

  const setTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el
  }, [])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    lastCursorRef.current = cursor
    const m = findMentionTrigger(text, cursor)
    setMention(m)
    if (m) {
      setFocusedIndex(0)
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20
      const textBefore = text.slice(0, cursor)
      const lineNumber = (textBefore.match(/\n/g) || []).length
      const paddingTop = parseFloat(getComputedStyle(ta).paddingTop) || 0
      setCursorTop(paddingTop + (lineNumber + 1) * lineHeight + 4)
    }
  }, [text])

  const query = mention?.query ?? ''

  const result = useQuery<FilesResponse>({
    queryKey: ['file-mention', query],
    enabled: mention !== null,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({ scope: 'files', query }),
      })
      if (!res.ok) throw new Error(`Search failed (${res.status})`)
      return (await res.json()) as FilesResponse
    },
  })

  const items = result.data?.items ?? []
  const isOpen = mention !== null && (items.length > 0 || result.isFetching)

  const commitSelection = useCallback(
    (path: string) => {
      if (!mention) return
      const ta = textareaRef.current
      if (!ta) return
      const before = text.slice(0, mention.atStart)
      const after = text.slice(lastCursorRef.current)
      const inserted = `@${path} `
      const next = before + inserted + after
      setText(next)
      setMention(null)
      requestAnimationFrame(() => {
        const pos = (before + inserted).length
        ta.selectionStart = ta.selectionEnd = pos
        ta.focus()
      })
    },
    [mention, text, setText],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen) return false
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const len = items.length
        if (len > 0) setFocusedIndex((i) => (i + 1) % len)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const len = items.length
        if (len > 0) setFocusedIndex((i) => (i === 0 ? len - 1 : i - 1))
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (items[focusedIndex]) {
          e.preventDefault()
          commitSelection(items[focusedIndex].path)
          return true
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return true
      }
      return false
    },
    [isOpen, items, focusedIndex, commitSelection],
  )

  const onSelect = useCallback(
    (path: string) => commitSelection(path),
    [commitSelection],
  )

  return {
    isOpen,
    results: items,
    focusedIndex,
    query,
    isFetching: result.isFetching,
    cursorTop,
    handleKeyDown,
    onSelect,
    setFocusedIndex,
    setTextareaRef,
  }
}
