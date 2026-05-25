import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import type { DiffLineEntry } from '../hooks/useDiffSearch'
import { scrollToLine } from '../utils'

interface DiffSearchModalProps {
  entries: DiffLineEntry[]
  isOpen: boolean
  onClose: () => void
}

function fuzzyMatch(text: string, query: string): { score: number; matches: number[] } | null {
  const textLower = text.toLowerCase()
  const queryLower = query.toLowerCase()
  let qi = 0
  let score = 0
  let prevPos = -1
  const matches: number[] = []

  for (let ti = 0; ti < textLower.length && qi < queryLower.length; ti++) {
    if (textLower[ti] === queryLower[qi]) {
      matches.push(ti)
      if (prevPos >= 0) {
        const gap = ti - prevPos
        if (gap === 1) {
          score += 15
        } else {
          score += Math.max(0, 10 - gap)
        }
      } else {
        score += 10
        const ch = text[ti - 1]
        if (ti === 0 || !ch || ch === ' ' || ch === '_' || ch === '-' || ch === '.' || ch === '/') {
          score += 10
        }
      }
      prevPos = ti
      qi++
    } else {
      if (prevPos >= 0 && ti - prevPos > 20) {
        return null
      }
    }
  }

  if (qi < queryLower.length) return null

  score -= text.length * 0.02
  score += matches[0] * -0.05

  return { score, matches }
}

interface ScoredEntry {
  entry: DiffLineEntry
  score: number
}


function deduplicate(entries: DiffLineEntry[]): DiffLineEntry[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    const key = `${e.filePath}:${e.side}:${e.lineNumber}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function DiffSearchModal({ entries, isOpen, onClose }: DiffSearchModalProps) {
  const [query, setQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const uniqueEntries = useMemo(() => deduplicate(entries), [entries])

  const results = useMemo<ScoredEntry[]>(() => {
    if (!query.trim()) return []

    const q = query.trim()
    const scored: ScoredEntry[] = []

    for (const entry of uniqueEntries) {
      const searchText = `${entry.filePath} ${entry.content.trim()}`
      const result = fuzzyMatch(searchText, q)
      if (result) {
        scored.push({ entry, score: result.score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 100)
  }, [uniqueEntries, query])

  useEffect(() => {
    setFocusedIndex(0)
  }, [query])

  useEffect(() => {
    setQuery('')
  }, [isOpen])

  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus()
    }
  }, [isOpen])

  const selectEntry = useCallback(
    (entry: DiffLineEntry) => {
      scrollToLine(entry.filePath, entry.lineNumber, entry.side, query)
      onClose()
    },
    [onClose, query],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          e.preventDefault()
          setFocusedIndex((i) => (i + 1) % results.length)
          break
        case 'ArrowUp':
        case 'k':
          e.preventDefault()
          setFocusedIndex((i) => (i - 1 + results.length) % results.length)
          break
        case 'Enter':
          e.preventDefault()
          if (results[focusedIndex]) {
            selectEntry(results[focusedIndex].entry)
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [results, focusedIndex, onClose, selectEntry],
  )

  useEffect(() => {
    if (!isOpen) return
    const focused = listRef.current?.children[focusedIndex] as HTMLElement | undefined
    focused?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, isOpen])

  if (!isOpen) return null

  return (
    <div className="diffsearch-overlay" onClick={onClose}>
      <div className="diffsearch-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="diffsearch-header">
          <div className="diffsearch-search">
            <Search size={14} className="diffsearch-search-icon" />
            <input
              ref={searchRef}
              type="text"
              className="diffsearch-search-input"
              placeholder="Search diffs..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="diffsearch-search-clear" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>
          <span className="diffsearch-count">
            {query.trim() ? `${results.length} matches` : 'Type to search'}
          </span>
        </div>
        <div className="diffsearch-list" ref={listRef}>
          {query.trim() && results.length === 0 ? (
            <div className="diffsearch-empty">No matches found</div>
          ) : (
            results.map((r, i) => {
              const { entry } = r
              const dir = entry.filePath.split('/').slice(0, -1).join('/')
              const fileName = entry.filePath.split('/').pop()
              const sideLabel = entry.side === 'additions' ? '+' : '-'
              return (
                <div
                  key={`${entry.filePath}:${entry.side}:${entry.lineNumber}`}
                  className={`diffsearch-item ${i === focusedIndex ? 'diffsearch-item-focused' : ''}`}
                  onClick={() => selectEntry(entry)}
                  onMouseEnter={() => setFocusedIndex(i)}
                >
                  <span className={`diffsearch-side diffsearch-side-${entry.side}`}>
                    {sideLabel}
                  </span>
                  <div className="diffsearch-info">
                    <span className="diffsearch-location">
                      {dir ? `${dir}/` : ''}
                      <strong>{fileName}</strong>
                      <span className="diffsearch-line">:{entry.lineNumber}</span>
                    </span>
                    <span className="diffsearch-content">{entry.content.trim().slice(0, 120)}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
