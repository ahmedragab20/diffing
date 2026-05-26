import { useEffect, memo } from 'react'
import { X, Keyboard, Navigation, Eye, MessageSquare } from 'lucide-react'

interface ShortcutsHelpModalProps {
  isOpen: boolean
  onClose: () => void
}

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutCategory {
  title: string
  icon: React.ReactNode
  items: ShortcutItem[]
}

export const ShortcutsHelpModal = memo(function ShortcutsHelpModal({
  isOpen,
  onClose,
}: ShortcutsHelpModalProps) {
  useEffect(() => {
    if (!isOpen) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const categories: ShortcutCategory[] = [
    {
      title: 'Scrolling & Diffs',
      icon: <Navigation size={15} />,
      items: [
        { keys: ['j'], description: 'Scroll Down slightly' },
        { keys: ['k'], description: 'Scroll Up slightly' },
        { keys: ['Ctrl', 'd'], description: 'Scroll Down half page' },
        { keys: ['Ctrl', 'u'], description: 'Scroll Up half page' },
        { keys: ['g', 'g'], description: 'Scroll to Top of diffs' },
        { keys: ['G'], description: 'Scroll to Bottom of diffs' },
      ],
    },
    {
      title: 'File Navigation',
      icon: <Keyboard size={15} />,
      items: [
        { keys: ['J'], description: 'Jump to Next File Diff' },
        { keys: ['K'], description: 'Jump to Previous File Diff' },
        { keys: ['v'], description: 'Toggle Viewed state for Active File' },
        { keys: ['b'], description: 'Toggle Sidebar Panel collapse' },
      ],
    },
    {
      title: 'Search & Dialogs',
      icon: <Eye size={15} />,
      items: [
        { keys: ['/'], description: 'Open Diff Search Modal' },
        { keys: ['g', 's'], description: 'Open Symbol Search Modal (or "s")' },
        { keys: ['g', 'v'], description: 'Open File Viewer (any file in repo)' },
        { keys: ['?'], description: 'Toggle Keyboard Shortcuts Guide' },
        { keys: ['Esc'], description: 'Close active search/modal dialog' },
      ],
    },
    {
      title: 'Views & Formatting',
      icon: <MessageSquare size={15} />,
      items: [
        { keys: ['m'], description: 'Toggle Diff Style (Split / Unified)' },
        { keys: ['t'], description: 'Cycle Tab Indentation Size (2 → 4 → 8)' },
        { keys: ['w'], description: 'Toggle Soft-Wrap Long Lines' },
        { keys: ['n'], description: 'Toggle Line Numbers' },
        { keys: ['i'], description: 'Cycle Diff Indicator Style (+/− → bars → none)' },
        { keys: ['Shift', 'I'], description: 'Cycle Inline Diff Style (word → char → none)' },
      ],
    },
  ]

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <div className="shortcuts-header-title">
            <Keyboard size={18} className="shortcuts-icon" />
            <h2>Developer Keyboard Shortcuts</h2>
          </div>
          <button className="shortcuts-close-btn" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <div className="shortcuts-body">
          <div className="shortcuts-intro">
            Vim-style keybindings are enabled! Hover, select, and review code entirely from your home keys.
          </div>
          
          <div className="shortcuts-grid">
            {categories.map((cat, ci) => (
              <div key={ci} className="shortcuts-section">
                <h3 className="shortcuts-section-title">
                  {cat.icon}
                  <span>{cat.title}</span>
                </h3>
                <div className="shortcuts-list">
                  {cat.items.map((item, ii) => (
                    <div key={ii} className="shortcuts-row">
                      <span className="shortcuts-desc">{item.description}</span>
                      <div className="shortcuts-keys">
                        {item.keys.map((k, ki) => (
                          <span key={ki}>
                            <kbd className="vim-kbd">{k}</kbd>
                            {ki < item.keys.length - 1 && <span className="kbd-plus">+</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="shortcuts-footer">
          Press <kbd className="vim-kbd-small">?</kbd> to dismiss this menu at any time.
        </div>
      </div>
    </div>
  )
})
