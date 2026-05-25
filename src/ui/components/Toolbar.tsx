import { useState, useRef, useEffect, memo } from 'react'
import { GitBranch, Settings, Palette } from 'lucide-react'
import type { DiffOptions } from '../hooks/useDiff'
import type {
  LineDiffType,
  DiffIndicators,
  HunkSeparatorStyle,
  LineHoverHighlight,
} from '../hooks/useSettings'

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
  onCopyComments: () => Promise<void>
}

interface ThemeOption {
  id: string
  name: string
  type: 'dark' | 'light'
  colors: {
    bg: string
    secondary: string
    accent: string
  }
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
  onCopyComments,
}: ToolbarProps) {
  const [copied, setCopied] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const themeRef = useRef<HTMLDivElement>(null)

  const handleCopy = async () => {
    await onCopyComments()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    if (settingsOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [settingsOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeOpen(false)
      }
    }
    if (themeOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [themeOpen])

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

        {/* Theme Picker Dropdown */}
        <div className="settings-wrapper" ref={themeRef}>
          <button
            className={`btn btn-sm settings-btn ${themeOpen ? 'btn-active' : ''}`}
            onClick={() => setThemeOpen(!themeOpen)}
            title="Switch Theme"
          >
            <Palette size={14} style={{ marginRight: '6px' }} />
            <span>Theme</span>
          </button>
          {themeOpen && (
            <div className="settings-menu" style={{ minWidth: '200px', maxHeight: '420px', overflowY: 'auto' }}>
              {THEMES.map((t) => (
                <div
                  key={t.id}
                  className={`settings-item settings-item-spaced ${theme === t.id ? 'btn-active' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    margin: '2px 6px',
                  }}
                  onClick={() => {
                    onThemeChange(t.id)
                    setThemeOpen(false)
                  }}
                >
                  <span style={{ fontWeight: theme === t.id ? '700' : '500' }}>{t.name}</span>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span
                      style={{
                        display: 'block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: t.colors.bg,
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    />
                    <span
                      style={{
                        display: 'block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: t.colors.secondary,
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    />
                    <span
                      style={{
                        display: 'block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: t.colors.accent,
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Settings Dropdown */}
        <div className="settings-wrapper" ref={settingsRef}>
          <button
            className={`btn btn-sm settings-btn ${settingsOpen ? 'btn-active' : ''}`}
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Settings"
          >
            <Settings size={14} />
          </button>
          {settingsOpen && (
            <div className="settings-menu" style={{ minWidth: '260px', maxHeight: '70vh', overflowY: 'auto' }}>
              {!customMode && (
                <>
                  <div className="settings-section-label">Source</div>
                  <label className="settings-item">
                    <input
                      type="checkbox"
                      checked={diffOptions.staged}
                      onChange={(e) =>
                        onDiffOptionsChange({ ...diffOptions, staged: e.target.checked })
                      }
                    />
                    Show staged
                  </label>
                  <label className="settings-item">
                    <input
                      type="checkbox"
                      checked={diffOptions.untracked}
                      onChange={(e) =>
                        onDiffOptionsChange({ ...diffOptions, untracked: e.target.checked })
                      }
                    />
                    Show untracked
                  </label>
                </>
              )}
              <div className="settings-section-label">Display</div>
              <div className="settings-item settings-item-spaced">
                <span>Inline diff</span>
                <select
                  className="settings-select"
                  value={lineDiffType}
                  onChange={(e) => onLineDiffTypeChange(e.target.value as LineDiffType)}
                  title="Inline change highlighting style"
                >
                  <option value="word">Word</option>
                  <option value="word-alt">Word (alt)</option>
                  <option value="char">Character</option>
                  <option value="none">None</option>
                </select>
              </div>
              <label className="settings-item">
                <input
                  type="checkbox"
                  checked={lineWrap}
                  onChange={(e) => onLineWrapChange(e.target.checked)}
                />
                Wrap long lines
              </label>
              <div className="settings-item settings-item-spaced">
                <span>Diff indicators</span>
                <select
                  className="settings-select"
                  value={diffIndicators}
                  onChange={(e) => onDiffIndicatorsChange(e.target.value as DiffIndicators)}
                >
                  <option value="classic">Classic (+/−)</option>
                  <option value="bars">Bars</option>
                  <option value="none">None</option>
                </select>
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
                <select
                  className="settings-select"
                  value={hunkSeparators}
                  onChange={(e) => onHunkSeparatorsChange(e.target.value as HunkSeparatorStyle)}
                  title="How dividers between hunks are styled"
                >
                  <option value="line-info">Line info + context</option>
                  <option value="line-info-basic">Line info</option>
                  <option value="metadata">Metadata only</option>
                  <option value="simple">Simple</option>
                </select>
              </div>
              <div className="settings-item settings-item-spaced">
                <span>Hover highlight</span>
                <select
                  className="settings-select"
                  value={lineHoverHighlight}
                  onChange={(e) => onLineHoverHighlightChange(e.target.value as LineHoverHighlight)}
                >
                  <option value="both">Both</option>
                  <option value="line">Line only</option>
                  <option value="number">Number only</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="settings-item settings-item-spaced">
                <span>Font size</span>
                <select
                  className="settings-select"
                  value={fontSize}
                  onChange={(e) => onFontSizeChange(Number(e.target.value))}
                >
                  <option value={11}>11px</option>
                  <option value={12}>12px</option>
                  <option value={13}>13px</option>
                  <option value={14}>14px</option>
                  <option value={15}>15px</option>
                  <option value={16}>16px</option>
                </select>
              </div>
              <div className="settings-item settings-item-spaced">
                <span>Default tab size</span>
                <select
                  className="settings-select"
                  value={defaultTabSize}
                  onChange={(e) => onDefaultTabSizeChange(Number(e.target.value))}
                >
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                </select>
              </div>
              <div className="settings-section-label">External tools</div>
              <div className="settings-item settings-item-spaced">
                <span>Browser</span>
                <select
                  className="settings-select"
                  value={browser || ''}
                  onChange={(e) => {
                    onBrowserChange(e.target.value)
                  }}
                >
                  <option value="">Default</option>
                  <option value="chrome">Chrome</option>
                  <option value="firefox">Firefox</option>
                  <option value="edge">Edge</option>
                  <option value="brave">Brave</option>
                </select>
              </div>
              <div className="settings-item settings-item-spaced">
                <span>Preferred IDE</span>
                <select
                  className="settings-select"
                  value={editorIDE || 'default'}
                  onChange={(e) => {
                    onEditorIDEChange(e.target.value)
                  }}
                >
                  <option value="default">Default / System</option>
                  <option value="vscode">VS Code</option>
                  <option value="zed">Zed</option>
                  <option value="vim">Vim</option>
                  <option value="neovim">Neovim</option>
                </select>
              </div>
            </div>
          )}
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleCopy}
          disabled={commentCount === 0}
        >
          {copied ? 'Copied!' : `Copy comments (${commentCount})`}
        </button>
      </div>
    </div>
  )
})
