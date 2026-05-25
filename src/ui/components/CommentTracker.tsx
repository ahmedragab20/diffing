import { useState } from 'react'
import {
  MessageSquare,
  CheckCircle2,
  Reply,
  Bot,
  Trash2,
  AlertTriangle,
  XCircle,
} from 'lucide-react'
import type { ReviewComment } from '../../lib/types'
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

function getAvatarInfo(id: string, role?: 'user' | 'agent', model?: string) {
  if (role === 'agent') {
    const initial = model ? model.charAt(0).toUpperCase() : 'A'
    return {
      bg: 'var(--primary)', // Solid primary theme color for Agent
      initial
    }
  }

  // Deterministic vibrant solid colors for users
  const colors = [
    '#ff5858', // Coral red
    '#11998e', // Teal green
    '#ff9966', // Sunset orange
    '#7f00ff', // Purple magic
    '#00c6ff', // Sky blue
    '#f12711', // Fire red
    '#0575e6', // Royal blue
  ]
  const charSum = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const bg = colors[Math.abs(charSum) % colors.length]
  return {
    bg,
    initial: 'U'
  }
}

export function CommentTracker({ comments, resolveComment, unresolveComment, removeComment, removeReply }: CommentTrackerProps) {
  if (comments.length === 0) return null

  const sorted = [...comments].sort((a, b) => b.createdAt - a.createdAt)

  const openCount = sorted.filter((c) => getCommentStatus(c) === 'open').length
  const repliedCount = sorted.filter((c) => getCommentStatus(c) === 'replied').length
  const resolvedCount = sorted.filter((c) => getCommentStatus(c) === 'resolved').length

  return (
    <div className="ct" role="complementary" aria-label="Comments tracker" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="ct-header" style={{ flexShrink: 0 }}>
        <MessageSquare size={14} aria-hidden="true" />
        <span className="ct-title">Comments</span>
        <span className="ct-counts">
          {openCount > 0 && <span className="ct-count ct-count-open">{openCount} open</span>}
          {repliedCount > 0 && <span className="ct-count ct-count-replied">{repliedCount} replied</span>}
          {resolvedCount > 0 && <span className="ct-count ct-count-resolved">{resolvedCount} resolved</span>}
        </span>
      </div>
      <ul className="ct-list" role="list" aria-label="Comment threads" style={{ flex: 1, overflowY: 'auto', paddingBottom: '16px' }}>
        {sorted.map((comment) => {
          const status = getCommentStatus(comment)
          const summary = replySummary(comment.replies)
          const isResolved = comment.status === 'resolved'
          const userAvatar = getAvatarInfo(comment.id, 'user')
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
                aria-label={comment.lineNumber === 0 
                  ? `${status} file comment on ${fileName(comment.filePath)}`
                  : `${status} comment on ${fileName(comment.filePath)} line ${comment.lineNumber}`
                }
              >
                <div className="ct-item-header">
                  <div className="ct-item-avatar" style={{ background: userAvatar.bg }}>
                    {userAvatar.initial}
                  </div>
                  <span className="ct-item-file" title={comment.filePath}>
                    {fileName(comment.filePath)}:{comment.lineNumber === 0 ? 'file' : comment.lineNumber}
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
                  <span className="ct-item-replies-label" style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
                  </span>
                  {comment.replies.slice(0, 3).map((r) => {
                    const replyAvatar = getAvatarInfo(r.id, r.role, r.model)
                    return (
                      <span
                        key={r.id}
                        className={`ct-reply-mini-badge ${r.role === 'agent' ? 'ct-reply-mini-agent' : 'ct-reply-mini-user'}`}
                        title={r.role === 'agent' ? (r.model ? `Agent (${r.model})` : 'Agent') : 'User'}
                      >
                        {r.role === 'agent' ? (
                          <><Bot size={10} aria-hidden="true" /> Agent</>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <span style={{ 
                              display: 'inline-block', 
                              width: '8px', 
                              height: '8px', 
                              borderRadius: '50%', 
                              background: replyAvatar.bg 
                            }} /> 
                            User
                          </span>
                        )}
                        <button
                          className="ct-reply-delete-btn"
                          onClick={(e) => { e.stopPropagation(); confirmDeleteReply(() => removeReply(comment.id, r.id)) }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); confirmDeleteReply(() => removeReply(comment.id, r.id)) } }}
                          title="Delete reply"
                          aria-label={`Delete reply from ${r.role}`}
                          tabIndex={0}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            marginLeft: '4px',
                            color: 'var(--text-muted)'
                          }}
                        >
                          <XCircle size={10} aria-hidden="true" />
                        </button>
                      </span>
                    )
                  })}
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
