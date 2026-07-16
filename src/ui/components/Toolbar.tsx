import { useState, useEffect, memo } from 'react'
import { GitBranch, Settings, Palette, Search, ClipboardList, Type, Menu, LayoutGrid, Sparkles, CheckCheck } from 'lucide-react'
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
import type { ReviewComment, ReviewDecision, ReviewMode } from '../../lib/types'

interface LastSendSummary {
  round: number
  sentAt: number
  decision?: 'approved' | 'changes-requested' | 'rejected' | 'comment-only'
  openCount: number | null
}

interface ToolbarProps {
  repoName: string
  branch: string
  fileCount: number
  totalFileCount: number
  additions: number
  deletions: number
  commentCount: number
  planCount: number
  pendingPlanCount: number
  lastSend: LastSendSummary | null
  onOpenPlans: () => void
  diffStyle: 'split' | 'unified'
  diffOptions: DiffOptions
  defaultTabSize: number
  browser?: string
  theme: string
  editorIDE?: string
  customMode: boolean
  showMode: boolean
  showCommitCount: number
  lineDiffType: LineDiffType
  lineWrap: boolean
  diffIndicators: DiffIndicators
  showLineNumbers: boolean
  hunkSeparators: HunkSeparatorStyle
  lineHoverHighlight: LineHoverHighlight
  fontSize: number
  haptics: boolean
  sounds: boolean
  uiFont?: string | null
  monoFont?: string | null
  density: 'comfortable' | 'compact'
  autoCollapseLineThreshold: number
  requireViewAllBeforeSend: boolean
  showStatusBar: boolean
  onDiffStyleChange: (style: 'split' | 'unified') => void
  onDiffOptionsChange: (options: DiffOptions) => void
  onDefaultTabSizeChange: (size: number) => void
  onBrowserChange: (browser: string) => void
  onOpenThemeModal: () => void
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
  onDensityChange: (v: 'comfortable' | 'compact') => void
  onAutoCollapseLineThresholdChange: (v: number) => void
  onRequireViewAllBeforeSendChange: (v: boolean) => void
  onShowStatusBarChange: (v: boolean) => void
  onResolveAllOpen: () => void
  onOpenUiFontModal: () => void
  onOpenMonoFontModal: () => void
  onOpenSearch: () => void
  onCopyComments: () => Promise<void>
  onSendToAgent: (decision: ReviewDecision, generalComment?: string, mode?: ReviewMode) => Promise<unknown>
  agentWaiting: boolean
  sending: boolean
  comments: ReviewComment[]
  viewedFileCount: number
  onEditComment: (id: string, body: string) => void
  onDeleteComment: (id: string) => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}



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
const DENSITY_OPTS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]
const AUTO_COLLAPSE_OPTS: { value: string; label: string }[] = [
  { value: '0', label: 'Disabled' },
  { value: '100', label: '100 lines' },
  { value: '200', label: '200 lines' },
  { value: '400', label: '400 lines' },
  { value: '800', label: '800 lines' },
] as const
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
  totalFileCount,
  additions,
  deletions,
  commentCount,
  planCount,
  pendingPlanCount,
  lastSend,
  onOpenPlans,
  diffStyle,
  diffOptions,
  defaultTabSize,
  browser,
  theme,
  editorIDE,
  customMode,
  showMode,
  showCommitCount,
  lineDiffType,
  lineWrap,
  diffIndicators,
  showLineNumbers,
  hunkSeparators,
  lineHoverHighlight,
  fontSize,
  haptics,
  sounds,
  uiFont,
  monoFont,
  density,
  autoCollapseLineThreshold,
  requireViewAllBeforeSend,
  showStatusBar,
  onDiffStyleChange,
  onDiffOptionsChange,
  onDefaultTabSizeChange,
  onBrowserChange,
  onOpenThemeModal,
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
  onDensityChange,
  onAutoCollapseLineThresholdChange,
  onRequireViewAllBeforeSendChange,
  onShowStatusBarChange,
  onResolveAllOpen,
  onOpenUiFontModal,
  onOpenMonoFontModal,
  onOpenSearch,
  onCopyComments,
  onSendToAgent,
  agentWaiting,
  sending,
  comments,
  viewedFileCount,
  onEditComment,
  onDeleteComment,
  sidebarCollapsed,
  onToggleSidebar,
}: ToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === ',' || e.code === 'Comma')) {
        e.preventDefault()
        setSettingsOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {onToggleSidebar && (
          <button
            className="toolbar-mobile-toggle"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            title={sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
          >
            <Menu size={18} />
          </button>
        )}
        <div className="toolbar-brand">
          <img
            className="toolbar-brand-mark"
            src="/favicon.svg"
            alt=""
            width={22}
            height={22}
            draggable={false}
          />
          <h1 className="toolbar-title">{repoName || 'diffing'}</h1>
        </div>
        {branch && (
          <span className="toolbar-branch">
            <GitBranch size={12} />
            {branch}
          </span>
        )}
        <span className="toolbar-stat">
          {showMode ? (
            <>
              showing{' '}
              <strong className="toolbar-stat-count">
                {showCommitCount}
              </strong>{' '}
              commit{showCommitCount === 1 ? '' : 's'}
              {additions > 0 && <span className="stat-additions"> +{additions}</span>}
              {deletions > 0 && <span className="stat-deletions"> -{deletions}</span>}
            </>
          ) : (
            <>
              {fileCount === totalFileCount ? (
                <>
                  {fileCount} file{fileCount !== 1 ? 's' : ''} changed
                </>
              ) : (
                <>
                  {fileCount} of {totalFileCount} files changed
                </>
              )}
              {additions > 0 && <span className="stat-additions"> +{additions}</span>}
              {deletions > 0 && <span className="stat-deletions"> -{deletions}</span>}
            </>
          )}
        </span>
        {lastSend && lastSend.round > 0 && (
          <span
            className="toolbar-last-send"
            title={
              lastSend.decision
                ? `Round ${lastSend.round} · ${lastSend.decision} · ${lastSend.openCount == null ? '?' : lastSend.openCount} open · sent ${new Date(lastSend.sentAt).toLocaleString()}`
                : `Round ${lastSend.round} · sent ${new Date(lastSend.sentAt).toLocaleString()}`
            }
          >
            <span className="toolbar-last-send-dot" aria-hidden="true" />
            Round {lastSend.round}
            {lastSend.decision && (
              <span className="toolbar-last-send-decision" data-decision={lastSend.decision}>
                {' · '}
                {lastSend.decision}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="toolbar-right">
        <button className="btn btn-sm toolbar-search-btn" onClick={onOpenSearch} title="Search (⌘K)">
          <Search size={14} style={{ marginRight: '6px' }} />
          <span>Search</span>
          <kbd className="toolbar-search-kbd">⌘K</kbd>
        </button>
        {planCount > 0 && (
          <button
            className={`btn btn-sm toolbar-plans-btn ${pendingPlanCount > 0 ? 'toolbar-plans-btn-pending' : ''}`}
            onClick={onOpenPlans}
            title={
              pendingPlanCount > 0
                ? `${pendingPlanCount} plan${pendingPlanCount === 1 ? '' : 's'} awaiting your review`
                : 'Review agent plans'
            }
          >
            {pendingPlanCount > 0 && <span className="agent-waiting-dot" aria-hidden="true" />}
            <ClipboardList size={14} style={{ marginRight: '6px' }} />
            <span>Plans</span>
            {pendingPlanCount > 0 && <span className="toolbar-plans-badge">{pendingPlanCount}</span>}
          </button>
        )}

        {commentCount > 0 && (
          <button
            className="btn btn-sm toolbar-resolve-all-btn"
            onClick={() => {
              if (typeof window === 'undefined') return
              if (
                window.confirm(
                  `Resolve all ${commentCount} open comment${commentCount === 1 ? '' : 's'}? ` +
                    'This marks every open thread as resolved in one move.',
                )
              ) {
                onResolveAllOpen()
              }
            }}
            title="Mark every open comment as resolved"
          >
            <CheckCheck size={14} style={{ marginRight: '6px' }} />
            <span>Resolve all</span>
          </button>
        )}


        {/* Settings */}
        <Popover
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          ariaLabel="Settings"
          className="settings-popover"
          trigger={
          <button className={`btn btn-sm settings-btn ${settingsOpen ? 'btn-active' : ''}`} title="Settings">
            <Settings size={14} /> <span className="btn-label">Settings</span>
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
            <label className="settings-item">
              <input
                type="checkbox"
                checked={showStatusBar}
                onChange={(e) => onShowStatusBarChange(e.target.checked)}
              />
              Show status bar
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
            <div className="settings-item settings-item-spaced">
              <span>UI font</span>
              <button
                className="btn btn-sm settings-btn"
                onClick={() => { setSettingsOpen(false); onOpenUiFontModal() }}
                style={{ display: 'inline-flex', alignItems: 'center' }}
                title={uiFont ?? 'Default (Geist Mono)'}
              >
                <Type size={13} style={{ marginRight: '4px' }} />
                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {uiFont ?? 'Default…'}
                </span>
              </button>
            </div>
            <div className="settings-section-label">Comfort</div>
            <div className="settings-item settings-item-spaced">
              <span>Density</span>
              <Select
                value={density}
                onValueChange={(v) => onDensityChange(v as 'comfortable' | 'compact')}
                options={DENSITY_OPTS}
                ariaLabel="UI density"
              />
            </div>
            <div className="settings-item settings-item-spaced">
              <span>Auto-collapse huge files</span>
              <Select
                value={String(autoCollapseLineThreshold)}
                onValueChange={(v) => onAutoCollapseLineThresholdChange(Number(v))}
                options={AUTO_COLLAPSE_OPTS}
                ariaLabel="Auto-collapse line threshold"
              />
            </div>
            <label className="settings-item">
              <input
                type="checkbox"
                checked={requireViewAllBeforeSend}
                onChange={(e) => onRequireViewAllBeforeSendChange(e.target.checked)}
              />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={12} aria-hidden="true" />
                Warn before sending if files are unviewed
              </span>
            </label>
            <label className="settings-item">
              <input
                type="checkbox"
                checked={showStatusBar}
                onChange={(e) => onShowStatusBarChange(e.target.checked)}
              />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <LayoutGrid size={12} aria-hidden="true" />
                Show status bar
              </span>
            </label>
            <div className="settings-item settings-item-spaced">
              <span>Code font</span>
              <button
                className="btn btn-sm settings-btn"
                onClick={() => { setSettingsOpen(false); onOpenMonoFontModal() }}
                style={{ display: 'inline-flex', alignItems: 'center' }}
                title={monoFont ?? 'Default (JetBrains Mono)'}
              >
                <Type size={13} style={{ marginRight: '4px' }} />
                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {monoFont ?? 'Default…'}
                </span>
              </button>
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
            <div className="settings-section-label">Review Options</div>
            <div className="settings-item settings-item-spaced">
              <span>Diff style</span>
              <Select
                value={diffStyle}
                onValueChange={(v) => onDiffStyleChange(v as 'split' | 'unified')}
                options={[
                  { value: 'split', label: 'Split' },
                  { value: 'unified', label: 'Unified' },
                ]}
                ariaLabel="Diff style"
              />
            </div>
            <div className="settings-item settings-item-spaced">
              <span>Theme</span>
              <button
                className="btn btn-sm settings-btn"
                onClick={() => {
                  setSettingsOpen(false)
                  onOpenThemeModal()
                }}
                style={{ display: 'inline-flex', alignItems: 'center' }}
              >
                <Palette size={14} style={{ marginRight: '4px' }} />
                <span>Switch Theme...</span>
              </button>
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
        <SendReviewPopover
          comments={comments}
          totalFileCount={totalFileCount}
          viewedFileCount={viewedFileCount}
          requireViewAllBeforeSend={requireViewAllBeforeSend}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onSend={onSendToAgent}
          sending={sending}
          agentWaiting={agentWaiting}
          onCopyComments={onCopyComments}
        />
      </div>
    </div>
  )
})
