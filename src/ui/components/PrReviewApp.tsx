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
import { BrandMark } from './BrandMark'
import { ExistingPrCommentBubble } from './ExistingPrCommentBubble'
import { formatComments } from '../../lib/comment-format'
import { Copy, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

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
  const queryClient = useQueryClient()
  const {
    comments,
    addComment,
    removeComment,
    updateComment,
    addReply,
    resolveComment,
    unresolveComment,
    editComment,
    editReply,
    removeReply,
  } = usePrComments(sessionLoaded && !!session)

  const { data: checksData } = useQuery({
    queryKey: ['pr-checks', session?.headSha],
    queryFn: async () => {
      const res = await fetch('/api/gh/checks')
      if (!res.ok) return null
      return res.json() as Promise<{
        checks: Array<{ name: string; state: string; detailsUrl?: string | null }>
        summary: { total: number; success: number; failure: number; pending: number }
      }>
    },
    enabled: sessionLoaded && !!session,
    staleTime: 30_000,
  })

  const replyToExisting = useCallback(
    async (commentId: number, body: string) => {
      const res = await fetch(`/api/gh/existing-comments/${commentId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      queryClient.invalidateQueries({ queryKey: ['pr-session'] })
    },
    [queryClient],
  )
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

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of comments) {
      counts[c.filePath] = (counts[c.filePath] ?? 0) + 1
    }
    return counts
  }, [comments])

  const emptyUntracked = useMemo(() => new Set<string>(), [])

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
          <BrandMark size={20} className="pr-header-mark" />
          <GitPullRequest size={16} aria-hidden="true" />
          <strong className="pr-header-ref">
            {session.owner}/{session.repo}#{session.pullNumber}
          </strong>
          <span className="pr-header-title">{session.title}</span>
        </div>
        <div className="pr-header-right">
          {checksData?.summary && checksData.summary.total > 0 && (
            <span
              className="pr-header-checks"
              title={
                checksData.checks
                  .map((c) => `${c.name}: ${c.state}`)
                  .join('\n') || 'CI checks'
              }
            >
              {checksData.summary.failure > 0 ? (
                <XCircle size={12} className="pr-check-fail" />
              ) : checksData.summary.pending > 0 ? (
                <Clock size={12} className="pr-check-pending" />
              ) : (
                <CheckCircle2 size={12} className="pr-check-ok" />
              )}
              <span>
                {checksData.summary.success}/{checksData.summary.total} checks
                {checksData.summary.failure > 0
                  ? ` · ${checksData.summary.failure} failing`
                  : checksData.summary.pending > 0
                    ? ` · ${checksData.summary.pending} pending`
                    : ''}
              </span>
            </span>
          )}
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
            commentCounts={commentCounts}
            viewedFiles={viewedFiles}
            untrackedFiles={emptyUntracked}
            onFileClick={setActiveFile}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
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
              onReplyExisting={replyToExisting}
            />
          )}
        </main>
      </div>

      <div className="sidebar-resize-guide" ref={sidebarGuideRef} aria-hidden="true" />

      <CommentTracker
        comments={comments}
        resolveComment={resolveComment}
        unresolveComment={unresolveComment}
        removeComment={removeComment}
        addReply={(id, body) => addReply({ id, body })}
        editComment={editComment}
        editReply={editReply}
        removeReply={removeReply}
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
  onReplyExisting,
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
  onReplyExisting: (commentId: number, body: string) => Promise<void>
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
                <div className="pr-existing-bubbles">
                  {existing.map((c) => (
                    <ExistingPrCommentBubble
                      key={c.id}
                      comment={c}
                      onReply={onReplyExisting}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
