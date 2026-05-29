import { useState, useEffect, memo } from 'react'
import { GitBranch, Settings, Palette, Search } from 'lucide-react'
import type { DiffOptions } from '../hooks/useDiff'
import type {
  LineDiffType,
  DiffIndicators,
  HunkSeparatorStyle,
  LineHoverHighlight,
} from '../hooks/useSettings'
import { Popover } from '../primitives/Popover'
import { Select } from '../primitives/Select'
import { SendReviewPopover } from '../components/SendReviewPopover'
import type { ReviewComment } from '../../lib/types'

interface ToolbarProps {
  repoName: string
  branch: string
  fileCount: number
  additions: number
  deletions: number
  commentCount: number
  diffStyle: 'split' | 'unified'
  diffOptions: DiffOptions
  defaultTabSize: number
  browser?: string
  theme: string
  editorIDE?: string
  customMode: boolean
  lineDiffType: LineDiffType
  lineWrap: boolean
  diffIndicators: DiffIndicators
  showLineNumbers: boolean
  hunkSeparators: HunkSeparatorStyle
  lineHoverHighlight: LineHoverHighlight
  fontSize: number
  haptics: boolean
  sounds: boolean
  onDiffStyleChange: (style: 'split' | 'unified') => void
  onDiffOptionsChange: (options: DiffOptions) => void
  onDefaultTabSizeChange: (size: number) => void
  onBrowserChange: (browser: string) => void
  onThemeChange: (theme: string) => void
  onEditorIDEChange: (editor: string) => void
  onLineDiffTypeChange: (v: LineDiffType) => void
  onLineWrapChange: (v: boolean) => void
  onDiffIndicatorsChange: (v: DiffIndicators) => void
  onShowLineNumbersChange: (v: boolean) => void
  onHunkSeparatorsChange: (v: HunkSeparatorStyle) => void
  onLineHoverHighlightChange: (v: LineHoverHighlight) => void
  onFontSizeChange: (v: number) => void
  onHapticsChange: (v: boolean) => void
  onSoundsChange: (v: boolean) => void
  onOpenSearch: () => void
  onCopyComments: () => Promise<void>
  onSendToAgent: (generalComment?: string) => Promise<unknown>
  agentWaiting: boolean
  sending: boolean
  comments: ReviewComment[]
  onEditComment: (id: string, body: string) => void
  onDeleteComment: (id: string) => void
}

interface ThemeOption {
  id: string
  name: string
  type: 'dark' | 'light'
  colors: { bg: string; secondary: string; accent: string }
}

const THEMES: ThemeOption[] = [
  { id: 'nord', name: 'Nord (Main)', type: 'dark', colors: { bg: '#2e3440', secondary: '#242933', accent: '#88c0d0' } },
  { id: 'github-dark', name: 'GitHub Dark', type: 'dark', colors: { bg: '#0d1117', secondary: '#161b22', accent: '#58a6ff' } },
  { id: 'github-light', name: 'GitHub Light', type: 'light', colors: { bg: '#ffffff', secondary: '#f6f8fa', accent: '#0969da' } },
  { id: 'dracula', name: 'Dracula', type: 'dark', colors: { bg: '#282a36', secondary: '#1e1f29', accent: '#bd93f9' } },
  { id: 'one-dark', name: 'One Dark', type: 'dark', colors: { bg: '#282c34', secondary: '#21252b', accent: '#61afef' } },
  { id: 'synthwave-84', name: 'Synthwave \'84', type: 'dark', colors: { bg: '#2b213a', secondary: '#241b2f', accent: '#f92aad' } },
  { id: 'tokyo-night', name: 'Tokyo Night', type: 'dark', colors: { bg: '#1a1b26', secondary: '#16161e', accent: '#7aa2f7' } },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', type: 'dark', colors: { bg: '#1e1e2e', secondary: '#181825', accent: '#cba6f7' } },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', type: 'light', colors: { bg: '#eff1f5', secondary: '#e6e9ef', accent: '#8839ef' } },
  { id: 'solarized-dark', name: 'Solarized Dark', type: 'dark', colors: { bg: '#002b36', secondary: '#073642', accent: '#268bd2' } },
  { id: 'solarized-light', name: 'Solarized Light', type: 'light', colors: { bg: '#fdf6e3', secondary: '#eee8d5', accent: '#268bd2' } },
  { id: 'monokai', name: 'Monokai', type: 'dark', colors: { bg: '#272822', secondary: '#1d1e19', accent: '#f92672' } },
  { id: 'ayu-dark', name: 'Ayu Dark', type: 'dark', colors: { bg: '#0a0e14', secondary: '#0d1117', accent: '#e6b450' } },
]

const INLINE_DIFF_OPTS = [
  { value: 'word', label: 'Word' },
  { value: 'word-alt', label: 'Word (alt)' },
  { value: 'char', label: 'Character' },
  { value: 'none', label: 'None' },
]
const INDICATOR_OPTS = [
  { value: 'classic', label: 'Classic (+/−)' },
  { value: 'bars', label: 'Bars' },
  { value: 'none', label: 'None' },
]
const HUNK_SEP_OPTS = [
  { value: 'line-info', label: 'Line info + context' },
  { value: 'line-info-basic', label: 'Line info' },
  { value: 'metadata', label: 'Metadata only' },
  { value: 'simple', label: 'Simple' },
]
const HOVER_OPTS = [
  { value: 'both', label: 'Both' },
  { value: 'line', label: 'Line only' },
  { value: 'number', label: 'Number only' },
  { value: 'disabled', label: 'Disabled' },
]
const FONT_SIZE_OPTS = [11, 12, 13, 14, 15, 16].map((n) => ({ value: String(n), label: `${n}px` }))
const TAB_SIZE_OPTS = [2, 4, 8].map((n) => ({ value: String(n), label: String(n) }))
const BROWSER_OPTS = [
  { value: '', label: 'Default' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'edge', label: 'Edge' },
  { value: 'brave', label: 'Brave' },
]
const IDE_OPTS = [
  { value: 'default', label: 'Default / System' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'zed', label: 'Zed' },
  { value: 'vim', label: 'Vim' },
  { value: 'neovim', label: 'Neovim' },
]

export const Toolbar = memo(function Toolbar({
  repoName,
  branch,
  fileCount,
  additions,
  deletions,
  commentCount,
  diffStyle,
  diffOptions,
  defaultTabSize,
  browser,
  theme,
  editorIDE,
  customMode,
  lineDiffType,
  lineWrap,
  diffIndicators,
  showLineNumbers,
  hunkSeparators,
  lineHoverHighlight,
  fontSize,
  haptics,
  sounds,
  onDiffStyleChange,
  onDiffOptionsChange,
  onDefaultTabSizeChange,
  onBrowserChange,
  onThemeChange,
  onEditorIDEChange,
  onLineDiffTypeChange,
  onLineWrapChange,
  onDiffIndicatorsChange,
  onShowLineNumbersChange,
  onHunkSeparatorsChange,
  onLineHoverHighlightChange,
  onFontSizeChange,
  onHapticsChange,
  onSoundsChange,
  onOpenSearch,
  onCopyComments,
  onSendToAgent,
  agentWaiting,
  sending,
  comments,
  onEditComment,
  onDeleteComment,
}: ToolbarProps) {
  const [copied, setCopied] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)

  // Cmd/Ctrl+, opens the settings panel, matching the platform convention for
  // preferences. Works regardless of focus (including inside text fields).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleCopy = async () => {
    await onCopyComments()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <h1 className="toolbar-title">{repoName}</h1>
        {branch && (
          <span className="toolbar-branch">
            <GitBranch size={12} />
            {branch}
          </span>
        )}
        <span className="toolbar-stat">
          {fileCount} file{fileCount !== 1 ? 's' : ''} changed
          {additions > 0 && <span className="stat-additions"> +{additions}</span>}
          {deletions > 0 && <span className="stat-deletions"> -{deletions}</span>}
        </span>
      </div>
      <div className="toolbar-right">
        <button className="btn btn-sm toolbar-search-btn" onClick={onOpenSearch} title="Search (⌘K)">
          <Search size={14} style={{ marginRight: '6px' }} />
          <span>Search</span>
          <kbd className="toolbar-search-kbd">⌘K</kbd>
        </button>
        <div className="toolbar-toggle">
          <button
            className={`btn btn-sm ${diffStyle === 'split' ? 'btn-active' : ''}`}
            onClick={() => onDiffStyleChange('split')}
          >
            Split
          </button>
          <button
            className={`btn btn-sm ${diffStyle === 'unified' ? 'btn-active' : ''}`}
            onClick={() => onDiffStyleChange('unified')}
          >
            Unified
          </button>
        </div>

        {/* Theme picker */}
        <Popover
          open={themeOpen}
          onOpenChange={setThemeOpen}
          ariaLabel="Switch theme"
          className="theme-popover"
          trigger={
            <button className={`btn btn-sm settings-btn flex-1 ${themeOpen ? 'btn-active' : ''}`} title="Switch Theme">
              <Palette size={14} style={{ marginRight: '6px' }} />
              <span>Theme</span>
            </button>
          }
        >
          <div className="popover-scroll">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-item ${theme === t.id ? 'theme-item-active' : ''}`}
                onClick={() => {
                  onThemeChange(t.id)
                  setThemeOpen(false)
                }}
              >
                <span className="theme-item-name">{t.name}</span>
                <span className="theme-swatches">
                  <span className="theme-swatch" style={{ background: t.colors.bg }} />
                  <span className="theme-swatch" style={{ background: t.colors.secondary }} />
                  <span className="theme-swatch" style={{ background: t.colors.accent }} />
                </span>
              </button>
            ))}
          </div>
        </Popover>

        {/* Settings */}
        <Popover
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          ariaLabel="Settings"
          className="settings-popover"
          trigger={
            <button className={`btn btn-sm settings-btn ${settingsOpen ? 'btn-active' : ''}`} title="Settings">
              <Settings size={14} />
            </button>
          }
        >
          <div className="popover-scroll settings-panel">
            {!customMode && (
              <>
                <div className="settings-section-label">Source</div>
                <label className="settings-item">
                  <input
                    type="checkbox"
                    checked={diffOptions.staged}
                    onChange={(e) => onDiffOptionsChange({ ...diffOptions, staged: e.target.checked })}
                  />
                  Show staged
                </label>
                <label className="settings-item">
                  <input
                    type="checkbox"
                    checked={diffOptions.untracked}
                    onChange={(e) => onDiffOptionsChange({ ...diffOptions, untracked: e.target.checked })}
                  />
                  Show untracked
                </label>
              </>
            )}
            <div className="settings-section-label">Display</div>
            <div className="settings-item settings-item-spaced">
              <span>Inline diff</span>
              <Select
                value={lineDiffType}
                onValueChange={(v) => onLineDiffTypeChange(v as LineDiffType)}
                options={INLINE_DIFF_OPTS}
                ariaLabel="Inline diff style"
              />
            </div>
            <label className="settings-item">
              <input type="checkbox" checked={lineWrap} onChange={(e) => onLineWrapChange(e.target.checked)} />
              Wrap long lines
            </label>
            <div className="settings-item settings-item-spaced">
              <span>Diff indicators</span>
              <Select
                value={diffIndicators}
                onValueChange={(v) => onDiffIndicatorsChange(v as DiffIndicators)}
                options={INDICATOR_OPTS}
                ariaLabel="Diff indicators"
              />
            </div>
            <label className="settings-item">
              <input
                type="checkbox"
                checked={showLineNumbers}
                onChange={(e) => onShowLineNumbersChange(e.target.checked)}
              />
              Show line numbers
            </label>
            <div className="settings-item settings-item-spaced">
              <span>Hunk separator</span>
              <Select
                value={hunkSeparators}
                onValueChange={(v) => onHunkSeparatorsChange(v as HunkSeparatorStyle)}
                options={HUNK_SEP_OPTS}
                ariaLabel="Hunk separator style"
              />
            </div>
            <div className="settings-item settings-item-spaced">
              <span>Hover highlight</span>
              <Select
                value={lineHoverHighlight}
                onValueChange={(v) => onLineHoverHighlightChange(v as LineHoverHighlight)}
                options={HOVER_OPTS}
                ariaLabel="Hover highlight"
              />
            </div>
            <div className="settings-item settings-item-spaced">
              <span>Font size</span>
              <Select
                value={String(fontSize)}
                onValueChange={(v) => onFontSizeChange(Number(v))}
                options={FONT_SIZE_OPTS}
                ariaLabel="Font size"
              />
            </div>
            <div className="settings-item settings-item-spaced">
              <span>Default tab size</span>
              <Select
                value={String(defaultTabSize)}
                onValueChange={(v) => onDefaultTabSizeChange(Number(v))}
                options={TAB_SIZE_OPTS}
                ariaLabel="Default tab size"
              />
            </div>
            <div className="settings-section-label">External tools</div>
            <div className="settings-item settings-item-spaced">
              <span>Browser</span>
              <Select
                value={browser || ''}
                onValueChange={onBrowserChange}
                options={BROWSER_OPTS}
                ariaLabel="Browser"
              />
            </div>
            <div className="settings-item settings-item-spaced">
              <span>Preferred IDE</span>
              <Select
                value={editorIDE || 'default'}
                onValueChange={onEditorIDEChange}
                options={IDE_OPTS}
                ariaLabel="Preferred IDE"
              />
            </div>
            <div className="settings-section-label">Feedback</div>
            <label className="settings-item">
              <input
                type="checkbox"
                checked={haptics}
                onChange={(e) => onHapticsChange(e.target.checked)}
              />
              Haptic feedback
            </label>
            <label className="settings-item">
              <input
                type="checkbox"
                checked={sounds}
                onChange={(e) => onSoundsChange(e.target.checked)}
              />
              Sound effects
            </label>
          </div>
        </Popover>
        <button className="btn btn-sm" onClick={handleCopy} disabled={commentCount === 0}>
          {copied ? 'Copied!' : `Copy comments (${commentCount})`}
        </button>
        <SendReviewPopover
          comments={comments}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onSend={onSendToAgent}
          sending={sending}
          agentWaiting={agentWaiting}
        />
      </div>
    </div>
  )
})
