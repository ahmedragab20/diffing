import { useState, useMemo } from 'react'
import { File as DiffsFile } from '@pierre/diffs/react'
import type { LineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { Bot, FileText, Code2, MessageSquarePlus, Check, X, MessageSquareWarning, Clock } from 'lucide-react'
import type { Plan, PlanComment, PlanDecision } from '../../lib/plan-types'
import { sectionTitleForLine, extractPlanLines } from '../../lib/plan-format'
import { SHIKI_THEME_MAP, timeAgo } from '../utils'
import { Markdown } from './Markdown'
import type { LineHoverHighlight } from '../hooks/useSettings'
import { usePlans } from '../hooks/usePlans'
import { CommentForm } from './CommentForm'
import { PlanCommentBubble } from './PlanCommentBubble'
import { SubmitPlanReviewPopover } from './SubmitPlanReviewPopover'
import { FilePreviewModal } from './FilePreviewModal'

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

  const comments = plan.comments ?? []
  const lineComments = comments.filter((c) => c.lineNumber > 0)
  const generalComments = comments.filter((c) => c.lineNumber === 0)
  const openCount = comments.filter((c) => c.status === 'open').length

  const lineRange = (start: number | undefined, end: number) => extractPlanLines(plan.body, start ?? end, end)

  const commitComment = (p: PendingComment, body: string) => {
    addPlanComment({
      planId: plan.id,
      lineNumber: p.lineNumber,
      startLineNumber: p.startLineNumber,
      lineContent: lineRange(p.startLineNumber, p.lineNumber),
      sectionTitle: sectionTitleForLine(plan.body, p.startLineNumber ?? p.lineNumber),
      body,
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
          <h2 className="plan-review-title" title={plan.title}>
            {plan.title}
          </h2>
          <div className="plan-review-meta">
            <span className={`plan-badge ${decision.className}`}>
              <DecisionIcon size={12} aria-hidden="true" />
              {decision.label}
            </span>
            <span className="plan-review-chip">v{plan.version}</span>
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
          <Markdown content={plan.body} />
        </div>
      ) : (
        <div className="plan-file">
          <DiffsFile<PlanAnnotationMeta>
            file={{ name: 'PLAN.md', contents: plan.body, lang: 'markdown' }}
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
