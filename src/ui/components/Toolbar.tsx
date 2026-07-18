import { memo } from 'react'
import {
  GitBranch,
  Search,
  ClipboardList,
  Menu,
  CheckCheck,
} from 'lucide-react'
import type { DiffOptions } from '../hooks/useDiff'
import type {
  LineDiffType,
  DiffIndicators,
  HunkSeparatorStyle,
  LineHoverHighlight,
} from '../hooks/useSettings'
import { SendReviewPopover } from '../components/SendReviewPopover'
import { ReviewHistoryPopover } from '../components/ReviewHistoryPopover'
import { BrandMark } from './BrandMark'
import { ReviewSettingsPopover } from './ReviewSettingsPopover'
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
  ignoreSpaceChange: boolean
  ignoreAllSpace: boolean
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
  onIgnoreSpaceChange: (v: boolean) => void
  onIgnoreAllSpaceChange: (v: boolean) => void
  onResolveAllOpen: () => void
  onOpenUiFontModal: () => void
  onOpenMonoFontModal: () => void
  onOpenSearch: () => void
  onCopyComments: () => Promise<void>
  onCopyMarkdown?: () => Promise<void>
  onSendToAgent: (decision: ReviewDecision, generalComment?: string, mode?: ReviewMode) => Promise<unknown>
  agentWaiting: boolean
  waitingAgents?: Array<{ id: string; model?: string; label?: string; connectedAt: number }>
  sending: boolean
  comments: ReviewComment[]
  viewedFileCount: number
  onEditComment: (id: string, body: string) => void
  onDeleteComment: (id: string) => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}
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
  ignoreSpaceChange,
  ignoreAllSpace,
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
  onIgnoreSpaceChange,
  onIgnoreAllSpaceChange,
  onResolveAllOpen,
  onOpenUiFontModal,
  onOpenMonoFontModal,
  onOpenSearch,
  onCopyComments,
  onCopyMarkdown,
  onSendToAgent,
  agentWaiting,
  waitingAgents = [],
  sending,
  comments,
  viewedFileCount,
  onEditComment,
  onDeleteComment,
  sidebarCollapsed,
  onToggleSidebar,
}: ToolbarProps) {
  const filesLabel = showMode
    ? `${showCommitCount} commit${showCommitCount === 1 ? '' : 's'}`
    : fileCount === totalFileCount
      ? `${fileCount} file${fileCount !== 1 ? 's' : ''}`
      : `${fileCount}/${totalFileCount} files`

  return (
    <header className="toolbar diff-app-toolbar" role="banner">
      <div className="toolbar-left">
        {onToggleSidebar && (
          <button
            className="toolbar-mobile-toggle"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? 'Open file tree' : 'Close file tree'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'Open sidebar · b' : 'Close sidebar · b'}
          >
            <Menu size={18} />
          </button>
        )}
        <div className="toolbar-brand">
          <BrandMark size={20} className="toolbar-brand-mark" />
          <div className="toolbar-brand-text">
            <h1 className="toolbar-title">{repoName || 'diffing'}</h1>
            {branch && (
              <span className="toolbar-branch-inline" title={branch}>
                <GitBranch size={11} aria-hidden="true" />
                {branch}
              </span>
            )}
          </div>
        </div>
        <div className="toolbar-meta" aria-label="Diff summary">
          <span className="toolbar-chip">{filesLabel}</span>
          {(additions > 0 || deletions > 0) && (
            <span className="toolbar-chip toolbar-chip-diff">
              {additions > 0 && <span className="stat-additions">+{additions}</span>}
              {deletions > 0 && <span className="stat-deletions">−{deletions}</span>}
            </span>
          )}
          {commentCount > 0 && (
            <span className="toolbar-chip toolbar-chip-comments">
              {commentCount} open
            </span>
          )}
          {lastSend && lastSend.round > 0 && (
            <ReviewHistoryPopover lastRound={lastSend.round} />
          )}
        </div>
      </div>

      <div className="toolbar-right">
        <button
          className="btn btn-sm toolbar-search-btn"
          onClick={onOpenSearch}
          title="Search files, text, symbols (⌘K)"
          aria-label="Search"
        >
          <Search size={14} />
          <span className="btn-label">Search</span>
          <kbd className="toolbar-search-kbd">⌘K</kbd>
        </button>
        {planCount > 0 && (
          <button
            className={`btn btn-sm toolbar-plans-btn ${pendingPlanCount > 0 ? 'toolbar-plans-btn-pending' : ''}`}
            onClick={onOpenPlans}
            title={
              pendingPlanCount > 0
                ? `${pendingPlanCount} plan${pendingPlanCount === 1 ? '' : 's'} awaiting review`
                : 'Open plan review'
            }
          >
            {pendingPlanCount > 0 && <span className="agent-waiting-dot" aria-hidden="true" />}
            <ClipboardList size={14} />
            <span className="btn-label">Plans</span>
            {pendingPlanCount > 0 && (
              <span className="toolbar-plans-badge">{pendingPlanCount}</span>
            )}
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
            title="Resolve all open comments"
          >
            <CheckCheck size={14} />
            <span className="btn-label">Resolve all</span>
          </button>
        )}

        <ReviewSettingsPopover
          diffStyle={diffStyle}
          diffOptions={diffOptions}
          defaultTabSize={defaultTabSize}
          browser={browser}
          editorIDE={editorIDE}
          lineDiffType={lineDiffType}
          lineWrap={lineWrap}
          diffIndicators={diffIndicators}
          showLineNumbers={showLineNumbers}
          hunkSeparators={hunkSeparators}
          lineHoverHighlight={lineHoverHighlight}
          fontSize={fontSize}
          haptics={haptics}
          sounds={sounds}
          uiFont={uiFont}
          monoFont={monoFont}
          density={density}
          autoCollapseLineThreshold={autoCollapseLineThreshold}
          requireViewAllBeforeSend={requireViewAllBeforeSend}
          showStatusBar={showStatusBar}
          ignoreSpaceChange={ignoreSpaceChange}
          ignoreAllSpace={ignoreAllSpace}
          onDiffStyleChange={onDiffStyleChange}
          onDiffOptionsChange={onDiffOptionsChange}
          onDefaultTabSizeChange={onDefaultTabSizeChange}
          onBrowserChange={onBrowserChange}
          onOpenThemeModal={onOpenThemeModal}
          onEditorIDEChange={onEditorIDEChange}
          onLineDiffTypeChange={onLineDiffTypeChange}
          onLineWrapChange={onLineWrapChange}
          onDiffIndicatorsChange={onDiffIndicatorsChange}
          onShowLineNumbersChange={onShowLineNumbersChange}
          onHunkSeparatorsChange={onHunkSeparatorsChange}
          onLineHoverHighlightChange={onLineHoverHighlightChange}
          onFontSizeChange={onFontSizeChange}
          onHapticsChange={onHapticsChange}
          onSoundsChange={onSoundsChange}
          onDensityChange={onDensityChange}
          onAutoCollapseLineThresholdChange={onAutoCollapseLineThresholdChange}
          onRequireViewAllBeforeSendChange={onRequireViewAllBeforeSendChange}
          onShowStatusBarChange={onShowStatusBarChange}
          onIgnoreSpaceChange={onIgnoreSpaceChange}
          onIgnoreAllSpaceChange={onIgnoreAllSpaceChange}
          onOpenUiFontModal={onOpenUiFontModal}
          onOpenMonoFontModal={onOpenMonoFontModal}
          showSource={!customMode}
        />
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
          waitingAgents={waitingAgents}
          onCopyComments={onCopyComments}
          onCopyMarkdown={onCopyMarkdown}
        />
      </div>
    </header>
  )
})
