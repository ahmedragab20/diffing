import { useEffect, useRef } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import type { DiffLineEntry } from '../hooks/useDiffSearch'

interface FileSearchBarProps {
  filePath: string
  query: string
  hits: DiffLineEntry[]
  index: number
  /**
   * Bumped by the session each time the bar should grab focus — on mount and
   * on every `open()` (⌘F re-press after the field blurred). The input is
   * re-focused and its current text selected so retyping replaces the query.
   */
  focusNonce?: number
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
  focusNonce,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: FileSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    // preventScroll: the deliberate scroll below uses block:'nearest' and the
    // input's scroll-margin-top, so the bar clears the sticky toolbar — the
    // native focus scroll does not respect that margin.
    el.focus({ preventScroll: true })
    el.select()
    el.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [focusNonce])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onPrev()
      else onNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Swallow the stroke so the global keymap never sees it: the same Esc
      // that closes the search would otherwise ALSO exit zen mode (the
      // keymap's Escape branch fires for keydowns that bubble to window).
      e.stopPropagation()
      onClose()
    }
  }

  /**
   * Typing happens while the input still has focus after a match jump scrolled
   * the card away (Enter never blurs). `block:'nearest'` brings the field back
   * into view with the minimal scroll — and does nothing when it is already
   * visible — so every keystroke keeps the search bar on screen.
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onQueryChange(e.target.value)
    inputRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
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
        onChange={handleChange}
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
