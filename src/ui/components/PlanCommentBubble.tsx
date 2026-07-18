import { useState, useEffect } from 'react'
import {
  CheckCircle2,
  Bot,
  User,
  Reply,
  Pencil,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import type { PlanComment } from '../../lib/plan-types'
import { timeAgo } from '../utils'
import { Markdown } from './Markdown'
import { CommentForm } from './CommentForm'

interface PlanCommentBubbleProps {
  comment: PlanComment
  onResolve: () => void
  onUnresolve: () => void
  onDelete: () => void
  onEdit: (body: string) => void
  onReply: (body: string) => void
  onEditReply: (replyId: string, body: string) => void
  onDeleteReply: (replyId: string) => void
}

function AvatarIcon({ role, size = 16 }: { role: 'user' | 'agent'; size?: number }) {
  if (role === 'agent') {
    return (
      <div className="comment-avatar-circle comment-avatar-agent" style={{ width: `${size * 2}px`, height: `${size * 2}px` }}>
        <Bot size={size} aria-hidden="true" />
      </div>
    )
  }
  return (
    <div className="comment-avatar-circle comment-avatar-user" style={{ width: `${size * 2}px`, height: `${size * 2}px` }}>
      <User size={size} aria-hidden="true" />
    </div>
  )
}

/**
 * A comment thread anchored to a line / range / section of a plan. Structurally
 * the plan-side twin of {@link CommentBubble}, reusing the same CSS so the two
 * review surfaces look identical, but driven by callbacks (scoped to a plan id
 * by the parent) rather than the diff comment store.
 */
export function PlanCommentBubble({
  comment,
  onResolve,
  onUnresolve,
  onDelete,
  onEdit,
  onReply,
  onEditReply,
  onDeleteReply,
}: PlanCommentBubbleProps) {
  const [, setTick] = useState(0)
  const isResolved = comment.status === 'resolved'
  /** Open threads start expanded; resolved start collapsed. User can toggle either. */
  const [collapsed, setCollapsed] = useState(isResolved)
  const [isReplying, setIsReplying] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deleteReplyId, setDeleteReplyId] = useState<string | null>(null)
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null)

  const deleteConfirmControls = (
    <div className="comment-delete-confirm" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <button
        type="button"
        className="comment-node-btn comment-node-btn-delete"
        onClick={() => {
          setDeleteConfirming(false)
          onDelete()
        }}
        title="Confirm delete"
        aria-label="Confirm delete comment"
        style={{
          color: 'var(--danger)',
          background: 'var(--feedback-danger-bg)',
          fontWeight: 600,
          fontSize: '11px',
          border: '1px solid var(--feedback-danger-border)',
          padding: '2px 6px',
          width: 'auto',
          height: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
        }}
      >
        <AlertTriangle size={11} />
        Delete?
      </button>
      <button
        type="button"
        className="comment-node-btn"
        onClick={() => setDeleteConfirming(false)}
        title="Cancel delete"
        aria-label="Cancel delete"
        style={{ fontSize: '11px', padding: '2px 6px', width: 'auto', height: 'auto' }}
      >
        Cancel
      </button>
    </div>
  )

  useEffect(() => {
    // Auto-collapse when newly resolved; leave open if user re-opens a resolved thread.
    if (comment.status === 'resolved') setCollapsed(true)
  }, [comment.status])
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const isWholePlan = comment.lineNumber === 0
  const isRange = comment.startLineNumber && comment.startLineNumber !== comment.lineNumber
  const bodyPreview = comment.body.replace(/\s+/g, ' ').trim().slice(0, 72)
  const replyCount = comment.replies?.length ?? 0

  const contextSource =
    comment.lineContent &&
    comment.lineContent.trim() !== comment.selectedQuote?.trim()
      ? comment.lineContent
      : ''
  const hasContextPreview = !!(comment.selectedQuote || contextSource)
  const contextLineCount = Math.max(
    1,
    (contextSource || comment.selectedQuote || '')
      .split('\n')
      .filter((l) => l.length > 0).length,
  )
  // Multi-line source previews start collapsed so the card stays compact.
  const [contextOpen, setContextOpen] = useState(contextLineCount <= 1)

  const locationChips = (
    <>
      {comment.sectionTitle && (
        <span className="plan-comment-section-chip" title={`Section: ${comment.sectionTitle}`}>
          §&nbsp;{comment.sectionTitle}
        </span>
      )}
      {isWholePlan ? (
        <span className="plan-comment-line-chip plan-comment-line-chip-general">Whole plan</span>
      ) : (
        <span className="plan-comment-line-chip">
          {isRange ? `L${comment.startLineNumber}–${comment.lineNumber}` : `L${comment.lineNumber}`}
        </span>
      )}
      {comment.severity && comment.severity !== 'none' && (
        <span className={`plan-comment-severity plan-comment-severity-${comment.severity}`}>
          {comment.severity}
        </span>
      )}
    </>
  )

  if (collapsed && !isEditing) {
    return (
      <div
        className={`comment-collapsed-bar ${isResolved ? 'comment-collapsed-bar-resolved' : ''}`}
        id={`plan-comment-${comment.id}`}
        role="article"
      >
        <button
          type="button"
          className="comment-collapsed-toggle"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label="Expand comment thread"
          title="Expand"
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <div className="comment-collapsed-main">
          {isResolved ? (
            <CheckCircle2 size={14} className="comment-collapsed-resolved-icon" aria-hidden="true" />
          ) : (
            <AvatarIcon role="user" size={11} />
          )}
          <span className="comment-collapsed-label">
            {isResolved ? 'Resolved' : 'User'}
          </span>
          {locationChips}
          <span className="comment-collapsed-preview" title={comment.body}>
            {bodyPreview}
            {comment.body.length > 72 ? '…' : ''}
          </span>
          <span className="comment-collapsed-meta">
            {replyCount > 0 ? `${replyCount + 1} comments` : '1 comment'}
          </span>
        </div>
        <div className="comment-collapsed-actions">
          {deleteConfirming ? (
            deleteConfirmControls
          ) : (
            <button
              type="button"
              className="comment-node-btn comment-node-btn-delete"
              onClick={() => setDeleteConfirming(true)}
              title="Delete comment"
              aria-label="Delete comment"
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="comment-collapsed-expand-btn"
            onClick={() => setCollapsed(false)}
          >
            Expand
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`comment-bubble-canvas ${isResolved ? 'comment-bubble-canvas-resolved' : ''}`}
      id={`plan-comment-${comment.id}`}
      role="article"
    >
      <div className={`comment-node ${isResolved ? 'comment-node-resolved' : ''}`}>
        <div className="comment-avatar-col">
          <AvatarIcon role="user" size={16} />
        </div>
        <div className="comment-content-col">
          <div className="comment-node-header">
            <button
              type="button"
              className="comment-collapse-btn"
              onClick={() => setCollapsed(true)}
              aria-expanded={true}
              aria-label="Collapse comment thread"
              title="Collapse"
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <span className="comment-node-author">User</span>
            <span className="comment-node-badge comment-node-badge-user">User</span>
            <span className="comment-node-time" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {timeAgo(comment.createdAt)}
              {locationChips}
            </span>
            {isResolved && (
              <span className="comment-canvas-resolved-banner" style={{ marginLeft: '8px' }}>
                <CheckCircle2 size={13} />
                Resolved
              </span>
            )}
            {!isEditing && (
              <div className="comment-node-actions">
                {!isResolved && (
                  <button
                    type="button"
                    className="comment-node-btn"
                    onClick={() => setIsEditing(true)}
                    title="Edit comment"
                    aria-label="Edit comment"
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                )}
                {deleteConfirming ? (
                  deleteConfirmControls
                ) : (
                  <button
                    type="button"
                    className="comment-node-btn comment-node-btn-delete"
                    onClick={() => setDeleteConfirming(true)}
                    title="Delete comment"
                    aria-label="Delete comment"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>

          {hasContextPreview && !isEditing && (
            <div className="comment-context-block">
              <button
                type="button"
                className="comment-context-toggle"
                onClick={() => setContextOpen((v) => !v)}
                aria-expanded={contextOpen}
                title={contextOpen ? 'Hide source preview' : 'Show source preview'}
              >
                {contextOpen ? (
                  <ChevronDown size={13} aria-hidden="true" />
                ) : (
                  <ChevronRight size={13} aria-hidden="true" />
                )}
                <span className="comment-context-toggle-label">
                  {contextOpen ? 'Hide' : 'Show'} source
                </span>
                <span className="comment-context-toggle-meta">
                  {contextLineCount} line{contextLineCount === 1 ? '' : 's'}
                  {isRange
                    ? ` · L${comment.startLineNumber}–${comment.lineNumber}`
                    : comment.lineNumber > 0
                      ? ` · L${comment.lineNumber}`
                      : ''}
                </span>
              </button>
              {contextOpen && (
                <div className="plan-comment-context" title="Anchored plan context for the agent">
                  {comment.selectedQuote && (
                    <blockquote className="plan-comment-quote">
                      “{comment.selectedQuote}”
                    </blockquote>
                  )}
                  {contextSource ? (
                    <pre className="plan-comment-source">{contextSource}</pre>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {isEditing ? (
            <div style={{ marginTop: '8px' }}>
              <CommentForm
                draftKey={`plan-edit:${comment.id}`}
                initialBody={comment.body}
                lineContent={
                  comment.selectedQuote
                    ? `Selected: “${comment.selectedQuote}”\nSource:\n${comment.lineContent}`
                    : comment.lineContent
                }
                onSubmit={(newBody) => {
                  onEdit(newBody)
                  setIsEditing(false)
                }}
                onCancel={() => setIsEditing(false)}
              />
            </div>
          ) : (
            <Markdown
              content={comment.body}
              className={`comment-node-body markdown-body ${isResolved ? 'comment-resolved-line' : ''}`}
            />
          )}
        </div>
      </div>

      {comment.replies?.length > 0 && (
        <div className="comment-replies" role="list" aria-label="Replies">
          {comment.replies.map((reply, idx) => {
            const isAgent = reply.role === 'agent'
            const isEditingThis = editingReplyId === reply.id
            return (
              <div
                key={reply.id}
                className={`comment-node ${isAgent ? 'comment-node-agent' : 'comment-node-user'} ${isResolved ? 'comment-node-resolved' : ''}`}
                role="listitem"
                aria-label={`${isAgent ? 'Agent' : 'User'} reply ${idx + 1}`}
              >
                <div className="comment-avatar-col">
                  <AvatarIcon role={isAgent ? 'agent' : 'user'} size={14} />
                </div>
                <div className="comment-content-col">
                  <div className="comment-node-header">
                    <span className="comment-node-author">{isAgent ? 'Agent' : 'User'}</span>
                    <span className={`comment-node-badge ${isAgent ? 'comment-node-badge-agent' : 'comment-node-badge-user'}`}>
                      {isAgent ? 'Agent' : 'User'}
                    </span>
                    {isAgent && reply.model && (
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 5px', borderRadius: '4px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {reply.model}
                      </span>
                    )}
                    <span className="comment-node-time">{timeAgo(reply.createdAt)}</span>
                    <div className="comment-node-actions">
                      {!isResolved && (
                        <button
                          type="button"
                          className="comment-node-btn"
                          onClick={() => setEditingReplyId(reply.id)}
                          title="Edit reply"
                          aria-label="Edit reply"
                        >
                          <Pencil size={12} aria-hidden="true" />
                        </button>
                      )}
                      {deleteReplyId === reply.id ? (
                        <div className="comment-delete-confirm" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            className="comment-node-btn comment-node-btn-delete"
                            onClick={() => {
                              setDeleteReplyId(null)
                              onDeleteReply(reply.id)
                            }}
                            title="Confirm delete reply"
                            aria-label="Confirm delete reply"
                            style={{
                              color: 'var(--danger)',
                              background: 'var(--feedback-danger-bg)',
                              fontWeight: 600,
                              fontSize: '11px',
                              border: '1px solid var(--feedback-danger-border)',
                              padding: '2px 6px',
                              width: 'auto',
                              height: 'auto',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px',
                            }}
                          >
                            <AlertTriangle size={11} />
                            Delete?
                          </button>
                          <button
                            type="button"
                            className="comment-node-btn"
                            onClick={() => setDeleteReplyId(null)}
                            title="Cancel delete"
                            aria-label="Cancel delete reply"
                            style={{ fontSize: '11px', padding: '2px 6px', width: 'auto', height: 'auto' }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="comment-node-btn comment-node-btn-delete"
                          onClick={() => setDeleteReplyId(reply.id)}
                          title="Delete reply"
                          aria-label="Delete reply"
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                  {isEditingThis ? (
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', marginTop: '6px' }}>
                      <CommentForm
                        draftKey={`plan-reply-edit:${comment.id}:${reply.id}`}
                        initialBody={reply.body}
                        onSubmit={(body) => {
                          onEditReply(reply.id, body)
                          setEditingReplyId(null)
                        }}
                        onCancel={() => setEditingReplyId(null)}
                      />
                    </div>
                  ) : (
                    <Markdown content={reply.body} className="comment-node-body markdown-body" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="comment-canvas-footer">
        {!isReplying && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => setIsReplying(true)} className="comment-reply-trigger" style={{ width: '100%', maxWidth: '320px' }}>
              <Reply size={14} aria-hidden="true" />
              Reply...
            </button>
            {isResolved ? (
              <div style={{ display: 'flex', gap: '6px', marginLeft: '12px' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setCollapsed(true)} style={{ fontSize: '12px', padding: '4px 10px' }}>
                  Hide
                </button>
                <button className="btn btn-secondary btn-sm" onClick={onUnresolve} style={{ fontSize: '12px', padding: '4px 10px' }}>
                  Unresolve
                </button>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={onResolve} style={{ fontSize: '12px', padding: '4px 10px', marginLeft: '12px' }}>
                Resolve
              </button>
            )}
          </div>
        )}
        {isReplying && (
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', marginTop: '4px' }}>
            <CommentForm
              draftKey={`plan-reply:${comment.id}`}
              onSubmit={(body) => {
                onReply(body)
                setIsReplying(false)
              }}
              onCancel={() => setIsReplying(false)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
