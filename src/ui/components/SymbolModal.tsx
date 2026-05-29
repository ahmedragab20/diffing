import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import type { SymbolEntry } from '../hooks/useSymbols'
import { scrollToLine } from '../utils'
import { Modal } from '../primitives/Modal'

interface SymbolModalProps {
  symbols: SymbolEntry[]
  isOpen: boolean
  onClose: () => void
}

const KIND_ICONS: Record<string, string> = {
  function: 'f',
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

export function SymbolModal({ symbols, isOpen, onClose }: SymbolModalProps) {
  const [query, setQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!query.trim()) return symbols
    const q = query.toLowerCase()
    return symbols.filter(
      (s) => s.name.toLowerCase().includes(q) || s.filePath.toLowerCase().includes(q),
    )
  }, [symbols, query])

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          e.preventDefault()
          setFocusedIndex((i) => (i + 1) % filtered.length)
          break
        case 'ArrowUp':
        case 'k':
          e.preventDefault()
          setFocusedIndex((i) => (i - 1 + filtered.length) % filtered.length)
          break
        case 'Enter':
          e.preventDefault()
          if (filtered[focusedIndex]) {
            const s = filtered[focusedIndex]
            scrollToLine(s.filePath, s.lineNumber, s.side, s.name)
            onClose()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [filtered, focusedIndex, onClose],
  )

  useEffect(() => {
    if (!isOpen) return
    const focused = listRef.current?.children[focusedIndex] as HTMLElement | undefined
    focused?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, isOpen])

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      className="symbol-modal ui-modal--palette"
      ariaLabel="Symbol search"
      initialFocus={searchRef}
      onKeyDown={handleKeyDown}
    >
        <div className="symbol-modal-header">
          <div className="symbol-search">
            <Search size={14} className="symbol-search-icon" />
            <input
              ref={searchRef}
              type="text"
              className="symbol-search-input"
              placeholder="Search symbols..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="symbol-search-clear" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>
          <span className="symbol-count">{filtered.length} symbols</span>
        </div>
        <div className="symbol-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="symbol-empty">No symbols found</div>
          ) : (
            filtered.map((s, i) => {
              const dir = s.filePath.split('/').slice(0, -1).join('/')
              const fileName = s.filePath.split('/').pop()
              return (
                <div
                  key={`${s.filePath}:${s.side}:${s.lineNumber}:${s.name}`}
                  className={`symbol-item ${i === focusedIndex ? 'symbol-item-focused' : ''}`}
                  onClick={() => {
                    scrollToLine(s.filePath, s.lineNumber, s.side, s.name)
                    onClose()
                  }}
                  onMouseEnter={() => setFocusedIndex(i)}
                >
                  <span className={`symbol-kind symbol-kind-${s.kind}`}>
                    {KIND_ICONS[s.kind] || '?'}
                  </span>
                  <div className="symbol-info">
                    <span className="symbol-name">{s.name}</span>
                    <span className="symbol-location">
                      {dir ? `${dir}/` : ''}
                      <strong>{fileName}</strong>
                      <span className="symbol-line">:{s.lineNumber}</span>
                    </span>
                  </div>
                  <span className="symbol-badge">{s.kind}</span>
                </div>
              )
            })
          )}
        </div>
    </Modal>
  )
}
