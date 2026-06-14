import { memo } from 'react'
import { X, Keyboard, Navigation, Eye, MessageSquare } from 'lucide-react'
import { Modal } from '../primitives/Modal'

interface ShortcutsHelpModalProps {
  isOpen: boolean
  onClose: () => void
  mode?: 'diff' | 'plan'
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
  mode = 'diff',
}: ShortcutsHelpModalProps) {
  const diffCategories: ShortcutCategory[] = [
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
        { keys: ['⌘', 'K'], description: 'Open Search Palette (files · text · symbols)' },
        { keys: ['/'], description: 'Search file contents (Text scope)' },
        { keys: ['g', 'f'], description: 'Search files (Files scope)' },
        { keys: ['s'], description: 'Search symbols (or "g s")' },
        { keys: ['g', 'v'], description: 'Browse any file in the repo' },
        { keys: ['g', 't'], description: 'Open Theme Selection Modal' },
        { keys: ['Tab'], description: 'Cycle search scope while open' },
        { keys: ['⌘', '↵'], description: 'Peek a result in the preview pane' },
        { keys: ['?'], description: 'Toggle Keyboard Shortcuts Guide' },
        { keys: ['Esc'], description: 'Close preview / dialog' },
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
        { keys: ['⌘', 'Shift', 'P'], description: 'Toggle Preview Mode in Comments' },
      ],
    },
  ]

  const planCategories: ShortcutCategory[] = [
    {
      title: 'Scrolling & Content',
      icon: <Navigation size={15} />,
      items: [
        { keys: ['j'], description: 'Scroll Down slightly' },
        { keys: ['k'], description: 'Scroll Up slightly' },
        { keys: ['Ctrl', 'd'], description: 'Scroll Down half page' },
        { keys: ['Ctrl', 'u'], description: 'Scroll Up half page' },
        { keys: ['g', 'g'], description: 'Scroll to Top of plan' },
        { keys: ['G'], description: 'Scroll to Bottom of plan' },
      ],
    },
    {
      title: 'Plan Navigation',
      icon: <Keyboard size={15} />,
      items: [
        { keys: ['J'], description: 'Jump to Next Plan in list' },
        { keys: ['K'], description: 'Jump to Previous Plan in list' },
        { keys: ['b'], description: 'Toggle Plans Sidebar Panel collapse' },
      ],
    },
    {
      title: 'Search & Dialogs',
      icon: <Eye size={15} />,
      items: [
        { keys: ['g', 't'], description: 'Open Theme Selection Modal' },
        { keys: ['?'], description: 'Toggle Keyboard Shortcuts Guide' },
        { keys: ['Esc'], description: 'Close preview / dialog' },
      ],
    },
    {
      title: 'Views & Formatting',
      icon: <MessageSquare size={15} />,
      items: [
        { keys: ['m'], description: 'Toggle View Mode (Source / Rendered)' },
        { keys: ['t'], description: 'Cycle Tab Indentation Size (2 → 4 → 8)' },
        { keys: ['w'], description: 'Toggle Soft-Wrap Long Lines' },
        { keys: ['n'], description: 'Toggle Line Numbers' },
        { keys: ['⌘', 'Shift', 'P'], description: 'Toggle Preview Mode in Comments' },
      ],
    },
  ]

  const categories = mode === 'plan' ? planCategories : diffCategories

  return (
    <Modal open={isOpen} onClose={onClose} className="shortcuts-modal" ariaLabel="Keyboard shortcuts">
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
          Vim-style keybindings are enabled! Navigate and review plans entirely from your home keys.
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
    </Modal>
  )
})
