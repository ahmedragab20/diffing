import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical, Minus, Maximize2, X, MessageSquarePlus } from 'lucide-react'
import { CommentForm } from './CommentForm'
import { ConfirmDialog } from '../primitives/ConfirmDialog'
import { getDraft, clearDraft } from '../drafts'
import type { CommentSeverity } from '../../lib/types'
import { extractPlanLines } from '../../lib/plan-format'
import {
  adjustPendingStart,
  adjustPendingEnd,
  canAdjustPendingStart,
  canAdjustPendingEnd,
  normalizePendingRange,
  pendingOrderedRange,
  type PendingLineComment,
} from '../lib/commentSelection'
import { measureQuoteInRoot } from '../lib/planSelection'

export interface PageRect {
  top: number
  left: number
  width: number
  height: number
}

export interface FloatComposerDraft {
  id: string
  lineNumber: number
  startLineNumber?: number
  selectedQuote: string
  /** Full source context shown in the card + sent as lineContent. */
  sourceContext: string
  /** Exact source lines (for suggest-change). */
  exactLines: string
  sectionTitle?: string
  panelPos: { left: number; top: number }
  /** Explicit size so the panel can be resized from any edge. */
  panelSize: { width: number; height: number }
  minimized: boolean
  /** Document-space rects for persistent highlight overlays. */
  highlightRects: PageRect[]
}

export const PANEL_DEFAULT_W = 400
export const PANEL_DEFAULT_H = 420
const PANEL_MIN_W = 300
const PANEL_MIN_H = 240
const WINDOW_PAD = 12

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export function clampPanelRect(
  left: number,
  top: number,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const maxW = Math.max(PANEL_MIN_W, window.innerWidth - WINDOW_PAD * 2)
  const maxH = Math.max(PANEL_MIN_H, window.innerHeight - WINDOW_PAD * 2)
  let w = Math.min(Math.max(PANEL_MIN_W, width), maxW)
  let h = Math.min(Math.max(PANEL_MIN_H, height), maxH)
  let l = left
  let t = top
  // Keep fully inside the viewport.
  if (l + w > window.innerWidth - WINDOW_PAD) l = window.innerWidth - WINDOW_PAD - w
  if (t + h > window.innerHeight - WINDOW_PAD) t = window.innerHeight - WINDOW_PAD - h
  if (l < WINDOW_PAD) l = WINDOW_PAD
  if (t < WINDOW_PAD) t = WINDOW_PAD
  // If still overflowing (tiny window), shrink to fit from top-left.
  w = Math.min(w, window.innerWidth - WINDOW_PAD - l)
  h = Math.min(h, window.innerHeight - WINDOW_PAD - t)
  w = Math.max(PANEL_MIN_W, w)
  h = Math.max(PANEL_MIN_H, h)
  return { left: l, top: t, width: w, height: h }
}

/** Back-compat helper used by PlanReview when placing a new panel. */
export function clampToWindow(left: number, top: number, w = PANEL_DEFAULT_W, h = PANEL_DEFAULT_H) {
  const r = clampPanelRect(left, top, w, h)
  return { left: r.left, top: r.top }
}

export function clientRectsToPage(range: Range): PageRect[] {
  const sx = window.scrollX
  const sy = window.scrollY
  return Array.from(range.getClientRects())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      top: r.top + sy,
      left: r.left + sx,
      width: r.width,
      height: r.height,
    }))
}

function draftKey(planId: string, id: string) {
  return `plan-float:${planId}:${id}`
}

function hasUnsavedDraft(planId: string, id: string): boolean {
  const body = getDraft(draftKey(planId, id))
  return !!(body && body.trim())
}

interface PlanFloatComposersProps {
  planId: string
  composers: FloatComposerDraft[]
  onChange: React.Dispatch<React.SetStateAction<FloatComposerDraft[]>>
  onSubmit: (
    draft: FloatComposerDraft,
    body: string,
    severity?: CommentSeverity,
  ) => void
  /** Plan source body — enables bidirectional line-range adjust in the form. */
  planBody?: string
  /** Agent context builder for the adjusted span (exact ± neighbors). */
  buildSourceContext?: (startLine: number, endLine: number) => string
  /**
   * Root of the rendered plan (`.plan-rendered`). Used to remeasure highlight
   * overlays after layout shifts (comment delete, mode switch, etc.).
   */
  renderedRootRef?: React.RefObject<HTMLElement | null>
  /**
   * Bump when inline comments / body layout change so highlights re-glue to
   * the text after reflow.
   */
  layoutEpoch?: string | number
}

/**
 * Multi-instance floating plan comment composers with:
 * - persistent selection highlights
 * - drag + resize from all sides
 * - minimize / restore
 * - confirm before discard when draft has text
 * - Esc closes topmost (with confirm)
 * - bidirectional line-range steppers (when planBody is provided)
 */
export function PlanFloatComposers({
  planId,
  composers,
  onChange,
  onSubmit,
  planBody,
  buildSourceContext,
  renderedRootRef,
  layoutEpoch,
}: PlanFloatComposersProps) {
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    origLeft: number
    origTop: number
  } | null>(null)

  const resizeRef = useRef<{
    id: string
    edge: ResizeEdge
    startX: number
    startY: number
    origLeft: number
    origTop: number
    origW: number
    origH: number
  } | null>(null)

  const [pendingDiscard, setPendingDiscard] = useState<{
    id: string
    quote: string
  } | null>(null)

  const updateOne = useCallback(
    (id: string, patch: Partial<FloatComposerDraft>) => {
      onChange((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    },
    [onChange],
  )

  const planLineBounds = useMemo(() => {
    if (!planBody) return undefined
    const total = planBody.replace(/\r\n/g, '\n').split('\n').length
    return { min: 1, max: Math.max(1, total) }
  }, [planBody])

  const applyRangeAdjust = useCallback(
    (draft: FloatComposerDraft, edge: 'start' | 'end', delta: -1 | 1) => {
      if (!planBody || !planLineBounds) return
      const pending: PendingLineComment = normalizePendingRange({
        side: 'additions',
        lineNumber: draft.lineNumber,
        startLineNumber: draft.startLineNumber,
      })
      const next =
        edge === 'start'
          ? adjustPendingStart(pending, delta, planLineBounds)
          : adjustPendingEnd(pending, delta, planLineBounds)
      const start = next.startLineNumber ?? next.lineNumber
      const end = next.lineNumber
      const exact = extractPlanLines(planBody, start, end)
      updateOne(draft.id, {
        lineNumber: end,
        startLineNumber: next.startLineNumber,
        exactLines: exact,
        sourceContext: buildSourceContext
          ? buildSourceContext(start, end)
          : exact,
      })
    },
    [planBody, planLineBounds, buildSourceContext, updateOne],
  )

  const removeOne = useCallback(
    (id: string) => {
      clearDraft(draftKey(planId, id))
      onChange((prev) => prev.filter((c) => c.id !== id))
    },
    [onChange, planId],
  )

  const requestClose = useCallback(
    (id: string) => {
      const c = composers.find((x) => x.id === id)
      if (!c) return
      if (hasUnsavedDraft(planId, id)) {
        setPendingDiscard({ id, quote: c.selectedQuote })
        return
      }
      removeOne(id)
    },
    [composers, planId, removeOne],
  )

  const confirmPendingDiscard = useCallback(() => {
    if (!pendingDiscard) return
    removeOne(pendingDiscard.id)
    setPendingDiscard(null)
  }, [pendingDiscard, removeOne])

  const onDragStart = useCallback(
    (id: string, e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, textarea, select, a, .plan-float-resize')) {
        return
      }
      const c = composers.find((x) => x.id === id)
      if (!c || c.minimized) return
      e.preventDefault()
      dragRef.current = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: c.panelPos.left,
        origTop: c.panelPos.top,
      }
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current || dragRef.current.id !== id) return
        const left = dragRef.current.origLeft + (ev.clientX - dragRef.current.startX)
        const top = dragRef.current.origTop + (ev.clientY - dragRef.current.startY)
        onChange((prev) =>
          prev.map((x) => {
            if (x.id !== id) return x
            const size = x.panelSize ?? { width: PANEL_DEFAULT_W, height: PANEL_DEFAULT_H }
            const r = clampPanelRect(left, top, size.width, size.height)
            return {
              ...x,
              panelPos: { left: r.left, top: r.top },
              panelSize: { width: r.width, height: r.height },
            }
          }),
        )
      }
      const onUp = () => {
        dragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [composers, onChange],
  )

  const onResizeStart = useCallback(
    (id: string, edge: ResizeEdge, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const c = composers.find((x) => x.id === id)
      if (!c || c.minimized) return
      const size = c.panelSize ?? { width: PANEL_DEFAULT_W, height: PANEL_DEFAULT_H }
      resizeRef.current = {
        id,
        edge,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: c.panelPos.left,
        origTop: c.panelPos.top,
        origW: size.width,
        origH: size.height,
      }
      const onMove = (ev: MouseEvent) => {
        const st = resizeRef.current
        if (!st || st.id !== id) return
        const dx = ev.clientX - st.startX
        const dy = ev.clientY - st.startY
        let left = st.origLeft
        let top = st.origTop
        let width = st.origW
        let height = st.origH

        if (st.edge.includes('e')) width = st.origW + dx
        if (st.edge.includes('s')) height = st.origH + dy
        if (st.edge.includes('w')) {
          width = st.origW - dx
          left = st.origLeft + dx
        }
        if (st.edge.includes('n')) {
          height = st.origH - dy
          top = st.origTop + dy
        }

        // Enforce min size while preserving the opposite edge.
        if (width < PANEL_MIN_W) {
          if (st.edge.includes('w')) left = st.origLeft + st.origW - PANEL_MIN_W
          width = PANEL_MIN_W
        }
        if (height < PANEL_MIN_H) {
          if (st.edge.includes('n')) top = st.origTop + st.origH - PANEL_MIN_H
          height = PANEL_MIN_H
        }

        const r = clampPanelRect(left, top, width, height)
        onChange((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  panelPos: { left: r.left, top: r.top },
                  panelSize: { width: r.width, height: r.height },
                }
              : x,
          ),
        )
      }
      const onUp = () => {
        resizeRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [composers, onChange],
  )

  // Esc: close topmost non-minimized composer with confirm if dirty.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const open = [...composers].reverse().find((c) => !c.minimized)
      if (!open) return
      e.preventDefault()
      e.stopPropagation()
      requestClose(open.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [composers, requestClose])

  // Re-clamp all panels on window resize.
  useEffect(() => {
    if (composers.length === 0) return
    const onResize = () => {
      onChange((prev) =>
        prev.map((c) => {
          const size = c.panelSize ?? { width: PANEL_DEFAULT_W, height: PANEL_DEFAULT_H }
          const r = clampPanelRect(c.panelPos.left, c.panelPos.top, size.width, size.height)
          return {
            ...c,
            panelPos: { left: r.left, top: r.top },
            panelSize: { width: r.width, height: r.height },
          }
        }),
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [composers.length, onChange])

  /**
   * After layout shifts (deleting an inline comment, mode change, etc.),
   * remeasure page-space highlight rects from the current rendered DOM so
   * overlays stay on the selected quote instead of floating at stale coords.
   */
  useEffect(() => {
    if (composers.length === 0) return
    const root = renderedRootRef?.current
    if (!root) return

    let raf = 0
    const remeasure = () => {
      onChange((prev) => {
        let changed = false
        const next = prev.map((c) => {
          const quote = (c.selectedQuote || c.exactLines || '').trim()
          if (!quote) return c
          const rects = measureQuoteInRoot(root, quote)
          if (rects.length === 0) return c
          // Cheap equality: length + first/last top.
          const same =
            rects.length === c.highlightRects.length &&
            rects.every((r, i) => {
              const o = c.highlightRects[i]
              return (
                o &&
                Math.abs(o.top - r.top) < 0.5 &&
                Math.abs(o.left - r.left) < 0.5 &&
                Math.abs(o.width - r.width) < 0.5 &&
                Math.abs(o.height - r.height) < 0.5
              )
            })
          if (same) return c
          changed = true
          return { ...c, highlightRects: rects }
        })
        return changed ? next : prev
      })
    }

    // Double rAF: wait for React to commit segment/comment DOM after delete.
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(remeasure)
    })
    return () => cancelAnimationFrame(raf)
  }, [layoutEpoch, composers.length, renderedRootRef, onChange])

  if (composers.length === 0 || typeof document === 'undefined') return null

  const minimized = composers.filter((c) => c.minimized)
  const expanded = composers.filter((c) => !c.minimized)
  const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  const layer = (
    <>
      <div className="plan-float-highlights" aria-hidden="true">
        {composers.map((c) =>
          c.highlightRects.map((r, i) => (
            <div
              key={`${c.id}-hl-${i}`}
              className="plan-float-highlight"
              style={{
                top: r.top,
                left: r.left,
                width: r.width,
                height: r.height,
              }}
            />
          )),
        )}
      </div>

      {expanded.map((c, index) => {
        const section = c.sectionTitle
        const size = c.panelSize ?? { width: PANEL_DEFAULT_W, height: PANEL_DEFAULT_H }
        return (
          <div
            key={c.id}
            className="plan-selection-comment plan-selection-comment-floating"
            role="dialog"
            aria-label={`Add plan comment ${index + 1}`}
            style={{
              left: c.panelPos.left,
              top: c.panelPos.top,
              width: size.width,
              height: size.height,
              zIndex: 110 + index,
            }}
          >
            {edges.map((edge) => (
              <div
                key={edge}
                className={`plan-float-resize plan-float-resize-${edge}`}
                onMouseDown={(e) => onResizeStart(c.id, edge, e)}
                aria-hidden="true"
              />
            ))}
            <div
              className="plan-selection-comment-drag"
              onMouseDown={(e) => onDragStart(c.id, e)}
              title="Drag to move"
            >
              <GripVertical size={14} aria-hidden="true" />
              <span className="plan-selection-comment-meta">
                Commenting on{' '}
                {c.startLineNumber && c.startLineNumber !== c.lineNumber
                  ? `L${c.startLineNumber}–L${c.lineNumber}`
                  : `L${c.lineNumber}`}
                {section ? ` · § ${section}` : ''}
              </span>
              <button
                type="button"
                className="plan-selection-comment-close"
                aria-label="Minimize"
                title="Minimize"
                onClick={() => updateOne(c.id, { minimized: true })}
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="plan-selection-comment-close"
                aria-label="Close comment form"
                title="Close (Esc)"
                onClick={() => requestClose(c.id)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="plan-selection-comment-body">
              <div className="plan-selection-comment-context">
                {c.selectedQuote.trim() ? (
                  <blockquote className="plan-comment-quote" cite={`L${c.lineNumber}`}>
                    “{c.selectedQuote.trim()}”
                  </blockquote>
                ) : null}
                <pre className="plan-comment-source" aria-label="Source context for agent">
                  {c.sourceContext || c.exactLines || '(no source lines)'}
                </pre>
              </div>
              <div className="plan-selection-comment-form">
                <CommentForm
                  draftKey={draftKey(planId, c.id)}
                  lineContent={c.exactLines}
                  lineLabel={
                    c.startLineNumber && c.startLineNumber !== c.lineNumber
                      ? `L${c.startLineNumber}–L${c.lineNumber} · source`
                      : `L${c.lineNumber} · source`
                  }
                  showSeverity
                  range={
                    planBody && planLineBounds
                      ? (() => {
                          const pending = normalizePendingRange({
                            side: 'additions',
                            lineNumber: c.lineNumber,
                            startLineNumber: c.startLineNumber,
                          })
                          const ordered = pendingOrderedRange(pending)
                          return {
                            start: ordered.start,
                            end: ordered.end,
                            sideLabel: 'source',
                            canAdjustStart: (d) =>
                              canAdjustPendingStart(pending, d, planLineBounds),
                            canAdjustEnd: (d) =>
                              canAdjustPendingEnd(pending, d, planLineBounds),
                          }
                        })()
                      : undefined
                  }
                  onAdjustStart={
                    planBody
                      ? (delta) => applyRangeAdjust(c, 'start', delta)
                      : undefined
                  }
                  onAdjustEnd={
                    planBody
                      ? (delta) => applyRangeAdjust(c, 'end', delta)
                      : undefined
                  }
                  onSubmit={(body, severity) => {
                    onSubmit(c, body, severity)
                    clearDraft(draftKey(planId, c.id))
                    onChange((prev) => prev.filter((x) => x.id !== c.id))
                  }}
                  onCancel={() => requestClose(c.id)}
                />
              </div>
            </div>
          </div>
        )
      })}

      {minimized.length > 0 && (
        <div className="plan-float-tray" role="toolbar" aria-label="Minimized comment drafts">
          {minimized.map((c) => (
            <div key={c.id} className="plan-float-tray-chip-wrap">
              <button
                type="button"
                className="plan-float-tray-chip"
                title={c.selectedQuote}
                onClick={() => updateOne(c.id, { minimized: false })}
              >
                <MessageSquarePlus size={12} aria-hidden="true" />
                <span className="plan-float-tray-line">
                  L
                  {c.startLineNumber && c.startLineNumber !== c.lineNumber
                    ? `${c.startLineNumber}–${c.lineNumber}`
                    : c.lineNumber}
                </span>
                <span className="plan-float-tray-quote">
                  {c.selectedQuote.slice(0, 28)}
                  {c.selectedQuote.length > 28 ? '…' : ''}
                </span>
                <Maximize2 size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="plan-float-tray-close"
                aria-label="Close draft"
                title="Close"
                onClick={() => requestClose(c.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDiscard}
        title="Discard comment draft?"
        description="Unsaved text in this floating comment will be lost."
        detail={
          pendingDiscard?.quote
            ? `“${pendingDiscard.quote.slice(0, 120)}${pendingDiscard.quote.length > 120 ? '…' : ''}”`
            : undefined
        }
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={confirmPendingDiscard}
        onCancel={() => setPendingDiscard(null)}
      />
    </>
  )

  return createPortal(layer, document.body)
}
