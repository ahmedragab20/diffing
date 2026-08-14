import { useCallback, useEffect, useRef, useState } from 'react'
import { History, MessagesSquare, PanelRightClose, X } from 'lucide-react'
import type { MockupComment } from '../../lib/mockup-types'
import { getUiStateItem, setUiStateItem } from '../utils/uiState'
import { hitLabel } from './MockupAnchors'
import { MockupLocationChips } from './MockupLocationChips'

const RAIL_WIDTH_KEY = 'diffing-mockup-comments-rail-width'
const RAIL_MIN_WIDTH = 240
const RAIL_MAX_WIDTH = 420

export interface MockupCommentsRailProps {
  /** Comments scoped to the current version + screen + viewport (sorted). */
  comments: MockupComment[]
  /** Open comments from older versions (same screen + viewport), not on the canvas. */
  priorVersionOpen: MockupComment[]
  scopedOpenCount: number
  totalOpenCount: number
  selectedId: string | null
  onSelect: (id: string) => void
  /** Jump the version switcher to a comment's version (history group). */
  onJumpToComment: (comment: MockupComment) => void
  onClose: () => void
  /** True on narrow widths — rail renders as a bottom sheet. */
  sheet: boolean
}

function RailItem({
  comment,
  index,
  active,
  onClick,
}: {
  comment: MockupComment
  index: number
  active: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        className={`plan-comments-rail-item ${comment.status === 'resolved' ? 'is-resolved' : ''} ${active ? 'is-active' : ''}`}
        onClick={onClick}
        title={comment.body.slice(0, 200)}
      >
        <span className="plan-comments-rail-line">
          #{index} {hitLabel(comment)}
        </span>
        <span className="mockup-rail-chips">
          <MockupLocationChips comment={comment} compact />
          {comment.severity && comment.severity !== 'none' && (
            <span
              className={`plan-comment-severity plan-comment-severity-${comment.severity}`}
            >
              {comment.severity}
            </span>
          )}
        </span>
        <span className="plan-comments-rail-preview">
          {comment.body.replace(/\s+/g, ' ').slice(0, 80)}
          {comment.body.length > 80 ? '…' : ''}
        </span>
        <span
          className={`plan-comments-rail-status plan-comments-rail-status-${comment.status}`}
        >
          {comment.status}
          {comment.replies.length > 0
            ? ` · ${comment.replies.length} reply${comment.replies.length === 1 ? '' : 's'}`
            : ''}
        </span>
      </button>
    </li>
  )
}

/**
 * Right-side comments map for the mockup review: scoped threads plus an
 * explicit prior-version unresolved history group (never pinned on the
 * current canvas). Persisted width, resizable, collapses to a bottom sheet on
 * narrow widths (same surface as the plan comments map).
 */
export function MockupCommentsRail({
  comments,
  priorVersionOpen,
  scopedOpenCount,
  totalOpenCount,
  selectedId,
  onSelect,
  onJumpToComment,
  onClose,
  sheet,
}: MockupCommentsRailProps) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = getUiStateItem(RAIL_WIDTH_KEY)
      if (stored) {
        const n = Number(stored)
        if (Number.isFinite(n))
          return Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, n))
      }
    } catch {
      /* ignore */
    }
    return 280
  })
  const widthRef = useRef(width)
  widthRef.current = width

  useEffect(() => {
    try {
      setUiStateItem(RAIL_WIDTH_KEY, String(width))
    } catch {
      /* ignore */
    }
  }, [width])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = widthRef.current
    const onMove = (ev: MouseEvent) => {
      // Dragging left (smaller clientX) widens the rail.
      const next = Math.max(
        RAIL_MIN_WIDTH,
        Math.min(RAIL_MAX_WIDTH, startWidth + (startX - ev.clientX)),
      )
      setWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  return (
    <aside
      className={`plan-comments-rail mockup-comments-rail ${sheet ? 'plan-comments-sheet' : ''}`}
      aria-label="Comments map"
      style={sheet ? undefined : { width }}
      {...(sheet ? { role: 'dialog', 'aria-modal': true as const } : {})}
    >
      <div className="plan-comments-rail-head">
        <MessagesSquare size={12} aria-hidden="true" />
        <span>Comments</span>
        <span
          className="plan-comments-rail-count"
          title={`${scopedOpenCount} open in this view · ${totalOpenCount} open total`}
        >
          {scopedOpenCount} in view
          {totalOpenCount !== scopedOpenCount
            ? ` · ${totalOpenCount} total`
            : ''}
        </span>
        {!sheet && (
          <button
            type="button"
            className="plan-comments-sheet-close"
            onClick={onClose}
            aria-label="Close comments map"
            title="Close comments map (c)"
          >
            <PanelRightClose size={14} aria-hidden="true" />
          </button>
        )}
        {sheet && (
          <button
            type="button"
            className="plan-comments-sheet-close"
            onClick={onClose}
            aria-label="Close comments map"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <ul className="plan-comments-rail-list">
        {comments.length === 0 && priorVersionOpen.length === 0 && (
          <li className="plan-list-empty">No comments in this view.</li>
        )}
        {comments.map((c, i) => (
          <RailItem
            key={c.id}
            comment={c}
            index={i + 1}
            active={selectedId === c.id}
            onClick={() => {
              onSelect(c.id)
              if (sheet) onClose()
            }}
          />
        ))}
      </ul>
      {priorVersionOpen.length > 0 && (
        <div className="mockup-rail-history">
          <div className="mockup-rail-history-head">
            <History size={11} aria-hidden="true" />
            <span>Prior versions · unresolved</span>
            <span className="plan-comments-rail-count">
              {priorVersionOpen.length}
            </span>
          </div>
          <ul className="plan-comments-rail-list mockup-rail-history-list">
            {priorVersionOpen.map((c, i) => (
              <RailItem
                key={c.id}
                comment={c}
                index={i + 1}
                active={false}
                onClick={() => {
                  onJumpToComment(c)
                  if (sheet) onClose()
                }}
              />
            ))}
          </ul>
        </div>
      )}
      {!sheet && (
        <div
          className="mockup-rail-resize-handle"
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize comments rail"
        />
      )}
    </aside>
  )
}
