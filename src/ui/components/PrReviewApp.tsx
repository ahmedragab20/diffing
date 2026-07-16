import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { parsePatchFiles, preloadHighlighter } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import { useWorkerPool } from '@pierre/diffs/react'
import {
  ArrowLeft,
  GitCompare,
  GitPullRequest,
  ExternalLink,
  RefreshCw,
  MessageCircle,
} from 'lucide-react'
import { useDiff } from '../hooks/useDiff'
import {
  usePrSession,
  usePrComments,
  useRefreshPrSession,
} from '../hooks/usePrSession'
import type { PrExistingComment } from '../../lib/pr-session'
import { useSettings } from '../hooks/useSettings'
import { useApplyFonts } from '../hooks/useApplyFonts'
import { useViewed } from '../hooks/useViewed'
import { navigate } from '../router'
import { getUiStateItem, setUiStateItem } from '../utils/uiState'
import { DiffViewer } from './DiffViewer'
import { FileTree } from './FileTree'
import { CommentTracker } from './CommentTracker'
import { SubmitToGitHubPopover } from './SubmitToGitHubPopover'
import { PrSubmittedToast } from './PrSubmittedToast'
import { formatComments } from '../../lib/comment-format'
import { Copy } from 'lucide-react'

/**
 * Top-level surface for the `/gh/pr` route. Renders the PR diff with the
 * existing local diff machinery, but uses a lean header (no settings popover,
 * no plans button, no staged/untracked toggles) and a "Submit to GitHub"
 * action that POSTs the in-progress review to GitHub's REST API.
 *
 * The "Send to agent" popover is deliberately absent — the local review
 * flow and the PR flow never share an outbound channel.
 */
export function PrReviewApp() {
  const poolManager = useWorkerPool()
  const { settings, loaded } = useSettings()
  useApplyFonts(loaded, settings.uiFont, settings.monoFont)
  const { session, loaded: sessionLoaded } = usePrSession()
  const refreshPr = useRefreshPrSession()
  const {
    comments,
    addComment,
    removeComment,
    updateComment,
    addReply,
  } = usePrComments(sessionLoaded && !!session)
  const {
    patch,
    loading,
    error,
  } = useDiff({ staged: false, untracked: false }, sessionLoaded && !!session)
  const { viewedFiles, setViewed } = useViewed()

  useEffect(() => {
    preloadHighlighter().catch(() => {})
  }, [])

  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const stored = getUiStateItem('diffing-sidebar-collapsed')
      if (stored != null) return stored === 'true'
    } catch {}
    return typeof window !== 'undefined' && window.innerWidth <= 768
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const stored = getUiStateItem('diffing-sidebar-width')
      return stored ? Number(stored) : 320
    } catch {
      return 320
    }
  })
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  const appRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarGuideRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      setUiStateItem('diffing-sidebar-collapsed', String(sidebarCollapsed))
    } catch {}
  }, [sidebarCollapsed])

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidthRef.current
    const sidebarEl = sidebarRef.current
    const guideEl = sidebarGuideRef.current
    const sidebarLeft = sidebarEl ? sidebarEl.getBoundingClientRect().left : 0
    let latestWidth = startWidth
    let rafId = 0

    const flush = () => {
      rafId = 0
      if (guideEl) guideEl.style.transform = `translateX(${sidebarLeft + latestWidth}px)`
    }

    if (guideEl) {
      guideEl.style.transform = `translateX(${sidebarLeft + startWidth}px)`
      guideEl.classList.add('sidebar-resize-guide-active')
    }

    const handleMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      latestWidth = Math.max(240, Math.min(640, startWidth + delta))
      if (!rafId) rafId = requestAnimationFrame(flush)
    }
    const handleUp = () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (guideEl) guideEl.classList.remove('sidebar-resize-guide-active')
      setSidebarWidth(latestWidth)
      try { setUiStateItem('diffing-sidebar-width', String(latestWidth)) } catch {}
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const files = useMemo<FileDiffMetadata[]>(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      return parsed.flatMap((p) => p.files)
    } catch {
      return []
    }
  }, [patch])

  const existingCommentsByFile = useMemo(() => {
    const map = new Map<string, PrExistingComment[]>()
    if (!session) return map
    for (const c of session.existingComments ?? []) {
      const list = map.get(c.path) ?? []
      list.push(c)
      map.set(c.path, list)
    }
    return map
  }, [session])

  const fileAnnotations = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const c of comments) {
      const list = map.get(c.filePath) ?? []
      list.push({ side: c.side, lineNumber: c.lineNumber, metadata: c })
      map.set(c.filePath, list)
    }
    return map
  }, [comments])

  const totalExisting = session?.existingComments?.length ?? 0

  // ── Empty / loading / error states ──

  if (sessionLoaded && !session) {
    return (
      <div className="pr-app-empty">
        <GitPullRequest size={32} />
        <h2>No active PR session</h2>
        <p>
          Start one with <code>diffing "gh pr 1234"</code> or{' '}
          <code>diffing --gh-pr 1234</code> from inside the repo.
        </p>
        <button className="btn btn-sm" onClick={() => navigate('/')}>
          Back to local review
        </button>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="pr-app-empty">
        <span>Loading PR session…</span>
      </div>
    )
  }

  return (
    <div ref={appRef} className="app pr-app" data-pr-mode="true">
      {/* PR-specific header — minimal, no local settings popover. */}
      <header className="pr-header">
        <div className="pr-header-left">
          <GitPullRequest size={16} aria-hidden="true" />
          <strong className="pr-header-ref">
            {session.owner}/{session.repo}#{session.pullNumber}
          </strong>
          <span className="pr-header-title">{session.title}</span>
        </div>
        <div className="pr-header-right">
          <span
            className="pr-header-stat"
            title={`+${session.additions} -${session.deletions} across ${session.changedFiles} files`}
          >
            +{session.additions} −{session.deletions} · {session.changedFiles} files
          </span>
          <button
            className="btn btn-sm pr-header-copy"
            onClick={async () => {
              await navigator.clipboard.writeText(formatComments(comments))
            }}
            disabled={comments.length === 0}
            title="Copy new comments as Markdown"
          >
            <Copy size={12} />
            <span className="btn-label">Copy</span>
          </button>
          <button
            className="btn btn-sm pr-header-refresh"
            onClick={() => refreshPr.mutate()}
            disabled={refreshPr.isPending}
            title="Re-fetch PR metadata from GitHub"
          >
            <RefreshCw size={12} className={refreshPr.isPending ? 'spinning' : ''} />
            <span className="btn-label">{refreshPr.isPending ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          <a
            className="btn btn-sm pr-header-link"
            href={session.url}
            target="_blank"
            rel="noreferrer"
            title="Open on GitHub"
          >
            <ExternalLink size={12} />
            <span className="btn-label">Open</span>
          </a>
          <SubmitToGitHubPopover
            session={session}
            comments={comments}
            onEditComment={(id, body) => updateComment({ id, body })}
            onDeleteComment={removeComment}
          />
        </div>
      </header>

      {totalExisting > 0 && (
        <div className="pr-existing-summary">
          <MessageCircle size={12} />
          <span>
            {totalExisting} existing review comment{totalExisting === 1 ? '' : 's'} on
            this PR (read-only context, only your new comments will be posted).
          </span>
        </div>
      )}

      {error && (
        <div className="pr-error">Failed to load the PR diff: {error}</div>
      )}

      <div
        className="app-body"
        style={{
          gridTemplateColumns: sidebarCollapsed ? '0 1fr' : `${sidebarWidth}px 1fr`,
        }}
      >
        <aside
          ref={sidebarRef}
          className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
          style={sidebarCollapsed ? { width: 0, display: 'none' } : { width: sidebarWidth }}
        >
          <FileTree
            files={files}
            activeFile={activeFile}
            setActiveFile={setActiveFile}
            commentCounts={{}}
            existingCommentCounts={Object.fromEntries(
              [...existingCommentsByFile.entries()].map(([k, v]) => [k, v.length]),
            )}
          />
          <div
            className="sidebar-resize-handle"
            onMouseDown={handleSidebarResizeStart}
            title="Drag to resize"
          />
        </aside>
        <main className="main">
          {loading && !patch ? (
            <div className="pr-app-loading">Loading PR diff…</div>
          ) : files.length === 0 ? (
            <div className="empty-state" role="status">
              <div className="empty-state-icon" aria-hidden="true">
                <GitCompare size={24} strokeWidth={1.75} />
              </div>
              <p className="empty-state-title">All clean</p>
              <p className="empty-state-hint">No changes found in this PR.</p>
            </div>
          ) : (
            <PrDiffSurface
              files={files}
              fileAnnotations={fileAnnotations}
              existingCommentsByFile={existingCommentsByFile}
              viewedFiles={viewedFiles}
              settings={settings}
              onAddComment={(params) =>
                addComment({
                  filePath: params.filePath,
                  side: params.side,
                  lineNumber: params.lineNumber,
                  startLineNumber: params.startLineNumber,
                  lineContent: params.lineContent,
                  body: params.body,
                })
              }
              onReplyComment={(commentId, body) => addReply({ id: commentId, body })}
              onEditComment={(commentId, body) => updateComment({ id: commentId, body })}
              onDeleteComment={removeComment}
              onViewedChange={setViewed}
            />
          )}
        </main>
      </div>

      <div className="sidebar-resize-guide" ref={sidebarGuideRef} aria-hidden="true" />

      <CommentTracker
        comments={comments}
        files={files}
        activeFile={activeFile}
        onSetActiveFile={setActiveFile}
        onEditComment={(id, body) => updateComment({ id, body })}
        onDeleteComment={removeComment}
        onAddReply={(id, body) => addReply({ id, body })}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />

      {session.submittedAt && <PrSubmittedToast session={session} />}

      <button
        className="pr-back-button"
        onClick={() => navigate('/')}
        title="Back to local review"
      >
        <ArrowLeft size={14} />
        <span>Back to local</span>
      </button>
    </div>
  )
}

/**
 * Lightweight diff surface that reuses the existing FileDiffCard machinery
 * via the shared DiffViewer. Existing PR comments are rendered as a small
 * inline strip *below* the file card, not as diff-line annotations (the
 * `@pierre/diffs` annotation API doesn't support read-only decorations well).
 */
function PrDiffSurface({
  files,
  fileAnnotations,
  existingCommentsByFile,
  viewedFiles,
  settings,
  onAddComment,
  onReplyComment,
  onEditComment,
  onDeleteComment,
  onViewedChange,
}: {
  files: FileDiffMetadata[]
  fileAnnotations: Map<string, any[]>
  existingCommentsByFile: Map<string, PrExistingComment[]>
  viewedFiles: Set<string>
  settings: any
  onAddComment: (params: any) => void
  onReplyComment: (commentId: string, body: string) => void
  onEditComment: (commentId: string, body: string) => void
  onDeleteComment: (commentId: string) => void
  onViewedChange: (filePath: string, viewed: boolean) => void
}) {
  return (
    <div className="pr-diff-surface">
      {files.map((file, index) => {
        const filePath = file.name
        const existing = existingCommentsByFile.get(filePath) ?? []
        return (
          <div key={`${filePath}-${index}`} className="pr-file-block">
            <DiffViewer
              files={[file]}
              diffStyle={'unified'}
              tabSizeMap={{}}
              defaultTabSize={4}
              viewedFiles={viewedFiles}
              binaryFiles={new Map()}
              theme={settings.theme ?? 'github-dark'}
              lineDiffType={'none'}
              lineWrap={false}
              diffIndicators={'none'}
              showLineNumbers={true}
              hunkSeparators={'line-numbers'}
              lineHoverHighlight={'none'}
              fontSize={settings.fontSize ?? 13}
              monoFontFamily={settings.monoFont ?? 'ui-monospace, SFMono-Regular, Menlo, monospace'}
              expandContextByDefault={false}
              collapsedContextThreshold={Number.MAX_SAFE_INTEGER}
              expansionLineCount={0}
              autoCollapseLineThreshold={0}
              onViewedChange={onViewedChange}
              fileAnnotationsMap={new Map([[filePath, fileAnnotations.get(filePath) ?? []]])}
              onAddComment={(...args) => {
                const [path, side, lineNumber, lineContent, body, startLineNumber] = args
                onAddComment({ filePath: path, side, lineNumber, lineContent, body, startLineNumber })
              }}
              onDeleteComment={onDeleteComment}
            />
            {existing.length > 0 && (
              <div className="pr-existing-strip">
                <div className="pr-existing-strip-head">
                  <MessageCircle size={11} />
                  <span>
                    {existing.length} existing comment{existing.length === 1 ? '' : 's'} on this file
                  </span>
                </div>
                <ul className="pr-existing-strip-list">
                  {existing.map((c) => (
                    <li key={c.id} className="pr-existing-strip-item">
                      <div className="pr-existing-strip-meta">
                        <strong>@{c.author?.login ?? 'unknown'}</strong>
                        <span className="pr-existing-strip-line">
                          {c.line != null ? `:${c.line}` : '· file'}
                        </span>
                        {c.state && (
                          <span className={`pr-existing-strip-state pr-state-${c.state.toLowerCase()}`}>
                            {c.state.toLowerCase().replace('_', ' ')}
                          </span>
                        )}
                        {c.replies.length > 0 && (
                          <span className="pr-existing-strip-replies">
                            +{c.replies.length} repl{c.replies.length === 1 ? 'y' : 'ies'}
                          </span>
                        )}
                      </div>
                      <p className="pr-existing-strip-body">{c.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
