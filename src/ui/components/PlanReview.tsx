import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { File as DiffsFile } from '@pierre/diffs/react'
import type { LineAnnotation, SelectedLineRange } from '@pierre/diffs'
import {
  Bot,
  MessageSquarePlus,
  Check,
  X,
  MessageSquareWarning,
  Clock,
  History,
  ArrowLeft,
  MessageSquare,
  Copy,
  Link2,
  FileText,
  FolderOpen,
  ListTree,
} from 'lucide-react'
import type { Plan, PlanComment, PlanDecision, PlanVersion } from '../../lib/plan-types'
import { sectionTitleForLine, extractPlanLines } from '../../lib/plan-format'
import { SHIKI_THEME_MAP, timeAgo } from '../utils'
import { Markdown } from './Markdown'
import type { LineHoverHighlight } from '../hooks/useSettings'
import { usePlans } from '../hooks/usePlans'
import { CommentForm } from './CommentForm'
import { PlanCommentBubble } from './PlanCommentBubble'
import { FilePreviewModal } from './FilePreviewModal'
import { Select } from '../primitives/Select'
import { Tooltip } from '../primitives/Tooltip'
import { buildPlanOutline } from '../lib/planOutline'

interface PlanReviewProps {
  plan: Plan
  theme: string
  fontSize: number
  monoFontFamily: string
  defaultTabSize: number
  lineWrap: boolean
  showLineNumbers: boolean
  lineHoverHighlight: LineHoverHighlight
  viewMode: 'source' | 'rendered'
}

interface PendingComment {
  lineNumber: number
  startLineNumber?: number
}

type PlanAnnotationMeta = PlanComment | { _pending: true }

const DECISION_META: Record<PlanDecision, { label: string; className: string; icon: typeof Check }> = {
  pending: { label: 'Pending review', className: 'plan-badge-pending', icon: Clock },
  approved: { label: 'Approved', className: 'plan-badge-approved', icon: Check },
  'changes-requested': { label: 'Changes requested', className: 'plan-badge-changes', icon: MessageSquareWarning },
  rejected: { label: 'Rejected', className: 'plan-badge-rejected', icon: X },
  'comment-only': { label: 'Comment only', className: 'plan-badge-comment-only', icon: MessageSquare },
}

export function PlanReview({
  plan,
  theme,
  fontSize,
  monoFontFamily,
  defaultTabSize,
  lineWrap,
  showLineNumbers,
  lineHoverHighlight,
  viewMode,
}: PlanReviewProps) {
  const {
    addPlanComment,
    editPlanComment,
    resolvePlanComment,
    unresolvePlanComment,
    removePlanComment,
    addPlanReply,
    editPlanReply,
    removePlanReply,
    submitDecision,
    submitting,
    agentWaiting,
  } = usePlans()

  const [pending, setPending] = useState<PendingComment | null>(null)
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(null)
  const [liveSelectionCount, setLiveSelectionCount] = useState(0)
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null)
  const [copyFlash, setCopyFlash] = useState<string | null>(null)
  const [tocOpen, setTocOpen] = useState(true)

  // Version switcher: `viewingVersion` is the body the user is reading right
  // now. Defaults to the plan's current version. The user can pick any prior
  // version from the dropdown in the meta row; the banner + comment filter
  // adapt accordingly.
  const versions: PlanVersion[] = plan.versions ?? []
  const [viewingVersion, setViewingVersion] = useState<number>(plan.version)
  const [viewingBody, setViewingBody] = useState<string>(plan.body)
  const [viewingTitle, setViewingTitle] = useState<string>(plan.title)

  // When the server pushes a new version (live SSE), keep the viewer's
  // position in sync: if they were on the previous current, auto-bump them
  // to the new current; otherwise leave them where they are.
  const lastSyncedCurrentRef = useRef<number>(plan.version)
  useEffect(() => {
    const wasOnCurrent = viewingVersion === lastSyncedCurrentRef.current
    if (plan.version !== lastSyncedCurrentRef.current && wasOnCurrent) {
      setViewingVersion(plan.version)
    }
    lastSyncedCurrentRef.current = plan.version
  }, [plan.version, viewingVersion])

  // Resolve the viewed version's body+title. Cache fast path: the same body
  // lives in `plan.versions[]`. Falls back to the network only if the
  // in-memory copy is missing (defensive — shouldn't happen in practice).
  useEffect(() => {
    let cancelled = false
    if (viewingVersion === plan.version) {
      setViewingBody(plan.body)
      setViewingTitle(plan.title)
      return
    }
    const local = versions.find((v) => v.version === viewingVersion)
    if (local) {
      setViewingBody(local.body)
      setViewingTitle(local.title)
      return
    }
    fetch(`/api/plans/${plan.id}/versions/${viewingVersion}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { version?: PlanVersion } | null) => {
        if (cancelled || !data?.version) return
        setViewingBody(data.version.body)
        setViewingTitle(data.version.title)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [viewingVersion, plan.version, plan.body, plan.title, plan.id, versions])

  // Switching versions invalidates any in-flight selection/pending comment —
  // those were anchored to a body that's no longer being rendered.
  useEffect(() => {
    setSelectedRange(null)
    setLiveSelectionCount(0)
    setPending(null)
  }, [viewingVersion])

  const isHistorical = viewingVersion !== plan.version
  const versionOptions = useMemo(
    () =>
      versions.map((v) => ({
        value: String(v.version),
        label: v.version === plan.version ? `v${v.version} (current)` : `v${v.version}`,
      })),
    [versions, plan.version],
  )

  const handleMarkdownClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a')
    if (anchor) {
      const href = anchor.getAttribute('href')
      if (href && href.startsWith('file:///')) {
        e.preventDefault()
        const absolutePath = href.replace('file://', '')
        setPreviewFilePath(absolutePath)
      }
    }
  }

  const shikiConfig = SHIKI_THEME_MAP[theme] || SHIKI_THEME_MAP.nord
  const unsafeCSS = useMemo(() => buildPlanCSS(defaultTabSize, fontSize, monoFontFamily), [defaultTabSize, fontSize, monoFontFamily])

  // Comments are filtered to those anchored to the version being viewed. A
  // comment's `createdAtPlanVersion` is set at write time by the server.
  const allComments = plan.comments ?? []
  const visibleComments = isHistorical
    ? allComments.filter((c) => c.createdAtPlanVersion === viewingVersion)
    : allComments
  const comments = visibleComments
  const lineComments = comments.filter((c) => c.lineNumber > 0)
  const generalComments = comments.filter((c) => c.lineNumber === 0)
  const openCount = comments.filter((c) => c.status === 'open').length
  const totalCommentCount = allComments.length

  const lineRange = (start: number | undefined, end: number) => extractPlanLines(viewingBody, start ?? end, end)

  const commitComment = (p: PendingComment, body: string) => {
    addPlanComment({
      planId: plan.id,
      lineNumber: p.lineNumber,
      startLineNumber: p.startLineNumber,
      lineContent: lineRange(p.startLineNumber, p.lineNumber),
      sectionTitle: sectionTitleForLine(viewingBody, p.startLineNumber ?? p.lineNumber),
      body,
      createdAtPlanVersion: viewingVersion,
    })
    setPending(null)
    setSelectedRange(null)
  }

  const annotations: LineAnnotation<PlanAnnotationMeta>[] = useMemo(() => {
    const list: LineAnnotation<PlanAnnotationMeta>[] = lineComments.map((c) => ({
      lineNumber: c.lineNumber,
      metadata: c,
    }))
    if (pending) {
      list.push({ lineNumber: pending.lineNumber, metadata: { _pending: true } })
    }
    return list
  }, [lineComments, pending])

  const renderAnnotation = (annotation: LineAnnotation<PlanAnnotationMeta>) => {
    const meta = annotation.metadata
    if (!meta) return null
    if ('_pending' in meta) {
      const p = pending!
      return (
        <CommentForm
          draftKey={`plan-new:${plan.id}:${p.startLineNumber ?? p.lineNumber}:${p.lineNumber}`}
          lineContent={lineRange(p.startLineNumber, p.lineNumber)}
          onSubmit={(body) => commitComment(p, body)}
          onCancel={() => {
            setPending(null)
            setSelectedRange(null)
          }}
        />
      )
    }
    const comment = meta
    return (
      <PlanCommentBubble
        comment={comment}
        onResolve={() => resolvePlanComment(plan.id, comment.id)}
        onUnresolve={() => unresolvePlanComment(plan.id, comment.id)}
        onDelete={() => removePlanComment(plan.id, comment.id)}
        onEdit={(body) => editPlanComment(plan.id, comment.id, body)}
        onReply={(body) => addPlanReply(plan.id, comment.id, body)}
        onEditReply={(replyId, body) => editPlanReply(plan.id, comment.id, replyId, body)}
        onDeleteReply={(replyId) => removePlanReply(plan.id, comment.id, replyId)}
      />
    )
  }

  const decision = DECISION_META[plan.decision]
  const DecisionIcon = decision.icon

  // Prefer durable on-disk mirror; fall back to free-form source when it looks
  // like an absolute path (agent handoff / original submit file).
  const copyablePath = useMemo(() => {
    if (plan.sourcePath) return plan.sourcePath
    if (plan.source && (plan.source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(plan.source))) {
      return plan.source
    }
    return null
  }, [plan.sourcePath, plan.source])

  const shortPath = useMemo(() => {
    if (!copyablePath) return null
    const parts = copyablePath.replace(/\\/g, '/').split('/')
    if (parts.length <= 3) return copyablePath
    return `…/${parts.slice(-3).join('/')}`
  }, [copyablePath])

  const outline = useMemo(() => buildPlanOutline(viewingBody), [viewingBody])
  const wordCount = useMemo(() => {
    const t = viewingBody.trim()
    if (!t) return 0
    return t.split(/\s+/).length
  }, [viewingBody])
  const lineCount = useMemo(
    () => (viewingBody ? viewingBody.replace(/\r\n/g, '\n').split('\n').length : 0),
    [viewingBody],
  )

  const flashCopy = useCallback((label: string) => {
    setCopyFlash(label)
    window.setTimeout(() => setCopyFlash(null), 1600)
  }, [])

  const copyText = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text)
        flashCopy(label)
      } catch {
        // Clipboard may be blocked outside secure contexts.
      }
    },
    [flashCopy],
  )

  const reviewUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname.startsWith('/plan') ? window.location.pathname : `/plan/${plan.id}`}`
      : `/plan/${plan.id}`

  return (
    <div className="plan-review">
      <div className="plan-review-head">
        <div className="plan-review-head-main">
          <h2 className="plan-review-title" title={viewingTitle}>
            {viewingTitle}
            {isHistorical && viewingTitle !== plan.title && (
              <span className="plan-review-title-historical" title={`Currently submitted title: ${plan.title}`}>
                {' '}
                (current: {plan.title})
              </span>
            )}
          </h2>
          <div className="plan-review-meta">
            <span className={`plan-badge ${decision.className}`}>
              <DecisionIcon size={12} aria-hidden="true" />
              {decision.label}
            </span>
            <span className="plan-review-chip">v{viewingVersion}{versions.length > 1 ? ` / ${versions.length}` : ''}</span>
            {versions.length > 1 && (
              <div className="plan-review-version-switcher">
                <History size={12} aria-hidden="true" className="plan-review-version-switcher-icon" />
                <Select
                  value={String(viewingVersion)}
                  onValueChange={(v) => setViewingVersion(Number(v))}
                  options={versionOptions}
                  ariaLabel="Plan version"
                />
                {isHistorical && (
                  <button
                    type="button"
                    className="plan-review-version-back"
                    onClick={() => setViewingVersion(plan.version)}
                    title={`Back to current v${plan.version}`}
                  >
                    <ArrowLeft size={11} aria-hidden="true" />
                    Back to v{plan.version}
                  </button>
                )}
                {isHistorical && (
                  <span
                    className="plan-review-version-current-dot"
                    title={`This is v${viewingVersion} of ${plan.version}`}
                    aria-label={`Viewing historical version ${viewingVersion}`}
                  />
                )}
              </div>
            )}
            {plan.model && (
              <span className="plan-review-chip plan-review-chip-model">
                <Bot size={11} aria-hidden="true" />
                {plan.model}
              </span>
            )}
            <span className="plan-review-chip" title={`${lineCount} lines · ${wordCount} words`}>
              {lineCount} lines · {wordCount} words
            </span>
            {lineComments.length + generalComments.length > 0 && (
              <span className="plan-review-chip">
                {comments.length} comment{comments.length === 1 ? '' : 's'}
                {isHistorical && totalCommentCount !== comments.length && (
                  <span className="plan-review-chip-sub"> of {totalCommentCount}</span>
                )}
                {openCount > 0 && (
                  <span className="plan-review-chip-sub"> · {openCount} open</span>
                )}
              </span>
            )}
            {liveSelectionCount > 0 && (
              <span className="plan-review-chip plan-review-chip-selection" aria-live="polite">
                {liveSelectionCount} line{liveSelectionCount === 1 ? '' : 's'} selected
              </span>
            )}
            <span className="plan-review-chip plan-review-chip-muted" title={timeAgo(plan.updatedAt)}>
              updated {timeAgo(plan.updatedAt)}
            </span>
          </div>

          {/* Source path row — primary DX for agent handoff */}
          {(copyablePath || plan.source) && (
            <div className="plan-source-row">
              <FolderOpen size={13} className="plan-source-icon" aria-hidden="true" />
              <code className="plan-source-path" title={copyablePath ?? plan.source}>
                {shortPath ?? plan.source}
              </code>
              {copyablePath && (
                <Tooltip content="Copy absolute source path (for agents / other tools)">
                  <button
                    type="button"
                    className="plan-source-btn"
                    onClick={() => copyText(copyablePath, 'Path copied')}
                    aria-label="Copy plan source path"
                  >
                    <Copy size={12} />
                    <span>Copy path</span>
                  </button>
                </Tooltip>
              )}
              {plan.source && plan.source !== copyablePath && (
                <span className="plan-source-label" title={plan.source}>
                  label: {plan.source}
                </span>
              )}
              {copyFlash && (
                <span className="plan-source-flash" role="status">
                  {copyFlash}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="plan-review-head-actions">
          <Tooltip content="Copy deep link to this plan review">
            <button
              type="button"
              className="btn btn-sm plan-action-btn"
              onClick={() => copyText(reviewUrl, 'Link copied')}
              aria-label="Copy review URL"
            >
              <Link2 size={13} />
              <span className="btn-label">Copy link</span>
            </button>
          </Tooltip>
          <Tooltip content="Copy the full markdown body (current version view)">
            <button
              type="button"
              className="btn btn-sm plan-action-btn"
              onClick={() => copyText(viewingBody, 'Markdown copied')}
              aria-label="Copy plan markdown"
            >
              <FileText size={13} />
              <span className="btn-label">Copy MD</span>
            </button>
          </Tooltip>
          {copyablePath && (
            <Tooltip content="Copy absolute path to the on-disk plan source">
              <button
                type="button"
                className="btn btn-sm plan-action-btn plan-action-btn-primary"
                onClick={() => copyText(copyablePath, 'Path copied')}
                aria-label="Copy plan source path"
              >
                <Copy size={13} />
                <span className="btn-label">Copy path</span>
              </button>
            </Tooltip>
          )}
          {viewMode === 'rendered' && outline.length > 0 && (
            <button
              type="button"
              className={`btn btn-sm plan-action-btn ${tocOpen ? 'btn-active' : ''}`}
              onClick={() => setTocOpen((v) => !v)}
              aria-pressed={tocOpen}
              title="Toggle table of contents"
            >
              <ListTree size={13} />
              <span className="btn-label">Outline</span>
            </button>
          )}
        </div>
      </div>

      {isHistorical && (
        <div className="plan-review-historical-banner" role="status">
          <History size={14} aria-hidden="true" />
          <span>
            Viewing <strong>v{viewingVersion}</strong> of this plan (current is <strong>v{plan.version}</strong>).{' '}
            Comments and line anchors reflect v{viewingVersion}.
          </span>
          <button type="button" className="plan-review-historical-banner-back" onClick={() => setViewingVersion(plan.version)}>
            <ArrowLeft size={11} aria-hidden="true" />
            Back to current
          </button>
        </div>
      )}

      {plan.decision !== 'pending' && (
        <div className={`plan-decision-banner ${decision.className}`}>
          <DecisionIcon size={15} aria-hidden="true" />
          <div className="plan-decision-banner-text">
            <strong>{decision.label}</strong>
            {plan.decisionComment && (
              <Markdown
                content={plan.decisionComment}
                className="plan-decision-banner-note markdown-body"
              />
            )}
          </div>
        </div>
      )}

      {generalComments.length > 0 && (
        <div className="plan-general-section">
          <div className="plan-general-header">
            <MessageSquarePlus size={14} />
            <span>General comments ({generalComments.length})</span>
          </div>
          {generalComments.map((c) => (
            <PlanCommentBubble
              key={c.id}
              comment={c}
              onResolve={() => resolvePlanComment(plan.id, c.id)}
              onUnresolve={() => unresolvePlanComment(plan.id, c.id)}
              onDelete={() => removePlanComment(plan.id, c.id)}
              onEdit={(body) => editPlanComment(plan.id, c.id, body)}
              onReply={(body) => addPlanReply(plan.id, c.id, body)}
              onEditReply={(replyId, body) => editPlanReply(plan.id, c.id, replyId, body)}
              onDeleteReply={(replyId) => removePlanReply(plan.id, c.id, replyId)}
            />
          ))}
        </div>
      )}

      {viewMode === 'rendered' ? (
        <div className="plan-rendered-layout">
          {tocOpen && outline.length > 0 && (
            <nav className="plan-toc" aria-label="Plan outline">
              <div className="plan-toc-head">
                <ListTree size={12} aria-hidden="true" />
                <span>On this page</span>
              </div>
              <ul className="plan-toc-list">
                {outline.map((item) => (
                  <li
                    key={item.id}
                    className={`plan-toc-item plan-toc-level-${Math.min(item.level, 4)}`}
                  >
                    <a
                      href={`#${item.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        const el = document.getElementById(item.id)
                        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        // Keep hash in URL for shareability without jump-fighting.
                        if (typeof history !== 'undefined') {
                          history.replaceState(null, '', `#${item.id}`)
                        }
                      }}
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div
            className="markdown-body plan-rendered"
            onClick={handleMarkdownClick}
          >
            <Markdown content={viewingBody} />
          </div>
        </div>
      ) : (
        <div className="plan-file">
          <div className="plan-file-hint">
            Source mode — select lines in the gutter to comment. Switch to{' '}
            <strong>Rendered</strong> in Settings for reading with outline + code copy.
          </div>
          <DiffsFile<PlanAnnotationMeta>
            file={{ name: plan.sourcePath?.split('/').pop() || 'PLAN.md', contents: viewingBody, lang: 'markdown' }}
            options={{
              disableFileHeader: true,
              enableGutterUtility: true,
              enableLineSelection: true,
              overflow: lineWrap ? 'wrap' : 'scroll',
              disableLineNumbers: !showLineNumbers,
              lineHoverHighlight,
              onLineSelectionStart: () => {
                setSelectedRange(null)
                setLiveSelectionCount(0)
              },
              onLineSelectionChange: (range) => {
                setLiveSelectionCount(range ? Math.abs(range.end - range.start) + 1 : 0)
              },
              onLineSelectionEnd: (range) => {
                setLiveSelectionCount(0)
                if (range) {
                  setSelectedRange(range)
                  setPending({ lineNumber: range.end, startLineNumber: range.start })
                }
              },
              theme: {
                dark: shikiConfig.type === 'dark' ? shikiConfig.themeName : 'nord',
                light: shikiConfig.type === 'light' ? shikiConfig.themeName : 'github-light',
              },
              themeType: shikiConfig.type,
              unsafeCSS,
            }}
            selectedLines={selectedRange}
            lineAnnotations={annotations}
            renderAnnotation={renderAnnotation}
            renderGutterUtility={(getHoveredLine) => (
              <button
                className="gutter-add-btn"
                onClick={() => {
                  const line = getHoveredLine()
                  if (line) setPending({ lineNumber: line.lineNumber })
                }}
              >
                +
              </button>
            )}
          />
        </div>
      )}
      <FilePreviewModal
        isOpen={!!previewFilePath}
        filePath={previewFilePath}
        onClose={() => setPreviewFilePath(null)}
      />
    </div>
  )
}

function buildPlanCSS(tabSize: number, fontSize: number, fontFamily: string): string {
  return `
    :host {
      --diffs-tab-size: ${tabSize} !important;
      --diffs-font-family: ${fontFamily} !important;
      --diffs-font-size: ${fontSize}px !important;
      --diffs-border: var(--border-normal) !important;
      --diffs-bg: var(--bg-secondary) !important;
      --diffs-line-height: ${Math.round(fontSize * 1.7)}px !important;
    }
    [data-column-number], [data-line], [data-line] * {
      font-family: ${fontFamily} !important;
      font-size: ${fontSize}px !important;
      font-variant-ligatures: common-ligatures !important;
      font-feature-settings: "liga" on, "calt" on !important;
    }
    [data-column-number] {
      color: var(--text-muted) !important;
      opacity: 0.65 !important;
      user-select: none !important;
      padding-right: 12px !important;
    }
    [data-line]:hover [data-column-number] {
      opacity: 1 !important;
      color: var(--primary) !important;
    }
    [data-line].selected-line {
      background-color: var(--accent-subtle) !important;
    }
    .comment-bubble-canvas {
      width: calc(100% - 40px) !important;
      max-width: min(720px, calc(100% - 40px)) !important;
      margin: 14px 20px !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }
    .comment-replies {
      min-width: 0 !important;
    }
    .comment-node {
      min-width: 0 !important;
    }
    .comment-content-col {
      min-width: 0 !important;
    }
    .comment-node-header {
      flex-wrap: wrap !important;
      min-width: 0 !important;
    }
    .comment-node-body {
      word-break: break-word !important;
      overflow-wrap: break-word !important;
      min-width: 0 !important;
    }
  `
}
