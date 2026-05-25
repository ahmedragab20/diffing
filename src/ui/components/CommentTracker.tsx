import { useState } from 'react'
import {
  MessageSquare,
  CheckCircle2,
  Reply,
  Circle,
  Bot,
  UserCircle,
  Trash2,
  AlertTriangle,
  XCircle,
} from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo, truncate, fileName } from '../utils'

interface CommentTrackerProps {
  comments: ReviewComment[]
  resolveComment: (id: string) => void
  unresolveComment: (id: string) => void
  removeComment: (id: string) => void
  removeReply: (commentId: string, replyId: string) => void
}

type CommentStatus = 'open' | 'replied' | 'resolved'

function getCommentStatus(comment: ReviewComment): CommentStatus {
  if (comment.status === 'resolved') return 'resolved'
  if (comment.replies?.length > 0) return 'replied'
  return 'open'
}

function replySummary(replies: ReviewComment['replies']): string {
  if (!replies || replies.length === 0) return ''
  const agentCount = replies.filter((r) => r.role === 'agent').length
  const userCount = replies.filter((r) => r.role !== 'agent').length
  const parts: string[] = []
  if (userCount > 0) parts.push(`${userCount} user`)
  if (agentCount > 0) parts.push(`${agentCount} agent`)
  return parts.join(', ')
}

function StatusBadge({ status }: { status: CommentStatus }) {
  switch (status) {
    case 'open':
      return (
        <span className="ct-status ct-status-open" title="Open" aria-label="Open">
          <Circle size={12} aria-hidden="true" />
        </span>
      )
    case 'replied':
      return (
        <span className="ct-status ct-status-replied" title="Replied" aria-label="Replied">
          <Reply size={12} aria-hidden="true" />
        </span>
      )
    case 'resolved':
      return (
        <span className="ct-status ct-status-resolved" title="Resolved" aria-label="Resolved">
          <CheckCircle2 size={12} aria-hidden="true" />
        </span>
      )
  }
}

export function CommentTracker({ comments, resolveComment, unresolveComment, removeComment, removeReply }: CommentTrackerProps) {
  if (comments.length === 0) return null

  const sorted = [...comments].sort((a, b) => b.createdAt - a.createdAt)

  const openCount = sorted.filter((c) => getCommentStatus(c) === 'open').length
  const repliedCount = sorted.filter((c) => getCommentStatus(c) === 'replied').length
  const resolvedCount = sorted.filter((c) => getCommentStatus(c) === 'resolved').length

  return (
    <div className="ct" role="complementary" aria-label="Comments tracker">
      <div className="ct-header">
        <MessageSquare size={14} aria-hidden="true" />
        <span className="ct-title">Comments</span>
        <span className="ct-counts">
          {openCount > 0 && <span className="ct-count ct-count-open">{openCount} open</span>}
          {repliedCount > 0 && <span className="ct-count ct-count-replied">{repliedCount} replied</span>}
          {resolvedCount > 0 && <span className="ct-count ct-count-resolved">{resolvedCount} resolved</span>}
        </span>
      </div>
      <ul className="ct-list" role="list" aria-label="Comment threads">
        {sorted.map((comment) => {
          const status = getCommentStatus(comment)
          const summary = replySummary(comment.replies)
          const isResolved = comment.status === 'resolved'
          return (
            <li
              key={comment.id}
              className={`ct-item ${isResolved ? 'ct-item-resolved' : ''}`}
              role="listitem"
            >
              <a
                href={`#comment-${comment.id}`}
                className="ct-item-link"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    document.querySelector(`#comment-${comment.id}`)?.scrollIntoView({ behavior: 'smooth' })
                  }
                }}
                aria-label={`${status} comment on ${fileName(comment.filePath)} line ${comment.lineNumber}`}
              >
                <div className="ct-item-header">
                  <StatusBadge status={status} />
                  <span className="ct-item-file" title={comment.filePath}>
                    {fileName(comment.filePath)}:{comment.lineNumber}
                  </span>
                  <span className="ct-item-time">{timeAgo(comment.createdAt)}</span>
                </div>
                <div className="ct-item-body">{truncate(comment.body, 80)}</div>
              </a>
              <div className="ct-item-actions">
                <ResolveButton
                  isResolved={isResolved}
                  onResolve={() => resolveComment(comment.id)}
                  onUnresolve={() => unresolveComment(comment.id)}
                />
                <DeleteButton
                  label="Delete comment"
                  onConfirm={() => removeComment(comment.id)}
                />
              </div>
              {summary && (
                <div className="ct-item-replies">
                  <span className="ct-item-replies-label">
                    {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
                  </span>
                  {comment.replies.slice(0, 3).map((r) => (
                    <span
                      key={r.id}
                      className={`ct-reply-mini-badge ${r.role === 'agent' ? 'ct-reply-mini-agent' : 'ct-reply-mini-user'}`}
                      title={r.role === 'agent' ? (r.model ? `Agent (${r.model})` : 'Agent') : 'User'}
                    >
                      {r.role === 'agent' ? (
                        <><Bot size={10} aria-hidden="true" /> Agent</>
                      ) : (
                        <><UserCircle size={10} aria-hidden="true" /> User</>
                      )}
                      <button
                        className="ct-reply-delete-btn"
                        onClick={(e) => { e.stopPropagation(); confirmDeleteReply(() => removeReply(comment.id, r.id)) }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); confirmDeleteReply(() => removeReply(comment.id, r.id)) } }}
                        title="Delete reply"
                        aria-label={`Delete reply from ${r.role}`}
                        tabIndex={0}
                      >
                        <XCircle size={10} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  {comment.replies.length > 3 && (
                    <span className="ct-item-replies-more">+{comment.replies.length - 3} more</span>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ResolveButton({ isResolved, onResolve, onUnresolve }: { isResolved: boolean; onResolve: () => void; onUnresolve: () => void }) {
  return (
    <button
      className={`ct-action-btn ct-action-resolve ${isResolved ? 'ct-action-resolved' : ''}`}
      onClick={(e) => { e.stopPropagation(); e.preventDefault()
        isResolved ? onUnresolve() : onResolve()
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault()
        isResolved ? onUnresolve() : onResolve()
      } }}
      title={isResolved ? 'Unresolve' : 'Resolve'}
      aria-label={isResolved ? 'Unresolve comment' : 'Resolve comment'}
      tabIndex={0}
    >
      <CheckCircle2 size={12} aria-hidden="true" />
    </button>
  )
}

function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="ct-delete-confirm">
        <button
          className="ct-action-btn ct-action-delete-confirm"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onConfirm() }}
          title="Confirm delete"
          aria-label={`Confirm ${label}`}
        >
          <AlertTriangle size={12} aria-hidden="true" />
          Delete?
        </button>
        <button
          className="ct-action-btn"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirming(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setConfirming(false) } }}
          title="Cancel delete"
          aria-label="Cancel delete"
          tabIndex={0}
          style={{ fontSize: '10px', padding: '1px 4px' }}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      className="ct-action-btn ct-action-delete"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirming(true) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setConfirming(true) } }}
      title={label}
      aria-label={label}
      tabIndex={0}
    >
      <Trash2 size={12} aria-hidden="true" />
    </button>
  )
}

function confirmDeleteReply(onConfirm: () => void) {
  if (window.confirm('Delete this reply?')) {
    onConfirm()
  }
}
