import { useState, useRef, useEffect, memo } from 'react'
import { GitBranch, Settings, Palette } from 'lucide-react'
import type { DiffOptions } from '../hooks/useDiff'

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
  onDiffStyleChange: (style: 'split' | 'unified') => void
  onDiffOptionsChange: (options: DiffOptions) => void
  onDefaultTabSizeChange: (size: number) => void
  onBrowserChange: (browser: string) => void
  onThemeChange: (theme: string) => void
  onEditorIDEChange: (editor: string) => void
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
  onDiffStyleChange,
  onDiffOptionsChange,
  onDefaultTabSizeChange,
  onBrowserChange,
  onThemeChange,
  onEditorIDEChange,
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
            <div className="settings-menu" style={{ minWidth: '180px' }}>
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
            <div className="settings-menu">
              {!customMode && (
                <>
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
              <div className="settings-item settings-item-spaced">
                <span>Browser</span>
                <select
                  className="settings-select"
                  value={browser || ''}
                  onChange={(e) => {
                    onBrowserChange(e.target.value)
                    setSettingsOpen(false)
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
                    setSettingsOpen(false)
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
