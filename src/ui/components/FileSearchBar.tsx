import { useEffect, useRef } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import type { DiffLineEntry } from '../hooks/useDiffSearch'

interface FileSearchBarProps {
  filePath: string
  query: string
  hits: DiffLineEntry[]
  index: number
  onQueryChange: (query: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

/**
 * Find-in-file bar shown inside a file card while a file-scoped search session
 * is active. Mirrors the palette's keyboard model (Enter/Shift+Enter cycle
 * hits, Esc closes) but stays anchored to the file being reviewed.
 */
export function FileSearchBar({
  query,
  hits,
  index,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: FileSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onPrev()
      else onNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const total = hits.length
  const current = total === 0 ? 0 : index + 1

  return (
    <div
      className="file-search-bar"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      role="search"
      aria-label="Find in file"
    >
      <Search size={13} className="file-search-bar-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        className="file-search-bar-input"
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Find in file…"
        aria-label="Find in file"
        spellCheck={false}
        autoComplete="off"
      />
      <span className="file-search-bar-count" aria-live="polite">
        {query.trim() ? `${current}/${total}` : `${total} match${total === 1 ? '' : 'es'}`}
      </span>
      <div className="file-search-bar-actions">
        <button
          className="file-search-bar-btn"
          onClick={onPrev}
          disabled={total === 0}
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
        >
          <ChevronUp size={13} />
        </button>
        <button
          className="file-search-bar-btn"
          onClick={onNext}
          disabled={total === 0}
          title="Next match (Enter)"
          aria-label="Next match"
        >
          <ChevronDown size={13} />
        </button>
        <button
          className="file-search-bar-btn"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close search"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
