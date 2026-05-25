import { useState, useEffect, memo } from 'react'
import { Terminal, HelpCircle } from 'lucide-react'

interface VimStatusBarProps {
  activeFile: string | null
  onShowHelp: () => void
}

export const VimStatusBar = memo(function VimStatusBar({
  activeFile,
  onShowHelp,
}: VimStatusBarProps) {
  const [isInsertMode, setIsInsertMode] = useState(false)

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

    // Set up listeners for focus changes
    document.addEventListener('focusin', checkMode)
    document.addEventListener('focusout', checkMode)
    // Run periodically as fallback
    const interval = setInterval(checkMode, 400)

    return () => {
      document.removeEventListener('focusin', checkMode)
      document.removeEventListener('focusout', checkMode)
      clearInterval(interval)
    }
  }, [])

  const fileName = activeFile ? activeFile.split('/').pop() : null
  const fileDir = activeFile && activeFile.includes('/') ? activeFile.split('/').slice(0, -1).join('/') + '/' : ''

  return (
    <div className="vim-status-bar">
      <div className={`vim-mode-badge ${isInsertMode ? 'vim-mode-insert' : 'vim-mode-normal'}`}>
        {isInsertMode ? 'INSERT' : 'NORMAL'}
      </div>
      
      <div className="vim-status-content">
        <Terminal size={12} className="vim-status-icon" />
        {activeFile ? (
          <span className="vim-status-file" title={activeFile}>
            <span className="vim-file-dir">{fileDir}</span>
            <strong className="vim-file-name">{fileName}</strong>
          </span>
        ) : (
          <span className="vim-status-placeholder">No active file (J/K to jump)</span>
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
    </div>
  )
})
