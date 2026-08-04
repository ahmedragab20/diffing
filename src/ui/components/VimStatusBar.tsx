import { useState, useEffect, memo, useRef, useCallback } from 'react'
import { Terminal, HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react'

interface VimStatusBarProps {
  activeFile: string | null
  onShowHelp: () => void
  placeholder?: string
  /** Ephemeral status line (e.g. search n/N with no active hits). */
  statusMessage?: string | null
  /** When false, the bar is hidden entirely (no DOM). Defaults to true. */
  visible?: boolean
  /** Number of files with unsaved in-place edits (drives the dirty indicator). */
  editDirtyCount?: number
  /** Whether saving dirty edit sessions is currently possible (working-tree scope). */
  editSaveEnabled?: boolean
  onSaveAllEdits?: () => void
}

export const VimStatusBar = memo(function VimStatusBar({
  activeFile,
  onShowHelp,
  placeholder = 'No active file (J/K to jump)',
  statusMessage = null,
  visible = true,
  editDirtyCount = 0,
  editSaveEnabled = false,
  onSaveAllEdits,
}: VimStatusBarProps) {
  if (!visible) return null

  const [isInsertMode, setIsInsertMode] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const checkMode = () => {
      const active = document.activeElement
      if (active) {
        const tag = active.tagName.toLowerCase()
        const isEditing =
          tag === 'input' ||
          tag === 'textarea' ||
          active.hasAttribute('contenteditable')
        setIsInsertMode(isEditing)
      } else {
        setIsInsertMode(false)
      }
    }

    document.addEventListener('focusin', checkMode)
    document.addEventListener('focusout', checkMode)
    const interval = setInterval(checkMode, 400)

    return () => {
      document.removeEventListener('focusin', checkMode)
      document.removeEventListener('focusout', checkMode)
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setIsCollapsed(prev => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const fileName = activeFile ? activeFile.split('/').pop() : null
  const fileDir = activeFile && activeFile.includes('/') ? activeFile.split('/').slice(0, -1).join('/') + '/' : ''

  const toggleCollapse = useCallback((e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation()
    setIsCollapsed(prev => !prev)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleCollapse(e)
    }
  }

  return (
    <div className={`vim-status-bar ${isCollapsed ? 'vim-status-collapsed' : ''}`}>
      <div className={`vim-mode-badge ${isInsertMode ? 'vim-mode-insert' : 'vim-mode-normal'}`}>
        {isInsertMode ? 'INSERT' : 'NORMAL'}
      </div>

      {!isCollapsed && (
        <>
          <div className="vim-status-content">
            <Terminal size={12} className="vim-status-icon" />
            {activeFile ? (
              <span className="vim-status-file" title={activeFile}>
                <span className="vim-file-dir">{fileDir}</span>
                <strong className="vim-file-name">{fileName}</strong>
              </span>
            ) : statusMessage ? (
              <span className="vim-status-placeholder vim-status-flash">{statusMessage}</span>
            ) : (
              <span className="vim-status-placeholder">{placeholder}</span>
            )}
          </div>

          <button 
            className="vim-status-help-btn" 
            onClick={onShowHelp}
            title="View Keyboard Shortcuts (?)"
          >
            <HelpCircle size={13} />
            <span>Shortcuts</span>
            <kbd className="vim-kbd-small">?</kbd>
          </button>

          {editDirtyCount > 0 && (
            <button
              className="vim-status-edit-save"
              onClick={onSaveAllEdits}
              disabled={!editSaveEnabled}
              title={editSaveEnabled ? 'Save all unsaved edits (Cmd/Ctrl+S)' : 'Editing unavailable in this review scope'}
            >
              <span className="vim-edit-dirty-dot" aria-hidden="true" />
              <span>
                {editDirtyCount} file{editDirtyCount === 1 ? '' : 's'} edited
              </span>
              <kbd className="vim-kbd-small">⌘S</kbd>
            </button>
          )}
        </>
      )}

      <button 
        ref={toggleRef}
        className="vim-status-toggle"
        onClick={toggleCollapse}
        onKeyDown={handleKeyDown}
        title={isCollapsed ? 'Expand status bar (⌘B)' : 'Collapse status bar (⌘B)'}
        aria-label={isCollapsed ? 'Expand status bar' : 'Collapse status bar'}
        tabIndex={0}
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </div>
  )
})
