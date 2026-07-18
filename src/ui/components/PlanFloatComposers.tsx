import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical, Minus, Maximize2, X, MessageSquarePlus } from 'lucide-react'
import { CommentForm } from './CommentForm'
import { getDraft, clearDraft } from '../drafts'
import type { CommentSeverity } from '../../lib/types'

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
  minimized: boolean
  /** Document-space rects for persistent highlight overlays. */
  highlightRects: PageRect[]
}

const PANEL_W = 400
const PANEL_H_EST = 420

export function clampToWindow(left: number, top: number, w = PANEL_W, h = PANEL_H_EST) {
  const pad = 12
  const maxL = Math.max(pad, window.innerWidth - w - pad)
  const maxT = Math.max(pad, window.innerHeight - Math.min(h, window.innerHeight - pad * 2) - pad)
  return {
    left: Math.min(Math.max(pad, left), maxL),
    top: Math.min(Math.max(pad, top), maxT),
  }
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

function confirmDiscard(label: string): boolean {
  return window.confirm(
    `Discard this comment draft${label ? ` (${label})` : ''}?\n\nUnsaved text will be lost.`,
  )
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
}

/**
 * Multi-instance floating plan comment composers with:
 * - persistent selection highlights
 * - drag + window clamp
 * - minimize / restore
 * - confirm before discard when draft has text
 * - Esc closes topmost (with confirm)
 */
export function PlanFloatComposers({
  planId,
  composers,
  onChange,
  onSubmit,
}: PlanFloatComposersProps) {
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    origLeft: number
    origTop: number
  } | null>(null)

  const updateOne = useCallback(
    (id: string, patch: Partial<FloatComposerDraft>) => {
      onChange((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    },
    [onChange],
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
      const label = c.selectedQuote.slice(0, 40)
      if (hasUnsavedDraft(planId, id) && !confirmDiscard(label)) return
      removeOne(id)
    },
    [composers, planId, removeOne],
  )

  const onDragStart = useCallback(
    (id: string, e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return
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
        const next = clampToWindow(left, top)
        onChange((prev) => prev.map((x) => (x.id === id ? { ...x, panelPos: next } : x)))
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

  // Esc: close selection is handled by parent; here close topmost non-minimized
  // composer with confirm if dirty.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Prefer the last (most recently added) expanded composer.
      const open = [...composers].reverse().find((c) => !c.minimized)
      if (!open) return
      e.preventDefault()
      e.stopPropagation()
      requestClose(open.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [composers, requestClose])

  // Re-clamp all panels on resize.
  useEffect(() => {
    if (composers.length === 0) return
    const onResize = () => {
      onChange((prev) =>
        prev.map((c) => ({
          ...c,
          panelPos: clampToWindow(c.panelPos.left, c.panelPos.top),
        })),
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [composers, onChange])

  if (composers.length === 0 || typeof document === 'undefined') return null

  const minimized = composers.filter((c) => c.minimized)
  const expanded = composers.filter((c) => !c.minimized)

  const layer = (
    <>
      {/* Document-space highlights (scroll with the page). */}
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
        return (
          <div
            key={c.id}
            className="plan-selection-comment plan-selection-comment-floating"
            role="dialog"
            aria-label={`Add plan comment ${index + 1}`}
            style={{
              left: c.panelPos.left,
              top: c.panelPos.top,
              width: Math.min(PANEL_W, window.innerWidth - 24),
              zIndex: 110 + index,
            }}
          >
            <div
              className="plan-selection-comment-drag"
              onMouseDown={(e) => onDragStart(c.id, e)}
              title="Drag to move"
            >
              <GripVertical size={14} aria-hidden="true" />
              <span className="plan-selection-comment-meta">
                Commenting on{' '}
                {c.startLineNumber && c.startLineNumber !== c.lineNumber
                  ? `lines ${c.startLineNumber}–${c.lineNumber}`
                  : `line ${c.lineNumber}`}
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
            <CommentForm
              draftKey={draftKey(planId, c.id)}
              lineContent={c.exactLines}
              showSeverity
              onSubmit={(body, severity) => {
                onSubmit(c, body, severity)
                clearDraft(draftKey(planId, c.id))
                onChange((prev) => prev.filter((x) => x.id !== c.id))
              }}
              onCancel={() => requestClose(c.id)}
            />
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
    </>
  )

  return createPortal(layer, document.body)
}
