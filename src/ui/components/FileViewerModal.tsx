import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, X, FileText, Loader2 } from 'lucide-react'
import { File as DiffsFile } from '@pierre/diffs/react'
import { SHIKI_THEME_MAP } from '../utils'
import { Modal } from '../primitives/Modal'

interface FileViewerModalProps {
  isOpen: boolean
  onClose: () => void
  theme: string
  fontSize: number
  defaultTabSize: number
  lineDiffType: string
  lineWrap: boolean
  showLineNumbers: boolean
  lineHoverHighlight: string
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
        if (gap === 1) score += 15
        else score += Math.max(0, 10 - gap)
      } else {
        score += 10
        const ch = text[ti - 1]
        if (
          ti === 0 ||
          !ch ||
          ch === ' ' ||
          ch === '_' ||
          ch === '-' ||
          ch === '.' ||
          ch === '/'
        ) {
          score += 10
        }
      }
      prevPos = ti
      qi++
    } else if (prevPos >= 0 && ti - prevPos > 25) {
      return null
    }
  }
  if (qi < queryLower.length) return null
  score -= text.length * 0.02
  return score
}

export function FileViewerModal({
  isOpen,
  onClose,
  theme,
  fontSize,
  defaultTabSize,
  lineDiffType: _lineDiffType,
  lineWrap,
  showLineNumbers,
  lineHoverHighlight,
}: FileViewerModalProps) {
  const shikiConfig = SHIKI_THEME_MAP[theme] || SHIKI_THEME_MAP.nord
  const [files, setFiles] = useState<string[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Fetch file list when modal opens (once per session usually; refetch keeps
  // it fresh if files were added/removed since last open).
  useEffect(() => {
    if (!isOpen) return
    setFilesLoading(true)
    fetch('/api/repo-files')
      .then((res) => res.json())
      .then((json) => setFiles(json.files ?? []))
      .catch(() => setFiles([]))
      .finally(() => setFilesLoading(false))
  }, [isOpen])

  // Reset state when modal opens
  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setFocusedIndex(0)
    setSelectedPath(null)
    setContent(null)
    setContentError(null)
    if (searchRef.current) searchRef.current.focus()
  }, [isOpen])

  // Fetch content when a path is selected
  useEffect(() => {
    if (!selectedPath) return
    setContentLoading(true)
    setContentError(null)
    setContent(null)
    fetch(`/api/file-text?path=${encodeURIComponent(selectedPath)}&version=new`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setContentError(json.error)
        } else {
          setContent(json.content ?? '')
        }
      })
      .catch((err: Error) => setContentError(err.message))
      .finally(() => setContentLoading(false))
  }, [selectedPath])

  const results = useMemo(() => {
    if (!query.trim()) return files.slice(0, 100).map((f) => ({ path: f, score: 0 }))
    const scored: { path: string; score: number }[] = []
    for (const f of files) {
      const s = fuzzyMatch(f, query)
      if (s !== null) scored.push({ path: f, score: s })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 100)
  }, [files, query])

  useEffect(() => {
    setFocusedIndex(0)
  }, [query])

  useEffect(() => {
    if (!isOpen) return
    const focused = listRef.current?.children[focusedIndex] as HTMLElement | undefined
    focused?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, isOpen])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          if (e.key === 'j' && !e.ctrlKey && document.activeElement === searchRef.current) {
            return // let the user type 'j'
          }
          e.preventDefault()
          setFocusedIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)))
          break
        case 'ArrowUp':
        case 'k':
          if (e.key === 'k' && !e.ctrlKey && document.activeElement === searchRef.current) {
            return
          }
          e.preventDefault()
          setFocusedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[focusedIndex]) {
            setSelectedPath(results[focusedIndex].path)
          }
          break
        case 'Escape':
          e.preventDefault()
          if (selectedPath) {
            setSelectedPath(null)
            setContent(null)
          } else {
            onClose()
          }
          break
      }
    },
    [results, focusedIndex, onClose, selectedPath],
  )

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      className="diffsearch-modal file-viewer-modal ui-modal--palette"
      ariaLabel="File viewer"
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
              placeholder={
                selectedPath ? selectedPath : 'View any file in the repo…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!!selectedPath}
            />
            {(query || selectedPath) && (
              <button
                className="diffsearch-search-clear"
                onClick={() => {
                  if (selectedPath) {
                    setSelectedPath(null)
                    setContent(null)
                  } else {
                    setQuery('')
                  }
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <span className="diffsearch-count">
            {filesLoading
              ? 'Loading files…'
              : selectedPath
                ? 'Esc to return to list'
                : `${results.length} of ${files.length}`}
          </span>
        </div>
        {!selectedPath && (
          <div className="diffsearch-list" ref={listRef}>
            {filesLoading ? (
              <div className="diffsearch-empty">
                <Loader2 size={14} className="spin" /> Loading repository files…
              </div>
            ) : results.length === 0 ? (
              <div className="diffsearch-empty">No matches found</div>
            ) : (
              results.map((r, i) => {
                const dir = r.path.split('/').slice(0, -1).join('/')
                const name = r.path.split('/').pop()
                return (
                  <div
                    key={r.path}
                    className={`diffsearch-item ${
                      i === focusedIndex ? 'diffsearch-item-focused' : ''
                    }`}
                    onClick={() => setSelectedPath(r.path)}
                    onMouseEnter={() => setFocusedIndex(i)}
                  >
                    <FileText size={12} className="file-viewer-item-icon" />
                    <div className="diffsearch-info">
                      <span className="diffsearch-location">
                        {dir ? `${dir}/` : ''}
                        <strong>{name}</strong>
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
        {selectedPath && (
          <div className="file-viewer-content">
            {contentLoading ? (
              <div className="diffsearch-empty">
                <Loader2 size={14} className="spin" /> Loading {selectedPath}…
              </div>
            ) : contentError ? (
              <div className="diffsearch-empty file-viewer-error">{contentError}</div>
            ) : content !== null ? (
              <DiffsFile
                file={{ name: selectedPath, contents: content }}
                options={{
                  disableFileHeader: true,
                  overflow: lineWrap ? 'wrap' : 'scroll',
                  disableLineNumbers: !showLineNumbers,
                  lineHoverHighlight: lineHoverHighlight as any,
                  theme: {
                    dark: shikiConfig.type === 'dark' ? shikiConfig.themeName : 'nord',
                    light:
                      shikiConfig.type === 'light' ? shikiConfig.themeName : 'github-light',
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
        )}
    </Modal>
  )
}
