import { useState, memo, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { FileDiff, MultiFileDiff } from '@pierre/diffs/react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide, SelectedLineRange } from '@pierre/diffs'
import { ChevronDown, ChevronRight, Edit3, MessageSquare, Maximize2, Loader2, Undo2, AlertCircle, X, HelpCircle, GitCommit, Clock, User, Copy, Check } from 'lucide-react'
import { Modal } from '../primitives/Modal'
import { Tooltip } from '../primitives/Tooltip'
import { useFileContents } from '../hooks/useFileContents'
import type { ReviewComment } from '../../lib/types'
import type { PrExistingComment } from '../../lib/pr-session'
import type {
  LineDiffType,
  DiffIndicators,
  HunkSeparatorStyle,
  LineHoverHighlight,
} from '../hooks/useSettings'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'
import { ExistingPrCommentBubble } from './ExistingPrCommentBubble'
import { DiffMinimap } from './DiffMinimap'
import { SHIKI_THEME_MAP, scrollToLine } from '../utils'
import {
  pendingFromSelection,
  pendingLineLabel,
  pendingOrderedRange,
  pendingSideLabel,
  selectedRangeFromPending,
  adjustPendingStart,
  adjustPendingEnd,
  canAdjustPendingStart,
  canAdjustPendingEnd,
  normalizePendingRange,
  type PendingLineComment,
  type PendingLineBounds,
} from '../lib/commentSelection'

type PendingComment = PendingLineComment

/** Keep current GitHub threads on their exact diff line; stale anchors fall back to file-level context. */
export function canAnchorPrComment(fileDiff: FileDiffMetadata, comment: PrExistingComment): boolean {
  if (comment.isOutdated || comment.line == null || comment.line < 1 || comment.side == null) return false
  const side = comment.side === 'LEFT' ? 'deletions' : 'additions'
  const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
  const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
  return fileDiff.hunks.some((hunk) => comment.line! >= hunk[startKey] && comment.line! < hunk[startKey] + hunk[countKey])
}

/** Min/max file line numbers present on one side of a pierre FileDiffMetadata. */
function boundsForSide(
  fileDiff: FileDiffMetadata,
  side: AnnotationSide,
  expandedLineCount?: number,
): PendingLineBounds {
  const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
  const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
  let min = Number.POSITIVE_INFINITY
  let max = 0
  for (const hunk of fileDiff.hunks) {
    const start = hunk[startKey] as number
    const count = hunk[countKey] as number
    if (count <= 0) continue
    min = Math.min(min, start)
    max = Math.max(max, start + count - 1)
  }
  // When full-file context is expanded, allow navigating the whole file.
  if (expandedLineCount && expandedLineCount > 0) {
    min = Math.min(min === Number.POSITIVE_INFINITY ? 1 : min, 1)
    max = Math.max(max, expandedLineCount)
  }
  if (!Number.isFinite(min) || max < 1) {
    return { min: 1, max: Math.max(1, expandedLineCount ?? 1) }
  }
  return { min, max }
}

interface FileDiffCardProps {
  id?: string
  fileDiff: FileDiffMetadata
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
  /** Published GitHub threads, anchored to their PR diff line when possible. */
  existingComments?: PrExistingComment[]
  diffStyle: 'split' | 'unified'
  tabSize: number
  viewed: boolean
  theme: string
  editorIDE?: string
  lineDiffType: LineDiffType
  lineWrap: boolean
  diffIndicators: DiffIndicators
  showLineNumbers: boolean
  hunkSeparators: HunkSeparatorStyle
  lineHoverHighlight: LineHoverHighlight
  fontSize: number
  monoFontFamily: string
  expandContextByDefault: boolean
  collapsedContextThreshold: number
  expansionLineCount: number
  /**
   * Auto-collapse the card when its added+deleted line count exceeds this.
   * Set to 0 to disable. The user can still expand any card by clicking the
   * header; auto-collapse only fires on initial mount / file change.
   */
  autoCollapseLineThreshold: number
  onViewedChange: (filePath: string, viewed: boolean) => void
  onAddComment: (
    filePath: string,
    side: AnnotationSide,
    lineNumber: number,
    lineContent: string,
    body: string,
    startLineNumber?: number,
    severity?: import('../../lib/types').CommentSeverity,
  ) => void
  onDeleteComment: (id: string) => void
  onReplyExisting?: (commentId: number, body: string) => Promise<void>
  onEditExisting?: (commentId: number, body: string) => Promise<void>
  onDeleteExisting?: (commentId: number) => Promise<void>
  onSetExistingResolved?: (threadId: string, resolved: boolean) => Promise<void>
  /** Hide editor/revert actions on remote or otherwise read-only review surfaces. */
  allowLocalActions?: boolean
  /**
   * Fired by the header click AFTER the local `collapsed` state has been
   * flipped. Used by App.tsx to drive the auto-advance-to-next-file
   * scroll when the user collapses a card. Not fired by the "Add Comment"
   * expand path or by the `viewed`-prop sync effect — only by the user's
   * explicit header click.
   */
  onCardToggleCollapse?: (filePath: string, willCollapse: boolean) => void
}

export const FileDiffCard = memo(function FileDiffCard({
  id,
  fileDiff,
  filePath,
  annotations,
  existingComments = [],
  diffStyle,
  tabSize,
  viewed,
  theme,
  editorIDE,
  lineDiffType,
  lineWrap,
  diffIndicators,
  showLineNumbers,
  hunkSeparators,
  lineHoverHighlight,
  fontSize,
  monoFontFamily,
  expandContextByDefault,
  collapsedContextThreshold,
  expansionLineCount,
  autoCollapseLineThreshold,
  onViewedChange,
  onAddComment,
  onDeleteComment,
  onReplyExisting,
  onEditExisting,
  onDeleteExisting,
  onSetExistingResolved,
  allowLocalActions = true,
  onCardToggleCollapse,
}: FileDiffCardProps) {
  const [pending, setPending] = useState<PendingComment | null>(null)
  /**
   * Controlled pierre selection — only set while a pending composer is open so
   * we do not fight live drag selection (re-applying null mid-drag collapses
   * multi-line ranges to a single line).
   */
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(null)
  const [liveSelectionCount, setLiveSelectionCount] = useState(0)
  /** Stable draft key for the open composer session (survives range adjusts). */
  const draftSessionRef = useRef<string | null>(null)
  const [permalinkFlash, setPermalinkFlash] = useState<string | null>(null)
  const [pathCopyFlash, setPathCopyFlash] = useState(false)
  const lineTotal = fileDiff.additionLines.length + fileDiff.deletionLines.length
  // Collapse if the user has viewed the file OR if the auto-collapse threshold
  // is set and the file is larger than it. Threshold 0 = never auto-collapse.
  const initialCollapsed =
    viewed || (autoCollapseLineThreshold > 0 && lineTotal > autoCollapseLineThreshold)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [opening, setOpening] = useState(false)
  const [showFileCommentForm, setShowFileCommentForm] = useState(false)
  const [contextExpanded, setContextExpanded] = useState(expandContextByDefault)
  const [revertingHunk, setRevertingHunk] = useState<number | null>(null)
  const [revertError, setRevertError] = useState<string | null>(null)
  const [previewHunkIndex, setPreviewHunkIndex] = useState<number | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // Defer mounting the expensive @pierre/diffs renderer until the card is near
  // the viewport. Once mounted we keep it (sticky) so scroll-back doesn't re-run
  // Shiki. Combined with content-visibility CSS this is the main large-diff win.
  const [bodyMounted, setBodyMounted] = useState(false)

  const handleCopyPath = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(filePath).then(
      () => {
        setPathCopyFlash(true)
        window.setTimeout(() => setPathCopyFlash(false), 1500)
      },
      () => {},
    )
  }

  const handleRevertHunk = async (hunkIndex: number, skipConfirm = false) => {
    if (revertingHunk !== null) return
    if (
      !skipConfirm &&
      typeof window !== 'undefined' &&
      !window.confirm(
        `Revert hunk #${hunkIndex + 1} in ${filePath}? This rewrites the file via "git apply --reverse".`,
      )
    )
      return
    setRevertingHunk(hunkIndex)
    setRevertError(null)
    try {
      const res = await fetch('/api/revert-hunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, hunkIndex }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      // SSE will refresh the diff automatically.
    } catch (err: any) {
      setRevertError(err.message)
    } finally {
      setRevertingHunk(null)
    }
  }

  const isChangedFile = fileDiff.type === 'change' || fileDiff.type === 'rename-changed'
  const canExpandContext = !collapsed && isChangedFile
  const oldFilePath = fileDiff.prevName ?? filePath
  const { loading: contentsLoading, oldContent, newContent } = useFileContents(
    filePath,
    contextExpanded && canExpandContext,
    oldFilePath,
  )
  const contentsReady =
    contextExpanded && oldContent !== null && newContent !== null

  // Synchronize collapse with viewed state changes from parent.
  // Must use `useLayoutEffect` (NOT `useEffect`) so the collapse commits
  // before the next paint. The "Viewed" checkbox path in App.tsx schedules
  // a `requestAnimationFrame` immediately after `setViewed`, and the rAF
  // fires before paint but AFTER `useLayoutEffect`. If we used `useEffect`,
  // the collapse would run after paint — after the rAF has already
  // scrolled — so the scroll would be computed against the un-collapsed
  // layout, then the page would shift up under the scroll position,
  // landing on the file AFTER the intended next one.
  useLayoutEffect(() => {
    setCollapsed(viewed)
  }, [viewed])

  useEffect(() => {
    if (bodyMounted || collapsed) return
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setBodyMounted(true)
      return
    }
    // Eager-mount when already in / near the viewport on expand.
    const rect = el.getBoundingClientRect()
    const near =
      rect.bottom >= -800 &&
      rect.top <= (typeof window !== 'undefined' ? window.innerHeight + 800 : 2000)
    if (near) {
      setBodyMounted(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setBodyMounted(true)
          io.disconnect()
        }
      },
      { root: null, rootMargin: '800px 0px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [collapsed, bodyMounted])

  const shikiConfig = SHIKI_THEME_MAP[theme] || SHIKI_THEME_MAP.nord

  // Stable across re-renders triggered by unrelated prop changes (e.g. toggling
  // split/unified) so the diff renderer isn't handed a brand-new CSS string
  // every time. Only tabSize/fontSize actually affect it.
  const unsafeCSS = useMemo(() => buildUnsafeCSS(tabSize, fontSize, monoFontFamily), [tabSize, fontSize, monoFontFamily])

  const getLineContent = (side: AnnotationSide, lineNumber: number, startLineNumber?: number): string => {
    const a = startLineNumber ?? lineNumber
    const b = lineNumber
    const startNum = Math.min(a, b)
    const endNum = Math.max(a, b)
    const resultLines: string[] = []
    // Full-file contents when "Expand context" is on — fills lines outside patch hunks.
    const expanded =
      contentsReady
        ? (side === 'additions' ? newContent : oldContent)?.replace(/\r\n/g, '\n').split('\n')
        : undefined

    for (let line = startNum; line <= endNum; line++) {
      const lines = side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines
      const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
      const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
      const indexKey = side === 'additions' ? 'additionLineIndex' : 'deletionLineIndex'
      let found = false
      for (const hunk of fileDiff.hunks) {
        const start = hunk[startKey]
        const count = hunk[countKey]
        if (line >= start && line < start + count) {
          const index = hunk[indexKey] + (line - start)
          resultLines.push(lines[index] ?? '')
          found = true
          break
        }
      }
      if (!found) {
        // Context / expanded lines aren't in the patch arrays.
        resultLines.push(expanded?.[line - 1] ?? '')
      }
    }
    return resultLines.join('\n')
  }

  const openPending = useCallback((next: PendingComment) => {
    const normalized = normalizePendingRange(next)
    if (!draftSessionRef.current) {
      draftSessionRef.current = crypto.randomUUID()
    }
    setPending(normalized)
    setSelectedRange(selectedRangeFromPending(normalized))
    setLiveSelectionCount(0)
  }, [])

  const clearPending = useCallback(() => {
    setPending(null)
    setSelectedRange(null)
    setLiveSelectionCount(0)
    draftSessionRef.current = null
  }, [])

  const pendingBounds = useMemo((): PendingLineBounds | undefined => {
    if (!pending) return undefined
    const expandedCount =
      contentsReady && pending.side === 'additions'
        ? (newContent ?? '').split('\n').length
        : contentsReady && pending.side === 'deletions'
          ? (oldContent ?? '').split('\n').length
          : undefined
    return boundsForSide(fileDiff, pending.side, expandedCount)
  }, [pending, fileDiff, contentsReady, newContent, oldContent])

  const updatePendingRange = useCallback((next: PendingComment) => {
    const normalized = normalizePendingRange(next)
    setPending(normalized)
    setSelectedRange(selectedRangeFromPending(normalized))
  }, [])

  // After a new draft opens, scroll its annotation into view (it can land
  // off-screen when opened near the bottom of a tall file). Re-run when the
  // bottom edge moves so the form stays near the anchor slot.
  useEffect(() => {
    if (!pending) return
    const id = window.requestAnimationFrame(() => {
      const el = cardRef.current?.querySelector('.comment-form, [data-annotation-slot]')
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    })
    return () => cancelAnimationFrame(id)
  }, [pending?.side, pending?.lineNumber])

  const handleOpenEditor = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (fileDiff.type === 'deleted') return
    setOpening(true)
    try {
      await fetch('/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, editor: editorIDE }),
      })
    } catch (err) {
      console.error('Failed to open file in IDE editor:', err)
    } finally {
      setOpening(false)
    }
  }

  const getStatusBadge = () => {
    switch (fileDiff.type) {
      case 'new':
        return <span className="diff-status-badge diff-status-new">Added</span>
      case 'deleted':
        return <span className="diff-status-badge diff-status-deleted">Deleted</span>
      case 'rename-pure':
      case 'rename-changed':
        return <span className="diff-status-badge diff-status-renamed">Renamed</span>
      default:
        return <span className="diff-status-badge diff-status-modified">Modified</span>
    }
  }

  const fileLevelAnnotations = annotations.filter((a) => a.lineNumber === 0)
  const lineAnnotations = annotations.filter((a) => a.lineNumber > 0)

  const existingLineAnnotations: DiffLineAnnotation<{ _existingPr: true; comment: PrExistingComment }>[] = existingComments
    .filter((comment) => canAnchorPrComment(fileDiff, comment))
    .map((comment) => ({
      side: comment.side === 'LEFT' ? 'deletions' : 'additions',
      lineNumber: comment.line!,
      metadata: { _existingPr: true, comment },
    }))
  const existingFileLevelComments = existingComments.filter((comment) => !canAnchorPrComment(fileDiff, comment))

  const renderAnnotationFn = (
    annotation: DiffLineAnnotation<ReviewComment | { _pending: true } | { _existingPr: true; comment: PrExistingComment }>,
  ) => {
    if ('_pending' in annotation.metadata) {
      if (!pending) return null
      const session = draftSessionRef.current ?? 'open'
      const draftKey = `new:${filePath}:${pending.side}:${session}`
      const lineContent = getLineContent(
        pending.side,
        pending.lineNumber,
        pending.startLineNumber,
      )
      const ordered = pendingOrderedRange(pending)
      const bounds = pendingBounds
      return (
        <CommentForm
          draftKey={draftKey}
          lineContent={lineContent}
          lineLabel={pendingLineLabel(pending)}
          range={{
            start: ordered.start,
            end: ordered.end,
            sideLabel: pendingSideLabel(pending),
            canAdjustStart: (d) => canAdjustPendingStart(pending, d, bounds),
            canAdjustEnd: (d) => canAdjustPendingEnd(pending, d, bounds),
          }}
          onAdjustStart={(delta) => {
            updatePendingRange(adjustPendingStart(pending, delta, bounds))
          }}
          onAdjustEnd={(delta) => {
            updatePendingRange(adjustPendingEnd(pending, delta, bounds))
          }}
          onSubmit={(body, severity) => {
            // Recompute content at submit so adjusted ranges are accurate.
            const content = getLineContent(
              pending.side,
              pending.lineNumber,
              pending.startLineNumber,
            )
            onAddComment(
              filePath,
              pending.side,
              pending.lineNumber,
              content,
              body,
              pending.startLineNumber,
              severity,
            )
            clearPending()
          }}
          onCancel={clearPending}
        />
      )
    }
    if ('_existingPr' in annotation.metadata) {
      return (
        <ExistingPrCommentBubble
          comment={annotation.metadata.comment}
          lineContent={getLineContent(
            annotation.side,
            annotation.lineNumber,
            annotation.metadata.comment.startLine ?? undefined,
          )}
          onReply={onReplyExisting}
          onEdit={onEditExisting}
          onDelete={onDeleteExisting}
          onSetResolved={onSetExistingResolved}
        />
      )
    }
    return (
      <CommentBubble
        comment={annotation.metadata as ReviewComment}
        onDelete={onDeleteComment}
      />
    )
  }

  // Drop any open draft when a new selection starts. Do NOT keep controlling
  // selectedLines during the drag (pending → null → selectedLines=undefined)
  // so pierre owns the live range.
  const handleSelectionStart = useCallback(() => {
    setLiveSelectionCount(0)
    setPending(null)
    setSelectedRange(null)
    draftSessionRef.current = null
  }, [])

  const handleSelectionChange = useCallback((range: SelectedLineRange | null) => {
    if (range) {
      setLiveSelectionCount(Math.abs(range.end - range.start) + 1)
    } else {
      setLiveSelectionCount(0)
    }
  }, [])

  const handleSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setLiveSelectionCount(0)
      if (!range) return
      // Open the composer under the selection (works for single-click select + drag).
      openPending(pendingFromSelection(range))
    },
    [openPending],
  )

  /**
   * Pierre built-in gutter + (single click or drag). Must NOT be combined with
   * `renderGutterUtility` — pierre throws if both APIs are used.
   */
  const handleGutterUtilityClick = useCallback(
    (range: SelectedLineRange) => {
      openPending(pendingFromSelection(range))
    },
    [openPending],
  )

  const allAnnotations: DiffLineAnnotation<ReviewComment | { _pending: true } | { _existingPr: true; comment: PrExistingComment }>[] = [
    ...lineAnnotations,
    ...existingLineAnnotations,
    ...(pending
      ? [
          {
            side: pending.side,
            lineNumber: pending.lineNumber,
            metadata: { _pending: true as const },
          },
        ]
      : []),
  ]

  return (
    <div
      ref={cardRef}
      className={`file-diff-card ${viewed ? 'file-diff-viewed' : ''} ${collapsed ? 'file-diff-collapsed' : ''}`}
      id={id}
      data-file-path={filePath}
    >
      <div
        className="file-diff-card-header"
        onClick={() => {
          const next = !collapsed
          setCollapsed(next)
          onCardToggleCollapse?.(filePath, next)
        }}
      >
        <div className="file-diff-header-left">
          <span className="file-diff-collapse-indicator" aria-hidden="true">
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
          <div className="file-diff-title-row">
            <span className="file-diff-name" title={filePath}>
              {filePath}
            </span>
            <button
              className="file-diff-copy-path-btn"
              onClick={handleCopyPath}
              title="Copy file path to clipboard"
              aria-label="Copy file path to clipboard"
            >
              {pathCopyFlash ? <Check size={12} /> : <Copy size={12} />}
            </button>
            {getStatusBadge()}
            {(lineAnnotations.length + existingLineAnnotations.length) > 0 && (
              <span
                className="file-diff-comment-badge"
                title={`${lineAnnotations.length + existingLineAnnotations.length} inline comment${lineAnnotations.length + existingLineAnnotations.length === 1 ? '' : 's'}`}
              >
                <MessageSquare size={10} />
                {lineAnnotations.length + existingLineAnnotations.length}
              </span>
            )}
            {liveSelectionCount > 0 && (
              <span className="file-diff-selection-badge" aria-live="polite">
                {liveSelectionCount} line{liveSelectionCount === 1 ? '' : 's'} selected
              </span>
            )}
            {pathCopyFlash && (
              <span className="file-diff-permalink-flash" role="status">
                Copied path
              </span>
            )}
            {permalinkFlash && (
              <span className="file-diff-permalink-flash" role="status">
                Copied {permalinkFlash}
              </span>
            )}
          </div>
        </div>

        <div className="file-diff-header-right" onClick={(e) => e.stopPropagation()}>
          {canExpandContext && (
            <Tooltip
              content={
                contextExpanded
                  ? 'Hide unchanged context'
                  : 'Expand full-file context'
              }
              side="bottom"
            >
              <button
                className={`file-diff-icon-btn ${contextExpanded ? 'is-active' : ''}`}
                onClick={() => setContextExpanded((v) => !v)}
                disabled={contentsLoading}
                aria-label={
                  contentsLoading
                    ? 'Loading context'
                    : contextExpanded
                      ? 'Hide context'
                      : 'Expand context'
                }
              >
                {contentsLoading ? <Loader2 size={13} className="spin" /> : <Maximize2 size={13} />}
              </button>
            </Tooltip>
          )}
          {allowLocalActions && fileDiff.type !== 'deleted' && (
            <Tooltip content="Open in editor" side="bottom">
              <button
                className="file-diff-icon-btn"
                onClick={handleOpenEditor}
                disabled={opening}
                aria-label={opening ? 'Opening file' : 'Edit file'}
              >
                {opening ? <Loader2 size={13} className="spin" /> : <Edit3 size={13} />}
              </button>
            </Tooltip>
          )}
          <Tooltip content="Comment on entire file" side="bottom">
            <button
              className="file-diff-icon-btn"
              onClick={() => {
                setCollapsed(false)
                setShowFileCommentForm(true)
              }}
              aria-label="Add file comment"
            >
              <MessageSquare size={13} />
            </button>
          </Tooltip>
          <label
            className={`viewed-label ${viewed ? 'viewed-checked' : ''}`}
            title={viewed ? 'Mark unviewed · v' : 'Mark viewed · v'}
          >
            <input
              type="checkbox"
              checked={viewed}
              aria-label={viewed ? 'Mark as unviewed' : 'Mark as viewed'}
              onChange={(e) => {
                const next = e.target.checked
                // Collapse optimistically in the same event as the parent
                // viewed update so React 18 batches them into one commit.
                // Without this, viewed flips first, the card body is still
                // mounted for a frame, and scroll-to-next measures against
                // the full expanded height — landing past the next file.
                setCollapsed(next)
                onViewedChange(filePath, next)
              }}
            />
            <span className="viewed-label-text">Viewed</span>
          </label>
        </div>
      </div>

      {allowLocalActions && !collapsed && fileDiff.hunks.length > 0 && (
        <div className="file-diff-hunk-actions" onClick={(e) => e.stopPropagation()}>
          <div className="file-diff-hunk-actions-meta">
            <span className="file-diff-hunk-actions-label">
              Revert hunks
            </span>
            <Tooltip content="Preview and undo specific change blocks via git apply --reverse" side="top">
              <HelpCircle size={12} className="file-diff-hunk-help" />
            </Tooltip>
            <span className="file-diff-hunk-count">
              {fileDiff.hunks.length} block{fileDiff.hunks.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="file-diff-hunk-actions-buttons">
            {fileDiff.hunks.map((h, i) => (
              <button
                key={i}
                type="button"
                className="file-diff-hunk-revert-btn"
                onClick={() => setPreviewHunkIndex(i)}
                disabled={revertingHunk !== null}
                title={`Preview and revert hunk #${i + 1} (lines @${h.additionStart}+${h.additionLines ?? h.additionCount})`}
              >
                {revertingHunk === i ? (
                  <Loader2 size={10} className="spin" />
                ) : (
                  <Undo2 size={10} />
                )}
                <span>Hunk #{i + 1}</span>
              </button>
            ))}
          </div>
          {revertError && (
            <span className="file-diff-hunk-error" role="alert">
              <AlertCircle size={11} />
              {revertError}
            </span>
          )}
        </div>
      )}

      {/* Selective Revert Hunk Preview Modal */}
      {allowLocalActions && previewHunkIndex !== null && (() => {
        const previewHunk = fileDiff.hunks[previewHunkIndex]
        if (!previewHunk) return null
        const previewDeletedLines = fileDiff.deletionLines.slice(
          previewHunk.deletionLineIndex,
          previewHunk.deletionLineIndex + (previewHunk.deletionCount ?? previewHunk.deletionLines ?? 0)
        )
        const previewAddedLines = fileDiff.additionLines.slice(
          previewHunk.additionLineIndex,
          previewHunk.additionLineIndex + (previewHunk.additionStart !== undefined && previewHunk.additionLines !== undefined ? previewHunk.additionLines : (previewHunk.additionCount ?? 0))
        )
        return (
          <Modal
            open={previewHunkIndex !== null}
            onClose={() => setPreviewHunkIndex(null)}
            className="hunk-revert-modal"
            ariaLabel={`Selective Revert Preview Hunk #${previewHunkIndex + 1}`}
          >
            <div className="shortcuts-header">
              <div className="shortcuts-header-title">
                <Undo2 size={18} className="shortcuts-icon" />
                <h2>Revert Hunk #{previewHunkIndex + 1}</h2>
              </div>
              <button className="shortcuts-close-btn" onClick={() => setPreviewHunkIndex(null)} aria-label="Close dialog">
                <X size={16} />
              </button>
            </div>

            <div className="shortcuts-body">
              <div className="hunk-preview-intro">
                Reverting this hunk will restore the deleted (<span style={{ color: 'var(--feedback-danger-text)', fontWeight: 600 }}>red</span>) lines and remove the added (<span style={{ color: 'var(--feedback-success-text)', fontWeight: 600 }}>green</span>) lines from <strong>{filePath.split('/').pop()}</strong>.
              </div>

              <div className="hunk-preview-container">
                <div className="hunk-preview-header">
                  <span>{filePath}</span>
                  <span>Lines: @-{previewHunk.deletionStart},{previewHunk.deletionCount ?? previewHunk.deletionLines ?? 0} @+{previewHunk.additionStart},{previewHunk.additionLines ?? previewHunk.additionCount ?? 0}</span>
                </div>
                <div className="hunk-preview-code">
                  {previewDeletedLines.map((line, idx) => (
                    <div key={`del-${idx}`} className="hunk-preview-line hunk-preview-line-deletion">
                      <span className="hunk-preview-sign">-</span>
                      <span className="hunk-preview-text">{line}</span>
                    </div>
                  ))}
                  {previewAddedLines.map((line, idx) => (
                    <div key={`add-${idx}`} className="hunk-preview-line hunk-preview-line-addition">
                      <span className="hunk-preview-sign">+</span>
                      <span className="hunk-preview-text">{line}</span>
                    </div>
                  ))}
                  {previewDeletedLines.length === 0 && previewAddedLines.length === 0 && (
                    <div className="hunk-preview-line" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                      No changes in this hunk.
                    </div>
                  )}
                </div>
              </div>

              <HunkHistorySection
                filePath={filePath}
                deletionStart={previewHunk.deletionStart}
                deletionCount={previewHunk.deletionCount ?? previewHunk.deletionLines ?? 0}
              />
            </div>

            <div className="modal-footer">
              <button className="hunk-revert-btn-secondary" onClick={() => setPreviewHunkIndex(null)}>
                Cancel
              </button>
              <button
                className="hunk-revert-btn-primary"
                onClick={async () => {
                  const idx = previewHunkIndex
                  setPreviewHunkIndex(null)
                  await handleRevertHunk(idx, true)
                }}
              >
                Revert Changes
              </button>
            </div>
          </Modal>
        )
      })()}
      {!collapsed && (
        <div className="file-diff-card-body">
          {!bodyMounted && (
            <div className="file-diff-body-placeholder" aria-hidden="true">
              Loading diff…
            </div>
          )}
          {bodyMounted && fileDiff.hunks.length > 0 && (
            <DiffMinimap
              fileDiff={fileDiff}
              filePath={filePath}
              onJump={(path, line) => {
                scrollToLine(path, line, 'additions')
              }}
            />
          )}
          {/* File-level comments section */}
          {bodyMounted && (fileLevelAnnotations.length > 0 || existingFileLevelComments.length > 0 || showFileCommentForm) && (
            <div 
              className="file-level-comments-section"
              style={{
                margin: '16px 20px',
                padding: '12px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                <MessageSquare size={14} />
                <span>File-Level Comments ({fileLevelAnnotations.length + existingFileLevelComments.length})</span>
              </div>
              
              {fileLevelAnnotations.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {fileLevelAnnotations.map((anno) => (
                    <CommentBubble
                      key={anno.metadata.id}
                      comment={anno.metadata}
                      onDelete={onDeleteComment}
                    />
                  ))}
                </div>
              )}

              {existingFileLevelComments.map((comment) => (
                <ExistingPrCommentBubble
                  key={`github-${comment.id}`}
                  comment={comment}
                  onReply={onReplyExisting}
                  onEdit={onEditExisting}
                  onDelete={onDeleteExisting}
                  onSetResolved={onSetExistingResolved}
                />
              ))}

              {showFileCommentForm && (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <CommentForm
                    draftKey={`file-comment:${filePath}`}
                    lineContent=""
                    onSubmit={(body, severity) => {
                      onAddComment(filePath, 'additions', 0, '', body, undefined, severity)
                      setShowFileCommentForm(false)
                    }}
                    onCancel={() => setShowFileCommentForm(false)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Render switch: when the user opts in to "Expand Context",
              we use MultiFileDiff (computes the diff from full file
              contents, so unchanged hunks are expandable). Otherwise
              the cheaper FileDiff render is used against the parsed
              partial patch. Lazy-mounted until near the viewport. */}
          {bodyMounted && contentsReady ? (
            <MultiFileDiff<ReviewComment | { _pending: true } | { _existingPr: true; comment: PrExistingComment }>
              oldFile={{ name: oldFilePath, contents: oldContent ?? '' }}
              newFile={{ name: filePath, contents: newContent ?? '' }}
              options={{
                diffStyle,
                enableGutterUtility: true,
                enableLineSelection: true,
                disableFileHeader: true,
                lineDiffType,
                overflow: lineWrap ? 'wrap' : 'scroll',
                diffIndicators,
                disableLineNumbers: !showLineNumbers,
                hunkSeparators,
                lineHoverHighlight,
                expandUnchanged: false,
                collapsedContextThreshold,
                expansionLineCount,
                onLineSelectionStart: handleSelectionStart,
                onLineSelectionChange: handleSelectionChange,
                onLineSelectionEnd: handleSelectionEnd,
                onGutterUtilityClick: handleGutterUtilityClick,
                onLineNumberClick: (props) => {
                  const side = props.annotationSide === 'deletions' ? 'deletions' : 'additions'
                  const short = `${filePath}:${side === 'deletions' ? '-' : '+'}${props.lineNumber}`
                  const params = new URLSearchParams({
                    file: filePath,
                    line: String(props.lineNumber),
                    side,
                  })
                  const full =
                    typeof window !== 'undefined'
                      ? `${window.location.origin}${window.location.pathname}?${params}`
                      : short
                  navigator.clipboard?.writeText(full).then(
                    () => {
                      setPermalinkFlash(short)
                      setTimeout(() => setPermalinkFlash(null), 1600)
                    },
                    () => {},
                  )
                },
                theme: {
                  dark: shikiConfig.type === 'dark' ? shikiConfig.themeName : 'nord',
                  light: shikiConfig.type === 'light' ? shikiConfig.themeName : 'github-light',
                },
                themeType: shikiConfig.type,
                unsafeCSS,
              }}
              // Only control selection while a draft is open — never push null mid-drag.
              selectedLines={pending ? selectedRange : undefined}
              lineAnnotations={allAnnotations}
              renderHeaderMetadata={() => null}
              renderAnnotation={renderAnnotationFn}
            />
          ) : bodyMounted ? (
          <FileDiff<ReviewComment | { _pending: true } | { _existingPr: true; comment: PrExistingComment }>
            fileDiff={fileDiff}
            options={{
              diffStyle,
              enableGutterUtility: true,
              enableLineSelection: true,
              disableFileHeader: true, // Disable built-in header to use custom header
              lineDiffType,
              overflow: lineWrap ? 'wrap' : 'scroll',
              diffIndicators,
              disableLineNumbers: !showLineNumbers,
              hunkSeparators,
              lineHoverHighlight,
              onLineSelectionStart: handleSelectionStart,
              onLineSelectionChange: handleSelectionChange,
              onLineSelectionEnd: handleSelectionEnd,
              onGutterUtilityClick: handleGutterUtilityClick,
              onLineNumberClick: (props) => {
                const side = props.annotationSide === 'deletions' ? 'deletions' : 'additions'
                const short = `${filePath}:${side === 'deletions' ? '-' : '+'}${props.lineNumber}`
                const params = new URLSearchParams({
                  file: filePath,
                  line: String(props.lineNumber),
                  side,
                })
                const full =
                  typeof window !== 'undefined'
                    ? `${window.location.origin}${window.location.pathname}?${params}`
                    : short
                navigator.clipboard?.writeText(full).then(
                  () => {
                    setPermalinkFlash(short)
                    setTimeout(() => setPermalinkFlash(null), 1600)
                  },
                  () => {},
                )
              },
              theme: {
                dark: shikiConfig.type === 'dark' ? shikiConfig.themeName : 'nord',
                light: shikiConfig.type === 'light' ? shikiConfig.themeName : 'github-light',
              },
              themeType: shikiConfig.type,
              unsafeCSS,
            }}
            selectedLines={pending ? selectedRange : undefined}
            lineAnnotations={allAnnotations}
            renderHeaderMetadata={() => null} // Header is disabled
            renderAnnotation={renderAnnotationFn}
          />
          ) : null}
        </div>
      )}
    </div>
  )
})

function HunkHistorySection({
  filePath,
  deletionStart,
  deletionCount,
}: {
  filePath: string
  deletionStart: number
  deletionCount: number
}) {
  const [data, setData] = useState<HunkHistoryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const fetchData = async () => {
      setLoading(true)
      setError(null)
      try {
        const queryParams = new URLSearchParams({
          filePath,
          deletionStart: String(deletionStart),
          deletionCount: String(deletionCount),
        })
        const res = await fetch(`/api/hunk-history?${queryParams}`)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const json = await res.json()
        if (active) {
          setData(json)
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || 'Failed to fetch hunk history')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    fetchData()
    return () => {
      active = false
    }
  }, [filePath, deletionStart, deletionCount])

  if (loading) {
    return (
      <div className="hunk-history-loading">
        <Loader2 size={14} className="spin" style={{ marginRight: '8px' }} />
        <span>Loading git history & origin blame…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="hunk-history-error">
        <AlertCircle size={14} style={{ color: 'var(--feedback-danger-text)', marginRight: '8px' }} />
        <span>Failed to load git history: {error}</span>
      </div>
    )
  }

  if (!data) return null

  // Get unique commits from blame
  const uniqueBlames = Array.from(
    new Map(data.blame.map((item) => [item.commit, item])).values()
  )

  return (
    <div className="hunk-history-section">
      {uniqueBlames.length > 0 && (
        <div className="hunk-history-block">
          <h3 className="hunk-history-title">Commit(s) introducing deleted lines</h3>
          <div className="hunk-history-commits">
            {uniqueBlames.map((entry) => (
              <div key={entry.commit} className="hunk-history-commit-card">
                <div className="hunk-history-commit-header">
                  <span className="hunk-history-commit-hash">{entry.commit}</span>
                  <span className="hunk-history-commit-author">
                    <User size={11} />
                    <span>{entry.author}</span>
                  </span>
                  <span className="hunk-history-commit-date">
                    <Clock size={11} />
                    <span>{entry.date}</span>
                  </span>
                </div>
                <div className="hunk-history-commit-msg">{entry.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recentCommits.length > 0 && (
        <div className="hunk-history-block">
          <h3 className="hunk-history-title">Recent File Modification History</h3>
          <div className="hunk-history-log">
            {data.recentCommits.map((c) => (
              <div key={c.hash} className="hunk-history-log-row">
                <span className="hunk-history-log-hash">{c.hash}</span>
                <span className="hunk-history-log-msg" title={c.summary}>{c.summary}</span>
                <span className="hunk-history-log-author">{c.author}</span>
                <span className="hunk-history-log-date">{c.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function buildUnsafeCSS(tabSize: number, fontSize: number, fontFamily: string): string {
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
      cursor: pointer !important;
    }
    [data-line]:hover [data-column-number] {
      opacity: 1 !important;
      color: var(--primary) !important;
    }
    [data-line][data-line-type="addition"] {
      background-color: var(--feedback-success-bg) !important;
      border-left: 3px solid var(--feedback-success-border) !important;
    }
    [data-line][data-line-type="deletion"] {
      background-color: var(--feedback-danger-bg) !important;
      border-left: 3px solid var(--feedback-danger-border) !important;
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
