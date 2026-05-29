import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, X, FileText, Type, Code2, Loader2, GitCompare, CornerDownLeft, Layers } from 'lucide-react'
import type { FileDiffMetadata } from '@pierre/diffs'
import { File as DiffsFile } from '@pierre/diffs/react'
import type { DiffLineEntry } from '../hooks/useDiffSearch'
import { useSearch, trackSelection } from '../hooks/useSearch'
import { useFilePreview } from '../hooks/useFilePreview'
import { useQuery } from '@tanstack/react-query'
import {
  buildDiffFileSet,
  buildChangedLineKeys,
  classifyNavigation,
  highlightRanges,
  fallbackFuzzyScore,
  extractSymbolsFromDiff,
} from '../lib/diffIndex'
import type { Scope, FileHit, ContentHit, SymbolHit, MatchRange } from '../lib/searchTypes'
import { scrollToLine, fileName, SHIKI_THEME_MAP, highlightLineInElement } from '../utils'
import { Modal } from '../primitives/Modal'

interface SearchPaletteProps {
  isOpen: boolean
  onClose: () => void
  initialScope: Scope
  files: FileDiffMetadata[]
  changedEntries: DiffLineEntry[]
  customMode: boolean
  staged: boolean
  /** Jump the main diff view to a file card (sets active file + scrolls). */
  onNavigateFile: (path: string) => void
  // Preview-pane render settings (mirror the main diff view).
  theme: string
  fontSize: number
  defaultTabSize: number
  lineWrap: boolean
  showLineNumbers: boolean
  lineHoverHighlight: string
}

const SCOPES: { key: Scope; label: string; Icon: typeof FileText }[] = [
  { key: 'all', label: 'All', Icon: Layers },
  { key: 'files', label: 'Files', Icon: FileText },
  { key: 'text', label: 'Text', Icon: Type },
  { key: 'symbols', label: 'Symbols', Icon: Code2 },
]

const KIND_GLYPH: Record<string, string> = {
  function: 'ƒ',
  method: 'm',
  class: 'C',
  variable: 'v',
  interface: 'I',
  type: 'T',
  enum: 'E',
  struct: 'S',
  impl: 'i',
  trait: 't',
}

function gitChip(status: string): { label: string; title: string } | null {
  switch (status) {
    case 'modified':
      return { label: 'M', title: 'modified' }
    case 'untracked':
      return { label: 'U', title: 'untracked' }
    case 'staged_new':
    case 'added':
      return { label: 'A', title: 'added' }
    case 'deleted':
      return { label: 'D', title: 'deleted' }
    case 'renamed':
      return { label: 'R', title: 'renamed' }
    case '':
    case 'clean':
      return null
    default:
      return { label: status.charAt(0).toUpperCase(), title: status }
  }
}

interface PreviewState {
  path: string
  line?: number
  match?: string
}

/** Render `text` with the given (char) ranges wrapped in <mark>. */
function Highlight({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  if (!ranges.length) return <>{text}</>
  const out: React.ReactNode[] = []
  let last = 0
  ranges.forEach(([s, e], i) => {
    if (s > last) out.push(text.slice(last, s))
    out.push(
      <mark key={i} className="searchpalette-mark">
        {text.slice(s, e)}
      </mark>,
    )
    last = e
  })
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

/** Greedy subsequence char-ranges of `query` within `text` (for fuzzy file names). */
function subsequenceRanges(text: string, query: string): MatchRange[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const t = text.toLowerCase()
  const ranges: MatchRange[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const last = ranges[ranges.length - 1]
      if (last && last[1] === ti) last[1] = ti + 1
      else ranges.push([ti, ti + 1])
      qi++
    }
  }
  return qi === q.length ? ranges : []
}

const dir = (path: string) => {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i + 1)
}

/** For very long lines, slice a window centred on the first match. */
function windowContent(content: string, ranges: MatchRange[]): { text: string; ranges: MatchRange[] } {
  const trimmedStart = content.length - content.trimStart().length
  let text = content.slice(trimmedStart)
  let shift = trimmedStart
  const MAX = 400
  if (text.length > MAX) {
    const first = ranges.find((r) => r[0] >= trimmedStart)
    const start = first ? Math.max(0, first[0] - trimmedStart - 24) : 0
    const prefix = start > 0 ? '…' : ''
    text = prefix + text.slice(start, start + MAX)
    shift = trimmedStart + start - prefix.length
  }
  const adjusted = ranges
    .map(([s, e]) => [s - shift, e - shift] as MatchRange)
    .filter(([s, e]) => e > 0 && s < text.length)
    .map(([s, e]) => [Math.max(0, s), Math.min(text.length, e)] as MatchRange)
  return { text, ranges: adjusted }
}

export function SearchPalette({
  isOpen,
  onClose,
  initialScope,
  files,
  changedEntries,
  customMode,
  staged,
  onNavigateFile,
  theme,
  fontSize,
  defaultTabSize,
  lineWrap,
  showLineNumbers,
  lineHoverHighlight,
}: SearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>(initialScope)
  const [regex, setRegex] = useState(false)
  const [changedOnly, setChangedOnly] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [preview, setPreview] = useState<PreviewState | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const diffFileSet = useMemo(() => buildDiffFileSet(files), [files])
  const changedKeys = useMemo(() => buildChangedLineKeys(changedEntries), [changedEntries])
  const changedPaths = useMemo(() => [...diffFileSet], [diffFileSet])

  const search = useSearch({ scope, query, regex, changedOnly, changedPaths, open: isOpen })
  // Guard against keepPreviousData briefly showing the previous scope's shape.
  const data = search.data && search.data.scope === scope ? search.data : undefined
  const engineError = data?.error

  // Degraded fallback: if the native engine is unavailable, the Files scope
  // still works against the plain `git ls-files` endpoint.
  const repoFilesFallback = useQuery<string[]>({
    queryKey: ['repo-files-fallback'],
    enabled: isOpen && scope === 'files' && !!engineError,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch('/api/repo-files')
      const json = (await res.json()) as { files?: string[] }
      return json.files ?? []
    },
  })

  // ── Reset on open ────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setScope(initialScope)
      setRegex(false)
      setChangedOnly(false)
      setFocusedIndex(0)
      setPreview(null)
    }
  }, [isOpen, initialScope])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  // Editing the query or switching scope dismisses the preview and resets focus.
  useEffect(() => {
    setFocusedIndex(0)
    setPreview(null)
  }, [query, scope])

  // ── Build the rendered rows (diff-first, capped) ─────────────────
  const rows = useMemo(() => {
    const trimmed = query.trim()
    const q = trimmed.toLowerCase()

    type Row =
      | { kind: 'file'; key: string; hit: FileHit; inDiff: boolean }
      | { kind: 'text'; key: string; hit: ContentHit; inDiff: boolean }
      | { kind: 'symbol'; key: string; hit: SymbolHit; inDiff: boolean }

    let built: Row[] = []

    if (scope === 'files' && engineError && repoFilesFallback.data) {
      // Degraded local filter over the full repo file list.
      const scored = repoFilesFallback.data
        .map((path) => ({ path, score: q ? fallbackFuzzyScore(path, q) : 0 }))
        .filter((x) => x.score !== null)
        .sort((a, b) => (b.score as number) - (a.score as number))
        .slice(0, 60)
      built = scored.map(({ path }) => ({
        kind: 'file' as const,
        key: path,
        hit: { path, fileName: fileName(path), gitStatus: '', matchType: '', exact: false },
        inDiff: diffFileSet.has(path),
      }))
    } else if (data) {
      if (data.scope === 'files') {
        built = data.items.map((hit) => ({ kind: 'file' as const, key: hit.path, hit, inDiff: diffFileSet.has(hit.path) }))
      } else if (data.scope === 'text') {
        built = data.items.map((hit) => ({
          kind: 'text' as const,
          key: `${hit.path}:${hit.line}:${hit.col}`,
          hit,
          inDiff: diffFileSet.has(hit.path),
        }))
      } else if (data.scope === 'symbols') {
        built = data.items.map((hit) => ({
          kind: 'symbol' as const,
          key: `${hit.path}:${hit.line}:${hit.name}`,
          hit,
          inDiff: diffFileSet.has(hit.path),
        }))
      } else if (data.scope === 'all') {
        built = data.items.map((item) => {
          if (item.kind === 'file') {
            return {
              kind: 'file' as const,
              key: `all:${item.hit.path}`,
              hit: item.hit,
              inDiff: diffFileSet.has(item.hit.path),
            }
          } else if (item.kind === 'text') {
            return {
              kind: 'text' as const,
              key: `all:${item.hit.path}:${item.hit.line}:${item.hit.col}`,
              hit: item.hit,
              inDiff: diffFileSet.has(item.hit.path),
            }
          } else {
            return {
              kind: 'symbol' as const,
              key: `all:${item.hit.path}:${item.hit.line}:${item.hit.name}`,
              hit: item.hit,
              inDiff: diffFileSet.has(item.hit.path),
            }
          }
        })
      }
    } else if (scope === 'symbols' && trimmed.length < 2) {
      const diffSymbols = extractSymbolsFromDiff(changedEntries)
      const filtered = q
        ? diffSymbols.filter((s) => s.name.toLowerCase().includes(q))
        : diffSymbols
      built = filtered.map((hit) => ({
        kind: 'symbol' as const,
        key: `local:${hit.path}:${hit.line}:${hit.name}`,
        hit,
        inDiff: true,
      }))
    }

    // Diff-first: stable partition (in-diff rows keep fff order, then the rest).
    const inDiff = built.filter((r) => r.inDiff)
    const rest = built.filter((r) => !r.inDiff)
    return [...inDiff, ...rest]
  }, [data, engineError, repoFilesFallback.data, scope, diffFileSet, query, changedEntries])

  useEffect(() => {
    if (focusedIndex >= rows.length) setFocusedIndex(0)
  }, [rows.length, focusedIndex])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-focused="true"]') as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, rows])

  // ── Navigation ───────────────────────────────────────────────────
  const navContext = useMemo(
    () => ({ diffFileSet, changedKeys, customMode, staged }),
    [diffFileSet, changedKeys, customMode, staged],
  )

  const activate = useCallback(
    (rowIndex: number, peek: boolean) => {
      const row = rows[rowIndex]
      if (!row) return
      const path = row.hit.path
      const q = query.trim()
      trackSelection(q, path)

      if (row.kind === 'file') {
        if (peek) {
          setPreview({ path })
          return
        }
        const action = classifyNavigation({ kind: 'file', path }, navContext)
        if (action.type === 'scrollFile') {
          onClose()
          requestAnimationFrame(() => onNavigateFile(path))
        } else {
          setPreview({ path })
        }
        return
      }

      // text / symbol
      const line = row.hit.line
      const match = row.kind === 'symbol' ? (row.hit as SymbolHit).name : q
      if (peek) {
        setPreview({ path, line, match })
        return
      }
      const action = classifyNavigation({ kind: 'line', path, line, match }, navContext)
      if (action.type === 'scrollLine') {
        onClose()
        requestAnimationFrame(() => scrollToLine(path, action.line, action.side, action.match))
      } else {
        setPreview({ path, line, match })
      }
    },
    [rows, query, navContext, onClose, onNavigateFile],
  )

  // ── Keyboard model ───────────────────────────────────────────────
  const cycleScope = useCallback((delta: number) => {
    setScope((cur) => {
      const i = SCOPES.findIndex((s) => s.key === cur)
      return SCOPES[(i + delta + SCOPES.length) % SCOPES.length].key
    })
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // ── Scroll preview section from the keyboard ──────────────────
      if (e.key === 'PageDown') {
        e.preventDefault()
        const el = document.querySelector('.searchpalette-preview-body')
        el?.scrollBy({ top: 150, behavior: 'auto' })
        return
      }
      if (e.key === 'PageUp') {
        e.preventDefault()
        const el = document.querySelector('.searchpalette-preview-body')
        el?.scrollBy({ top: -150, behavior: 'auto' })
        return
      }
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'j')) {
        e.preventDefault()
        const el = document.querySelector('.searchpalette-preview-body')
        el?.scrollBy({ top: 80, behavior: 'auto' })
        return
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'k')) {
        e.preventDefault()
        const el = document.querySelector('.searchpalette-preview-body')
        el?.scrollBy({ top: -80, behavior: 'auto' })
        return
      }
      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'j')) {
        e.preventDefault()
        const el = document.querySelector('.searchpalette-preview-body')
        el?.scrollBy({ top: 80, behavior: 'auto' })
        return
      }
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'k')) {
        e.preventDefault()
        const el = document.querySelector('.searchpalette-preview-body')
        el?.scrollBy({ top: -80, behavior: 'auto' })
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        cycleScope(e.shiftKey ? -1 : 1)
        return
      }

      const move = (delta: number) => {
        if (rows.length === 0) return
        setFocusedIndex((i) => (i + delta + rows.length) % rows.length)
      }

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
        activate(focusedIndex, e.metaKey || e.ctrlKey)
      }
      // Escape is handled by Base UI -> onOpenChange -> handleDismiss (two-stage).
    },
    [cycleScope, rows.length, activate, focusedIndex],
  )

  // Two-stage dismiss: a preview closes back to the list; otherwise the palette
  // closes. Routed through the Modal's onClose so both Esc and backdrop honour it.
  const handleDismiss = useCallback(() => {
    if (preview) setPreview(null)
    else onClose()
  }, [preview, onClose])

  const count = data?.total ?? rows.length
  const showSpinner = (search.isFetching || search.pending) && search.enabled
  const indexing = data?.indexing

  return (
    <Modal
      open={isOpen}
      onClose={handleDismiss}
      className={`searchpalette ui-modal--palette ${preview ? 'searchpalette--split' : ''}`}
      ariaLabel="Search files, text and symbols"
      initialFocus={inputRef}
      onKeyDown={handleKeyDown}
    >
      <div className="searchpalette-header">
        <div className="searchpalette-input-row">
          <Search size={15} className="searchpalette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="searchpalette-input"
            placeholder={
              scope === 'all'
                ? 'Search files, text and symbols…'
                : scope === 'files'
                  ? 'Search files in the repo…'
                  : scope === 'text'
                    ? regex
                      ? 'Search by regular expression…'
                      : 'Search file contents…'
                    : 'Search symbol definitions…'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="searchpalette-list"
            aria-activedescendant={rows[focusedIndex] ? `sp-row-${focusedIndex}` : undefined}
            spellCheck={false}
            autoComplete="off"
          />
          {showSpinner && <Loader2 size={14} className="searchpalette-spinner spin" />}
          {query && (
            <button className="searchpalette-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
          <span className="searchpalette-count">
            {indexing ? 'indexing…' : data ? `${rows.length} of ${count}` : ''}
          </span>
        </div>

        <div className="searchpalette-controls">
          <div className="searchpalette-scopes" role="tablist" aria-label="Search scope">
            {SCOPES.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={scope === s.key}
                className={`searchpalette-scope ${scope === s.key ? 'is-active' : ''}`}
                onClick={() => setScope(s.key)}
              >
                <s.Icon size={12} />
                {s.label}
              </button>
            ))}
          </div>
          <div className="searchpalette-toggles">
            {scope === 'text' && (
              <button
                className={`searchpalette-toggle ${regex ? 'is-active' : ''}`}
                onClick={() => setRegex((v) => !v)}
                title="Regular expression"
                aria-pressed={regex}
              >
                .*
              </button>
            )}
            <button
              className={`searchpalette-toggle ${changedOnly ? 'is-active' : ''}`}
              onClick={() => setChangedOnly((v) => !v)}
              title="Limit to files in the current diff"
              aria-pressed={changedOnly}
            >
              <GitCompare size={12} />
              Changed
            </button>
          </div>
        </div>
        {data?.regexError && <div className="searchpalette-note">Invalid regex — showing literal matches</div>}
      </div>

      <div className="searchpalette-body">
        <div className="searchpalette-list" id="searchpalette-list" role="listbox" ref={listRef}>
          <ResultList
            rows={rows}
            scope={scope}
            query={query}
            focusedIndex={focusedIndex}
            engineError={engineError}
            isFetching={search.isFetching}
            enabled={search.enabled}
            minLength={search.minLength}
            regex={regex}
            changedOnly={changedOnly}
            onHover={setFocusedIndex}
            onActivate={(i, e) => activate(i, e ? (e.metaKey || e.ctrlKey) : false)}
            onRetry={() => search.refetch()}
          />
        </div>

        {preview && (
          <PreviewPane
            key={preview.path}
            preview={preview}
            theme={theme}
            fontSize={fontSize}
            defaultTabSize={defaultTabSize}
            lineWrap={lineWrap}
            showLineNumbers={showLineNumbers}
            lineHoverHighlight={lineHoverHighlight}
            onClose={() => setPreview(null)}
            inDiff={diffFileSet.has(preview.path)}
            onGoToDiff={() => {
              onClose()
              if (preview.line) {
                requestAnimationFrame(() => scrollToLine(preview.path, preview.line!, 'additions', preview.match))
              } else {
                requestAnimationFrame(() => onNavigateFile(preview.path))
              }
            }}
          />
        )}
      </div>

      <div className="searchpalette-foot">
        <span>
          <kbd>Tab</kbd> scope
        </span>
        <span>
          <kbd>↑↓</kbd> move
        </span>
        <span>
          <kbd>↵</kbd> {preview && diffFileSet.has(preview.path) ? 'view in diff' : 'open'}
        </span>
        <span>
          <kbd>⌘↵</kbd> peek
        </span>
        {preview && (
          <span>
            <kbd>⌥↑↓</kbd> / <kbd>⇧↑↓</kbd> scroll preview
          </span>
        )}
        <span>
          <kbd>esc</kbd> {preview ? 'back' : 'close'}
        </span>
      </div>
    </Modal>
  )
}

// ── Result list ────────────────────────────────────────────────────

type Row =
  | { kind: 'file'; key: string; hit: FileHit; inDiff: boolean }
  | { kind: 'text'; key: string; hit: ContentHit; inDiff: boolean }
  | { kind: 'symbol'; key: string; hit: SymbolHit; inDiff: boolean }

function ResultList({
  rows,
  scope,
  query,
  focusedIndex,
  engineError,
  isFetching,
  enabled,
  minLength,
  regex,
  changedOnly,
  onHover,
  onActivate,
  onRetry,
}: {
  rows: Row[]
  scope: Scope
  query: string
  focusedIndex: number
  engineError?: string
  isFetching: boolean
  enabled: boolean
  minLength: number
  regex: boolean
  changedOnly: boolean
  onHover: (i: number) => void
  onActivate: (i: number, e?: React.MouseEvent) => void
  onRetry: () => void
}) {
  if (engineError && scope !== 'files') {
    return (
      <div className="searchpalette-state searchpalette-state--error">
        <p>Search engine unavailable</p>
        <span className="searchpalette-state-detail">{engineError}</span>
        <button className="searchpalette-retry" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  if (rows.length > 0) {
    return (
      <>
        {rows.map((row, i) => (
          <ResultRow
            key={row.key}
            row={row}
            index={i}
            query={query}
            focused={i === focusedIndex}
            onHover={onHover}
            onActivate={onActivate}
          />
        ))}
      </>
    )
  }

  // Empty states
  if (!enabled) {
    const hint =
      scope === 'symbols'
        ? query.trim()
          ? 'No matching symbols in the current diff. Type at least 2 characters to search the whole repository.'
          : 'No symbols found in the current diff. Type at least 2 characters to search the whole repository.'
        : scope === 'text'
          ? 'Type to search file contents'
          : 'Type to filter — or browse all files'
    return <div className="searchpalette-state">{hint}</div>
  }
  if (isFetching) {
    return (
      <div className="searchpalette-state">
        <Loader2 size={15} className="spin" /> Searching…
      </div>
    )
  }
  return (
    <div className="searchpalette-state">
      <p>No matches{query.trim() ? ` for “${query.trim()}”` : ''}</p>
      <span className="searchpalette-state-detail">
        {changedOnly
          ? 'Searching only changed files — turn off Changed to search the whole repo'
          : scope === 'text' && !regex
            ? 'Try Tab to switch scope, or enable .* for regex'
            : 'Try Tab to switch scope'}
      </span>
    </div>
  )
}

function ResultRow({
  row,
  index,
  query,
  focused,
  onHover,
  onActivate,
}: {
  row: Row
  index: number
  query: string
  focused: boolean
  onHover: (i: number) => void
  onActivate: (i: number, e?: React.MouseEvent) => void
}) {
  const git = gitChip(row.hit.gitStatus)
  return (
    <div
      id={`sp-row-${index}`}
      role="option"
      aria-selected={focused}
      data-focused={focused}
      className={`searchpalette-row ${focused ? 'is-focused' : ''} ${row.inDiff ? 'is-indiff' : ''}`}
      onMouseEnter={() => onHover(index)}
      onClick={(e) => onActivate(index, e)}
    >
      {row.kind === 'file' && <FileRowBody hit={row.hit} query={query} />}
      {row.kind === 'text' && <TextRowBody hit={row.hit} query={query} />}
      {row.kind === 'symbol' && <SymbolRowBody hit={row.hit} />}
      <div className="searchpalette-rail">
        {row.inDiff && <span className="searchpalette-pill searchpalette-pill--diff">diff</span>}
        {git && (
          <span className={`searchpalette-git searchpalette-git--${git.title}`} title={git.title}>
            {git.label}
          </span>
        )}
      </div>
    </div>
  )
}

function FileRowBody({ hit, query }: { hit: FileHit; query: string }) {
  const name = hit.fileName
  const ranges = subsequenceRanges(name, query)
  return (
    <>
      <span className="searchpalette-tile searchpalette-tile--file">
        <FileText size={13} />
      </span>
      <div className="searchpalette-info">
        <span className="searchpalette-primary">
          <Highlight text={name} ranges={ranges} />
        </span>
        <span className="searchpalette-secondary">{dir(hit.path) || './'}</span>
      </div>
    </>
  )
}

function TextRowBody({ hit, query }: { hit: ContentHit; query: string }) {
  const ranges = highlightRanges(hit.content, hit.matchRanges, query)
  const { text, ranges: windowed } = windowContent(hit.content, ranges)
  return (
    <>
      <span className="searchpalette-tile searchpalette-tile--text">
        <Type size={13} />
      </span>
      <div className="searchpalette-info">
        <span className="searchpalette-primary searchpalette-code">
          <Highlight text={text} ranges={windowed} />
        </span>
        <span className="searchpalette-secondary">
          {hit.fileName}:{hit.line}
          <span className="searchpalette-crumb">{dir(hit.path)}</span>
        </span>
      </div>
    </>
  )
}

function SymbolRowBody({ hit }: { hit: SymbolHit }) {
  const nameIdx = hit.content.indexOf(hit.name)
  const tail = nameIdx >= 0 ? hit.content.slice(nameIdx + hit.name.length).trimEnd() : ''
  const ranges = highlightRanges(hit.name, hit.matchRanges.length ? shiftToName(hit) : undefined, hit.name)
  return (
    <>
      <span className="searchpalette-tile searchpalette-tile--symbol" title={hit.kind}>
        {KIND_GLYPH[hit.kind] ?? '?'}
      </span>
      <div className="searchpalette-info">
        <span className="searchpalette-primary">
          <Highlight text={hit.name} ranges={ranges} />
          {tail && <span className="searchpalette-sigtail">{tail.slice(0, 60)}</span>}
        </span>
        <span className="searchpalette-secondary">
          {hit.fileName}:{hit.line}
          <span className="searchpalette-crumb">{dir(hit.path)}</span>
        </span>
      </div>
      <span className="searchpalette-kind-badge">{hit.kind}</span>
    </>
  )
}

/** The server's symbol matchRanges are offsets into the full line; translate
 *  them to be relative to the symbol name for in-name highlighting. */
function shiftToName(hit: SymbolHit): MatchRange[] | undefined {
  const nameIdx = hit.content.indexOf(hit.name)
  if (nameIdx < 0) return undefined
  const out: MatchRange[] = []
  for (const [s, e] of hit.matchRanges) {
    const ns = s - nameIdx
    const ne = e - nameIdx
    if (ne > 0 && ns < hit.name.length) out.push([Math.max(0, ns), Math.min(hit.name.length, ne)])
  }
  return out.length ? out : undefined
}

// ── Preview pane ─────────────────────────────────────────────────────

function PreviewPane({
  preview,
  theme,
  fontSize,
  defaultTabSize,
  lineWrap,
  showLineNumbers,
  lineHoverHighlight,
  onClose,
  inDiff,
  onGoToDiff,
}: {
  preview: PreviewState
  theme: string
  fontSize: number
  defaultTabSize: number
  lineWrap: boolean
  showLineNumbers: boolean
  lineHoverHighlight: string
  onClose: () => void
  inDiff: boolean
  onGoToDiff: () => void
}) {
  const shikiConfig = SHIKI_THEME_MAP[theme] || SHIKI_THEME_MAP.nord
  const { data, isLoading, error } = useFilePreview(preview.path)
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll to + flash the target line once content is rendered.
  useEffect(() => {
    if (!data?.content || !preview.line || !containerRef.current) return
    highlightLineInElement(containerRef.current, preview.line, preview.match)
  }, [data?.content, preview.line, preview.match])

  return (
    <div className="searchpalette-preview">
      <div className="searchpalette-preview-head">
        <FileText size={12} />
        <span className="searchpalette-preview-path">{preview.path}</span>
        {inDiff && (
          <button
            className="searchpalette-preview-diff-btn"
            onClick={onGoToDiff}
            title="Open this file and line in the main diff viewer (Enter)"
            style={{
              padding: '2.5px 8px',
              fontSize: '10.5px',
              background: 'var(--accent-subtle)',
              border: '1px solid var(--accent)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 600,
              marginRight: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <GitCompare size={11} />
            View in Diff
          </button>
        )}
        <button className="searchpalette-clear" onClick={onClose} aria-label="Close preview">
          <X size={14} />
        </button>
      </div>
      <div className="searchpalette-preview-body" ref={containerRef}>
        {isLoading ? (
          <div className="searchpalette-state">
            <Loader2 size={15} className="spin" /> Loading {preview.path}…
          </div>
        ) : error ? (
          <div className="searchpalette-state searchpalette-state--error">{(error as Error).message}</div>
        ) : data?.binary ? (
          <div className="searchpalette-state">Binary file — no preview</div>
        ) : data?.missing ? (
          <div className="searchpalette-state">File not present in the working tree</div>
        ) : data ? (
          <DiffsFile
            file={{ name: preview.path, contents: data.content ?? '' }}
            options={{
              disableFileHeader: true,
              overflow: lineWrap ? 'wrap' : 'scroll',
              disableLineNumbers: !showLineNumbers,
              lineHoverHighlight: lineHoverHighlight as any,
              theme: {
                dark: shikiConfig.type === 'dark' ? shikiConfig.themeName : 'nord',
                light: shikiConfig.type === 'light' ? shikiConfig.themeName : 'github-light',
              },
              themeType: shikiConfig.type,
              unsafeCSS: `
                :host {
                  --diffs-tab-size: ${defaultTabSize} !important;
                  --diffs-font-family: var(--font-mono) !important;
                  --diffs-font-size: ${fontSize}px !important;
                  --diffs-line-height: ${Math.round(fontSize * 1.7)}px !important;
                }
              `,
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
