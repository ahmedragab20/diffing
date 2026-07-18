import { memo } from 'react'
import { X, Keyboard, Navigation, Eye, MessageSquare, GitCommit } from 'lucide-react'
import { Modal } from '../primitives/Modal'
import { BrandMark } from './BrandMark'

interface ShortcutsHelpModalProps {
  isOpen: boolean
  onClose: () => void
  mode?: 'diff' | 'plan' | 'pr'
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
      title: 'Commit Walk',
      icon: <GitCommit size={15} />,
      items: [
        { keys: [']'], description: 'Next commit (diffing show multi-commit)' },
        { keys: ['['], description: 'Previous commit (diffing show multi-commit)' },
        { keys: ['UI'], description: 'Walk bar: Show all returns to the full range patch' },
      ],
    },
    {
      title: 'Search & Dialogs',
      icon: <Eye size={15} />,
      items: [
        { keys: ['⌘', 'K'], description: 'Open Search Palette (all scopes)' },
        { keys: ['/'], description: 'Search file contents (Text scope)' },
        { keys: ['s'], description: 'Search symbols (Symbols scope)' },
        { keys: ['g', 's'], description: 'Search symbols (same as s)' },
        { keys: ['g', 'f'], description: 'Open Search Palette (all scopes)' },
        { keys: ['g', 'v'], description: 'Browse any file in the repo (Files scope)' },
        { keys: ['g', 't'], description: 'Open Theme Selection Modal' },
        { keys: ['Tab'], description: 'Cycle search scope while palette is open' },
        { keys: ['⌘', '↵'], description: 'Peek a result in the preview pane' },
        { keys: ['?'], description: 'Open Keyboard Shortcuts Guide' },
        { keys: ['⌘', '?'], description: 'Open Keyboard Shortcuts Guide' },
        { keys: ['Esc'], description: 'Close preview / dialog' },
      ],
    },
    {
      title: 'Views & Formatting',
      icon: <MessageSquare size={15} />,
      items: [
        { keys: ['m'], description: 'Toggle Diff Style (Unified ↔ Split)' },
        { keys: ['t'], description: 'Cycle Tab Indentation Size (2 → 4 → 8)' },
        { keys: ['w'], description: 'Toggle Soft-Wrap Long Lines' },
        { keys: ['n'], description: 'Toggle Line Numbers' },
        { keys: ['i'], description: 'Cycle Diff Indicator Style (+/− → bars → none)' },
        { keys: ['I'], description: 'Cycle Inline Diff Style (word → word-alt → char → none)' },
        { keys: ['⌘', 'Shift', 'P'], description: 'Toggle Preview Mode in Comments' },
      ],
    },
    {
      title: 'Review & Comments',
      icon: <MessageSquare size={15} />,
      items: [
        { keys: ['UI'], description: 'Select lines or gutter + to start an inline comment' },
        { keys: ['v'], description: 'Toggle Viewed on the active file (collapses card)' },
        { keys: ['UI'], description: 'File header icons: expand context · edit · file comment' },
        { keys: ['UI'], description: 'Round badge → open review history timeline' },
        { keys: ['UI'], description: 'File-tree chips: Unviewed · Comments · Since last' },
        { keys: ['UI'], description: 'Comment form “Suggest change” inserts ```suggestion fence' },
        { keys: ['click #'], description: 'Line number copies a deep permalink (?file&line&side)' },
        { keys: ['UI'], description: 'Minimap: change-map + density strip scroll targets' },
        { keys: ['UI'], description: 'Send review: pick verdict, optional note, hand off to agent' },
      ],
    },
    {
      title: 'Dialogs & Settings',
      icon: <Keyboard size={15} />,
      items: [
        { keys: ['?'], description: 'Open Keyboard Shortcuts Guide' },
        { keys: ['⌘', '?'], description: 'Open Keyboard Shortcuts Guide' },
        { keys: ['⌘', ','], description: 'Open Settings' },
        { keys: ['⌘', 'K'], description: 'Open Search Palette' },
        { keys: ['⌘', 'B'], description: 'Collapse / expand the vim status bar' },
        { keys: ['g', 't'], description: 'Open Theme Selection Modal' },
        { keys: ['Esc'], description: 'Close preview / dialog / this guide' },
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
        { keys: ['b'], description: 'Toggle Plans Sidebar collapse' },
      ],
    },
    {
      title: 'Views & Layout',
      icon: <Eye size={15} />,
      items: [
        { keys: ['m'], description: 'Cycle view mode (Source → Read → Split)' },
        { keys: ['UI'], description: 'Toolbar Source / Read / Split switches the same modes' },
        { keys: ['z'], description: 'Toggle Zen reading (enters Read if needed; full-width focus)' },
        { keys: ['UI'], description: 'Read mode: expand icon also toggles Zen' },
        { keys: ['Esc'], description: 'Exit Zen reading mode' },
        { keys: ['e'], description: 'Toggle live plan edit (Source editor + Read preview; current version only)' },
        { keys: ['⌘', 'S'], description: 'While editing: flush autosave now' },
        { keys: ['UI'], description: 'Edit mode: Save · Save as new version · Discard (recent and/or roll back to original)' },
        { keys: ['Esc'], description: 'Edit mode: open Discard (or exit edit if nothing to discard)' },
        { keys: ['o'], description: 'Toggle Outline sidebar (left TOC)' },
        { keys: ['c'], description: 'Toggle Comments map sidebar (right rail)' },
        { keys: ['drag'], description: 'Split mode: drag the center divider to resize panes' },
        { keys: ['dbl-click'], description: 'Split mode: double-click divider to reset 50/50' },
        { keys: ['←', '→'], description: 'Split mode: focus divider, nudge width ±2%' },
        { keys: ['t'], description: 'Cycle Tab Indentation Size (2 → 4 → 8)' },
        { keys: ['w'], description: 'Toggle Soft-Wrap Long Lines' },
        { keys: ['n'], description: 'Toggle Line Numbers' },
      ],
    },
    {
      title: 'Comments & Review',
      icon: <MessageSquare size={15} />,
      items: [
        { keys: ['c'], description: 'Toggle Comments map sidebar (right rail)' },
        { keys: ['o'], description: 'Toggle Outline sidebar (left TOC)' },
        { keys: ['UI'], description: 'Source: select lines or click gutter + to comment' },
        { keys: ['UI'], description: 'Read: highlight text → Add comment (multiple drafts OK)' },
        { keys: ['UI'], description: 'Edit mode: new comments disabled; existing threads still resolvable' },
        { keys: ['Esc'], description: 'Dismiss Add-comment chip / close draft (asks if dirty)' },
        { keys: ['UI'], description: 'Header icons: copy link · copy markdown · open in editor · edit' },
        { keys: ['UI'], description: 'Header: Outline (o) · Comments map (c)' },
        { keys: ['⌘', 'Shift', 'P'], description: 'Toggle Preview Mode in Comments' },
      ],
    },
    {
      title: 'Dialogs & Settings',
      icon: <Keyboard size={15} />,
      items: [
        { keys: ['?'], description: 'Open Keyboard Shortcuts Guide' },
        { keys: ['⌘', '?'], description: 'Open Keyboard Shortcuts Guide' },
        { keys: ['⌘', ','], description: 'Open Settings' },
        { keys: ['⌘', 'B'], description: 'Collapse / expand the vim status bar' },
        { keys: ['g', 't'], description: 'Open Theme Selection Modal' },
        { keys: ['Esc'], description: 'Close preview / dialog / this guide' },
      ],
    },
  ]

  const prCategories: ShortcutCategory[] = diffCategories
    .filter((category) => category.title !== 'Commit Walk')
    .map((category) => category.title === 'Review & Comments'
      ? {
          ...category,
          items: [
            { keys: ['UI'], description: 'Select lines or gutter + to start a GitHub review comment' },
            { keys: ['v'], description: 'Toggle Viewed on the active PR file (collapses card)' },
            { keys: ['UI'], description: 'File header icons: expand context · file comment · viewed' },
            { keys: ['UI'], description: 'File-tree chips: Unviewed · Comments' },
            { keys: ['click #'], description: 'Line number copies a deep permalink (?file&line&side)' },
            { keys: ['UI'], description: 'Checks pill: live successful · failed · pending GitHub actions' },
            { keys: ['UI'], description: 'Submit to GitHub: approve · comment · request changes · draft' },
          ],
        }
      : category)

  const categories = mode === 'plan' ? planCategories : mode === 'pr' ? prCategories : diffCategories
  const intro =
    mode === 'plan'
      ? 'Vim-style keybindings for plan review. Cycle Source / Read / Split with m, jump plans with J/K, and comment from line selection or text highlight.'
      : mode === 'pr'
        ? 'The same Vim-style diff keybindings used by local review, scoped to GitHub PR navigation, formatting, search, and comments.'
      : 'Vim-style keybindings for reviewing diffs. Jump files with J/K, walk commits with [ / ], and open search with ⌘K.'

  return (
    <Modal open={isOpen} onClose={onClose} className="shortcuts-modal" ariaLabel="Keyboard shortcuts">
      <div className="shortcuts-header">
        <div className="shortcuts-header-title">
          <BrandMark size={22} className="shortcuts-mark" />
          <h2>
            {mode === 'plan' ? 'Plan Review Shortcuts' : mode === 'pr' ? 'GitHub PR Review Shortcuts' : 'Developer Keyboard Shortcuts'}
          </h2>
        </div>
        <button className="shortcuts-close-btn" onClick={onClose} aria-label="Close dialog">
          <X size={16} />
        </button>
      </div>

      <div className="shortcuts-body">
        <div className="shortcuts-intro">{intro}</div>

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
        Press <kbd className="vim-kbd-small">?</kbd>
        {mode === 'plan' && (
          <>
            {' '}or <kbd className="vim-kbd-small">Esc</kbd>
          </>
        )}{' '}
        to dismiss this menu at any time.
      </div>
    </Modal>
  )
})
