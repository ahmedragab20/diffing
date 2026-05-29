import { useState, useEffect, useRef } from 'react'
import { CheckCircle2, Bot, Reply, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import type { ReviewComment } from '../../lib/types'
import { timeAgo, parseMarkdown } from '../utils'
import { useComments } from '../hooks/useComments'
import { CommentForm } from './CommentForm'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
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

export function CommentBubble({ comment, onDelete }: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const { resolveComment, unresolveComment, addReply, removeReply, editReply, applySuggestion, editComment } = useComments()
  const isResolved = comment.status === 'resolved'
  const [collapsed, setCollapsed] = useState(isResolved)
  const [isReplying, setIsReplying] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null)

  const firstActionBtnRef = useRef<HTMLButtonElement>(null)

  const remainingBody = comment.body.replace(/```suggestion\n([\s\S]*?)```/g, '').trim()
  const hasBodyContent = remainingBody.length > 0

  useEffect(() => {
    setCollapsed(comment.status === 'resolved')
  }, [comment.status])

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const handleResolve = () => resolveComment(comment.id)
  const handleUnresolve = () => unresolveComment(comment.id)

  const handleStartEditReply = (replyId: string) => {
    setEditingReplyId(replyId)
  }

  const handleDeleteReply = (replyId: string) => {
    removeReply(comment.id, replyId)
  }

  if (isResolved && collapsed) {
    return (
      <div
        className="comment-resolved-collapsed"
        style={{
          padding: '12px 18px',
          margin: '14px 20px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: 0.85,
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
          <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />
          <span style={{ fontWeight: 600 }}>Conversation resolved</span>
          {comment.lineNumber === 0 && (
            <span
              style={{
                padding: '2px 6px',
                background: 'var(--accent-subtle)',
                border: '1px solid var(--primary)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '10px',
                fontWeight: 700,
                color: 'var(--primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}
            >
              File Comment
            </span>
          )}
          {comment.startLineNumber && comment.startLineNumber !== comment.lineNumber && (
            <span
              style={{
                padding: '2px 6px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '10px',
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-secondary)'
              }}
            >
              L{comment.startLineNumber}-{comment.lineNumber}
            </span>
          )}
          <span>•</span>
          <span>{comment.replies?.length > 0 ? `${comment.replies.length + 1} comments` : '1 comment'}</span>
        </div>
        <button
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--primary)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
          onClick={() => setCollapsed(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(false) } }}
          aria-label="Show resolved conversation"
        >
          Show resolved
        </button>
      </div>
    )
  }

  const parentAvatar = getAvatarInfo(comment.id, 'user')

  if (isEditing) {
    return (
      <div className="comment-bubble-canvas" id={`comment-${comment.id}`} role="article" aria-label="Edit comment">
        <div className="comment-node">
          <div className="comment-avatar-col">
            <div className="comment-avatar-circle" style={{ background: parentAvatar.bg }}>
              {parentAvatar.initial}
            </div>
          </div>
          <div className="comment-content-col">
            <div className="comment-node-header">
              <span className="comment-node-author">User</span>
              <span className="comment-node-badge comment-node-badge-user">User</span>
              <span className="comment-node-time" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {timeAgo(comment.createdAt)}
                {comment.lineNumber === 0 && (
                  <span
                    style={{
                      padding: '1px 5px',
                      background: 'var(--accent-subtle)',
                      border: '1px solid var(--primary)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '10px',
                      fontWeight: 700,
                      color: 'var(--primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}
                  >
                    File Comment
                  </span>
                )}
                {comment.startLineNumber && comment.startLineNumber !== comment.lineNumber && (
                  <span
                    style={{
                      padding: '1px 5px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '10px',
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    L{comment.startLineNumber}-{comment.lineNumber}
                  </span>
                )}
              </span>
            </div>
            <div style={{ marginTop: '8px' }}>
              <CommentForm
                draftKey={`edit:${comment.id}`}
                initialBody={comment.body}
                lineContent={comment.lineContent}
                onSubmit={(newBody) => {
                  editComment(comment.id, newBody)
                  setIsEditing(false)
                }}
                onCancel={() => setIsEditing(false)}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`comment-bubble-canvas ${isResolved ? 'comment-bubble-canvas-resolved' : ''}`}
      id={`comment-${comment.id}`}
      role="article"
      aria-label={comment.lineNumber === 0 ? "File-level comment" : `Comment by user on line ${comment.lineNumber}`}
    >
      {/* Parent Comment Node */}
      <div className={`comment-node ${isResolved ? 'comment-node-resolved' : ''}`}>
        <div className="comment-avatar-col">
          <div className="comment-avatar-circle" style={{ background: parentAvatar.bg }}>
            {parentAvatar.initial}
          </div>
        </div>
        <div className="comment-content-col">
          <div className="comment-node-header">
            <span className="comment-node-author">User</span>
            <span className="comment-node-badge comment-node-badge-user">User</span>
            <span className="comment-node-time" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {timeAgo(comment.createdAt)}
              {comment.lineNumber === 0 && (
                <span
                  style={{
                    padding: '1px 5px',
                    background: 'var(--accent-subtle)',
                    border: '1px solid var(--primary)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '10px',
                    fontWeight: 700,
                    color: 'var(--primary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}
                >
                  File Comment
                </span>
              )}
              {comment.startLineNumber && comment.startLineNumber !== comment.lineNumber && (
                <span
                  style={{
                    padding: '1px 5px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '10px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-secondary)'
                  }}
                >
                  L{comment.startLineNumber}-{comment.lineNumber}
                </span>
              )}
            </span>

            {isResolved && (
              <span className="comment-canvas-resolved-banner" style={{ marginLeft: '8px' }}>
                <CheckCircle2 size={13} />
                Resolved
              </span>
            )}

            {!isResolved && (
              <div className="comment-node-actions">
                <button
                  ref={firstActionBtnRef}
                  className="comment-node-btn"
                  onClick={() => setIsEditing(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsEditing(true) } }}
                  title="Edit comment"
                  aria-label="Edit comment"
                  tabIndex={0}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
                {deleteConfirming ? (
                  <div className="comment-delete-confirm" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      className="comment-node-btn comment-node-btn-delete"
                      onClick={() => onDelete(comment.id)}
                      title="Confirm delete"
                      aria-label="Confirm delete comment"
                      style={{
                        color: 'var(--danger)',
                        background: 'var(--feedback-danger-bg)',
                        fontWeight: 600,
                        fontSize: '11px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--feedback-danger-border)',
                        padding: '2px 6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        width: 'auto',
                        height: 'auto'
                      }}
                    >
                      <AlertTriangle size={11} />
                      Delete?
                    </button>
                    <button
                      className="comment-node-btn"
                      onClick={() => setDeleteConfirming(false)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDeleteConfirming(false) } }}
                      title="Cancel delete"
                      aria-label="Cancel delete"
                      style={{ fontSize: '11px', padding: '2px 6px', width: 'auto', height: 'auto' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="comment-node-btn comment-node-btn-delete"
                    onClick={() => setDeleteConfirming(true)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDeleteConfirming(true) } }}
                    title="Delete comment"
                    aria-label="Delete comment"
                    tabIndex={0}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
          {hasBodyContent && (
            <div className={`comment-node-body markdown-body ${isResolved ? 'comment-resolved-line' : ''}`} dangerouslySetInnerHTML={{ __html: parseMarkdown(comment.body) }} />
          )}

          {/* Suggestion Card */}
          {(() => {
            const suggestionMatch = comment.body.match(/```suggestion\n([\s\S]*?)```/)
            const hasSuggestion = !!suggestionMatch && comment.side === 'additions'
            const suggestionCode = suggestionMatch ? suggestionMatch[1].trimEnd() : ''
            if (!hasSuggestion) return null

            return (
              <div
                className="suggestion-card"
                style={{
                  marginTop: '12px',
                  marginBottom: '4px',
                  border: '1px solid var(--border-normal)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: 'var(--bg-primary)',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                <div
                  className="suggestion-header"
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-normal)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    fontWeight: 600
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>Suggested Change</span>
                  {isResolved ? (
                    <span style={{ color: 'var(--feedback-success-text)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <CheckCircle2 size={12} /> Applied
                    </span>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        try {
                          await applySuggestion(comment.id)
                        } catch (err: any) {
                          alert(err.message)
                        }
                      }}
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                        height: '24px'
                      }}
                    >
                      Apply Suggestion
                    </button>
                  )}
                </div>
                <div className="suggestion-diff" style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
                  <div
                    style={{
                      display: 'flex',
                      padding: '8px 12px',
                      background: 'var(--feedback-danger-bg)',
                      borderBottom: '1px dashed var(--border-color)',
                      color: 'var(--feedback-danger-text)',
                      minWidth: 'max-content'
                    }}
                  >
                    <span style={{ width: '20px', userSelect: 'none', opacity: 0.5 }}>-</span>
                    <span style={{ whiteSpace: 'pre' }}>{comment.lineContent}</span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      padding: '8px 12px',
                      background: 'var(--feedback-success-bg)',
                      color: 'var(--feedback-success-text)',
                      minWidth: 'max-content'
                    }}
                  >
                    <span style={{ width: '20px', userSelect: 'none', opacity: 0.5 }}>+</span>
                    <span style={{ whiteSpace: 'pre' }}>{suggestionCode}</span>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Replies List */}
      {comment.replies?.length > 0 && (
        <div className="comment-replies" role="list" aria-label="Replies">
          {comment.replies.map((reply, idx) => {
            const isAgent = reply.role === 'agent'
            const isEditingThis = editingReplyId === reply.id
            const replyAvatar = getAvatarInfo(reply.id, reply.role, reply.model)
            return (
              <div
                key={reply.id}
                className={`comment-node ${isAgent ? 'comment-node-agent' : 'comment-node-user'} ${isResolved ? 'comment-node-resolved' : ''}`}
                role="listitem"
                aria-label={`${isAgent ? 'Agent' : 'User'} reply ${idx + 1}`}
              >
                <div className="comment-avatar-col">
                  {isAgent ? (
                    <div className="comment-avatar-circle" style={{ background: replyAvatar.bg, width: '28px', height: '28px', fontSize: '11px' }}>
                      {replyAvatar.initial}
                    </div>
                  ) : (
                    <div style={{ width: '28px' }} />
                  )}
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

                    {!isResolved && (
                      <div className="comment-node-actions">
                        <button
                          className="comment-node-btn"
                          onClick={() => handleStartEditReply(reply.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleStartEditReply(reply.id) } }}
                          title="Edit reply"
                          aria-label="Edit reply"
                          tabIndex={0}
                        >
                          <Pencil size={12} aria-hidden="true" />
                        </button>
                        <button
                          className="comment-node-btn comment-node-btn-delete"
                          onClick={() => handleDeleteReply(reply.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDeleteReply(reply.id) } }}
                          title="Delete reply"
                          aria-label="Delete reply"
                          tabIndex={0}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditingThis ? (
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', marginTop: '6px' }}>
                      <CommentForm
                        draftKey={`reply-edit:${comment.id}:${reply.id}`}
                        initialBody={reply.body}
                        onSubmit={(body) => {
                          editReply(comment.id, reply.id, body)
                          setEditingReplyId(null)
                        }}
                        onCancel={() => setEditingReplyId(null)}
                      />
                    </div>
                  ) : (
                    <div className="comment-node-body markdown-body" dangerouslySetInnerHTML={{ __html: parseMarkdown(reply.body) }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer (Reply trigger and Resolve toggle) */}
      <div className="comment-canvas-footer">
        {!isReplying && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={() => setIsReplying(true)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsReplying(true) } }}
              className="comment-reply-trigger"
              aria-label="Write a reply"
              tabIndex={0}
              style={{ width: '100%', maxWidth: '320px' }}
            >
              <Reply size={14} aria-hidden="true" />
              Reply...
            </button>

            {isResolved ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleUnresolve}
                style={{ fontSize: '12px', padding: '4px 10px', marginLeft: '12px' }}
                aria-label="Unresolve conversation"
              >
                Unresolve conversation
              </button>
            ) : (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleResolve}
                style={{ fontSize: '12px', padding: '4px 10px', marginLeft: '12px' }}
                aria-label="Resolve conversation"
              >
                Resolve conversation
              </button>
            )}
          </div>
        )}

        {isReplying && (
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', marginTop: '4px' }}>
            <CommentForm
              draftKey={`reply:${comment.id}`}
              onSubmit={(body) => {
                addReply(comment.id, body)
                setIsReplying(false)
              }}
              onCancel={() => {
                setIsReplying(false)
                firstActionBtnRef.current?.focus()
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
