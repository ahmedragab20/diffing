import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, X, FileText, Type, Code2 } from 'lucide-react'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { DiffLineEntry } from '../hooks/useDiffSearch'
import type { SymbolEntry } from '../hooks/useSymbols'
import { scrollToLine, fileName } from '../utils'
import { Modal } from '../primitives/Modal'

type Scope = 'all' | 'files' | 'text' | 'symbols'

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'files', label: 'Files' },
  { key: 'text', label: 'Text' },
  { key: 'symbols', label: 'Symbols' },
]

interface DiffSearchModalProps {
  files: FileDiffMetadata[]
  entries: DiffLineEntry[]
  symbols: SymbolEntry[]
  isOpen: boolean
  onClose: () => void
}

interface Result {
  kind: 'file' | 'text' | 'symbol'
  id: string
  /** Text the query is matched against. */
  haystack: string
  primary: string
  secondary: string
  filePath: string
  lineNumber?: number
  side?: 'additions' | 'deletions'
  badge: string
  score: number
}

function fuzzyMatch(text: string, query: string): number | null {
  const textLower = text.toLowerCase()
  const queryLower = query.toLowerCase()
  let qi = 0
  let score = 0
  let prevPos = -1

  for (let ti = 0; ti < textLower.length && qi < queryLower.length; ti++) {
    if (textLower[ti] === queryLower[qi]) {
      if (prevPos >= 0) {
        const gap = ti - prevPos
        score += gap === 1 ? 15 : Math.max(0, 10 - gap)
      } else {
        score += 10
        const ch = text[ti - 1]
        if (ti === 0 || !ch || ch === ' ' || ch === '_' || ch === '-' || ch === '.' || ch === '/') {
          score += 10
        }
        score += ti * -0.05
      }
      prevPos = ti
      qi++
    } else if (prevPos >= 0 && ti - prevPos > 24) {
      return null
    }
  }

  if (qi < queryLower.length) return null
  return score - text.length * 0.02
}

function buildCandidates(
  scope: Scope,
  files: FileDiffMetadata[],
  entries: DiffLineEntry[],
  symbols: SymbolEntry[],
): Result[] {
  const out: Result[] = []

  if (scope === 'all' || scope === 'files') {
    for (const f of files) {
      out.push({
        kind: 'file',
        id: `f:${f.name}`,
        haystack: f.name,
        primary: fileName(f.name),
        secondary: f.name.split('/').slice(0, -1).join('/'),
        filePath: f.name,
        badge: f.type === 'new' ? 'new' : f.type === 'deleted' ? 'del' : 'mod',
        score: 0,
      })
    }
  }

  if (scope === 'all' || scope === 'symbols') {
    for (const s of symbols) {
      out.push({
        kind: 'symbol',
        id: `s:${s.filePath}:${s.side}:${s.lineNumber}:${s.name}`,
        haystack: `${s.name} ${s.filePath}`,
        primary: s.name,
        secondary: `${fileName(s.filePath)}:${s.lineNumber}`,
        filePath: s.filePath,
        lineNumber: s.lineNumber,
        side: s.side,
        badge: s.kind,
        score: 0,
      })
    }
  }

  if (scope === 'all' || scope === 'text') {
    const seen = new Set<string>()
    for (const e of entries) {
      const key = `${e.filePath}:${e.side}:${e.lineNumber}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        kind: 'text',
        id: `t:${key}`,
        haystack: `${e.content} ${e.filePath}`,
        primary: e.content.trim().slice(0, 120),
        secondary: `${fileName(e.filePath)}:${e.lineNumber}`,
        filePath: e.filePath,
        lineNumber: e.lineNumber,
        side: e.side,
        badge: e.side === 'additions' ? '+' : '−',
        score: 0,
      })
    }
  }

  return out
}

const KIND_ICON = {
  file: FileText,
  text: Type,
  symbol: Code2,
} as const

export function DiffSearchModal({ files, entries, symbols, isOpen, onClose }: DiffSearchModalProps) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const candidates = useMemo(
    () => buildCandidates(scope, files, entries, symbols),
    [scope, files, entries, symbols],
  )

  const results = useMemo<Result[]>(() => {
    const q = query.trim()
    if (!q) {
      // With no query, the line-level text scope is too noisy to dump wholesale;
      // files and symbols are a useful at-a-glance index.
      const browseable = candidates.filter((c) => c.kind !== 'text')
      return browseable.slice(0, 200)
    }
    const scored: Result[] = []
    for (const c of candidates) {
      const score = fuzzyMatch(c.haystack, q)
      if (score !== null) scored.push({ ...c, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 100)
  }, [candidates, query])

  useEffect(() => setFocusedIndex(0), [query, scope])
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setScope('all')
    }
  }, [isOpen])
  useEffect(() => {
    if (isOpen) searchRef.current?.focus()
  }, [isOpen])

  const select = useCallback(
    (r: Result) => {
      if (r.lineNumber && r.side) {
        scrollToLine(r.filePath, r.lineNumber, r.side, query.trim() || undefined)
      } else {
        document.getElementById(`file-${r.filePath}`)?.scrollIntoView({ block: 'start' })
      }
      onClose()
    },
    [onClose, query],
  )

  const cycleScope = useCallback((dir: 1 | -1) => {
    setScope((cur) => {
      const i = SCOPES.findIndex((s) => s.key === cur)
      return SCOPES[(i + dir + SCOPES.length) % SCOPES.length].key
    })
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Tab cycles scope — vim-ish "switch register"
      if (e.key === 'Tab') {
        e.preventDefault()
        cycleScope(e.shiftKey ? -1 : 1)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (results.length === 0) return

      const move = (delta: number) =>
        setFocusedIndex((i) => (i + delta + results.length) % results.length)

      // Ctrl-n/p and Ctrl-j/k navigate even while typing; bare j/k/arrows too.
      if (e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'n' || e.key === 'j'))) {
        e.preventDefault()
        move(1)
      } else if (e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'p' || e.key === 'k'))) {
        e.preventDefault()
        move(-1)
      } else if (e.ctrlKey && e.key === 'd') {
        e.preventDefault()
        move(8)
      } else if (e.ctrlKey && e.key === 'u') {
        e.preventDefault()
        move(-8)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (results[focusedIndex]) select(results[focusedIndex])
      }
    },
    [results, focusedIndex, onClose, select, cycleScope],
  )

  useEffect(() => {
    if (!isOpen) return
    const el = listRef.current?.children[focusedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, isOpen])

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      className="diffsearch-modal ui-modal--palette"
      ariaLabel="Search files, text and symbols"
      initialFocus={searchRef}
      onKeyDown={handleKeyDown}
    >
      <div className="diffsearch-header">
        <div className="diffsearch-search">
          <Search size={14} className="diffsearch-search-icon" />
          <input
            ref={searchRef}
            type="text"
            className="diffsearch-search-input"
            placeholder="Search files, text & symbols…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="diffsearch-search-clear" onClick={() => setQuery('')} aria-label="Clear">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="diffsearch-scopes" role="tablist" aria-label="Search scope">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={scope === s.key}
              className={`diffsearch-scope ${scope === s.key ? 'diffsearch-scope-active' : ''}`}
              onClick={() => setScope(s.key)}
            >
              {s.label}
            </button>
          ))}
          <span className="diffsearch-count">{results.length}</span>
        </div>
      </div>
      <div className="diffsearch-list" ref={listRef}>
        {results.length === 0 ? (
          <div className="diffsearch-empty">
            {query.trim() ? 'No matches found' : 'Type to search'}
          </div>
        ) : (
          results.map((r, i) => {
            const Icon = KIND_ICON[r.kind]
            return (
              <div
                key={r.id}
                className={`diffsearch-item ${i === focusedIndex ? 'diffsearch-item-focused' : ''}`}
                onClick={() => select(r)}
                onMouseEnter={() => setFocusedIndex(i)}
              >
                <span className={`diffsearch-kind diffsearch-kind-${r.kind}`} title={r.kind}>
                  <Icon size={13} />
                </span>
                <div className="diffsearch-info">
                  <span className="diffsearch-primary">{r.primary || '(blank)'}</span>
                  {r.secondary && <span className="diffsearch-secondary">{r.secondary}</span>}
                </div>
                <span className={`diffsearch-badge diffsearch-badge-${r.kind}`}>{r.badge}</span>
              </div>
            )
          })
        )}
      </div>
      <div className="diffsearch-foot">
        <span><kbd>Tab</kbd> scope</span>
        <span><kbd>↑↓</kbd>/<kbd>^j</kbd><kbd>^k</kbd> move</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </Modal>
  )
}
