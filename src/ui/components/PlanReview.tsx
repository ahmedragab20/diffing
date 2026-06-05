import { useState, useMemo, useEffect, useRef } from 'react'
import { File as DiffsFile } from '@pierre/diffs/react'
import type { LineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { Bot, FileText, Code2, MessageSquarePlus, Check, X, MessageSquareWarning, Clock, History, ArrowLeft } from 'lucide-react'
import type { Plan, PlanComment, PlanDecision, PlanVersion } from '../../lib/plan-types'
import { sectionTitleForLine, extractPlanLines } from '../../lib/plan-format'
import { SHIKI_THEME_MAP, timeAgo } from '../utils'
import { Markdown } from './Markdown'
import type { LineHoverHighlight } from '../hooks/useSettings'
import { usePlans } from '../hooks/usePlans'
import { CommentForm } from './CommentForm'
import { PlanCommentBubble } from './PlanCommentBubble'
import { SubmitPlanReviewPopover } from './SubmitPlanReviewPopover'
import { FilePreviewModal } from './FilePreviewModal'
import { Select } from '../primitives/Select'

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
            {plan.source && <span className="plan-review-chip">{plan.source}</span>}
            {plan.model && (
              <span className="plan-review-chip plan-review-chip-model">
                <Bot size={11} aria-hidden="true" />
                {plan.model}
              </span>
            )}
            {lineComments.length + generalComments.length > 0 && (
              <span className="plan-review-chip">
                {comments.length} comment{comments.length === 1 ? '' : 's'}
                {isHistorical && totalCommentCount !== comments.length && (
                  <span className="plan-review-chip-sub"> of {totalCommentCount}</span>
                )}
              </span>
            )}
            {liveSelectionCount > 0 && (
              <span className="plan-review-chip plan-review-chip-selection" aria-live="polite">
                {liveSelectionCount} line{liveSelectionCount === 1 ? '' : 's'} selected
              </span>
            )}
          </div>
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
        <div
          className="markdown-body plan-rendered"
          onClick={handleMarkdownClick}
        >
          <Markdown content={viewingBody} />
        </div>
      ) : (
        <div className="plan-file">
          <DiffsFile<PlanAnnotationMeta>
            file={{ name: 'PLAN.md', contents: viewingBody, lang: 'markdown' }}
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
