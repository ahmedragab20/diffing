import { useState, useEffect } from 'react'
import { UserCircle, CheckCircle2, Bot, Reply, Pencil } from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo, parseMarkdown } from '../utils'
import { useComments } from '../hooks/useComments'
import { CommentForm } from './CommentForm'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
}

export function CommentBubble({ comment, onDelete }: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const { resolveComment, unresolveComment, addReply, applySuggestion, editComment } = useComments()
  const isResolved = comment.status === 'resolved'
  const [collapsed, setCollapsed] = useState(isResolved)
  const [replyBody, setReplyBody] = useState('')
  const [isReplying, setIsReplying] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const remainingBody = comment.body.replace(/```suggestion\n([\s\S]*?)```/g, '').trim()
  const hasBodyContent = remainingBody.length > 0

  // Keep collapsed state in sync if status is updated externally
  useEffect(() => {
    setCollapsed(comment.status === 'resolved')
  }, [comment.status])

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const handleResolve = () => {
    resolveComment(comment.id)
  }

  const handleUnresolve = () => {
    unresolveComment(comment.id)
  }

  const handleAddReply = () => {
    const trimmed = replyBody.trim()
    if (trimmed) {
      addReply(comment.id, trimmed)
      setReplyBody('')
      setIsReplying(false)
    }
  }

  if (isResolved && collapsed) {
    return (
      <div 
        className="comment-bubble comment-resolved-collapsed" 
        style={{
          padding: '10px 16px',
          margin: '12px 20px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          opacity: 0.8
        }}
        onClick={() => setCollapsed(false)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
          <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />
          <span style={{ fontWeight: 600 }}>Conversation resolved</span>
          {comment.startLineNumber && comment.startLineNumber !== comment.lineNumber && (
            <span 
              style={{
                padding: '1px 5px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
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
        >
          Show resolved
        </button>
      </div>
    )
  }

  if (isEditing) {
    return (
      <div className={`comment-bubble ${isResolved ? 'comment-resolved' : ''}`} id={`comment-${comment.id}`}>
        <div className="comment-bubble-header">
          <UserCircle size={18} className="comment-bubble-avatar" />
          <span className="comment-bubble-time" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {timeAgo(comment.createdAt)}
            {comment.startLineNumber && comment.startLineNumber !== comment.lineNumber && (
              <span 
                className="comment-bubble-range" 
                style={{
                  padding: '1px 5px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                  userSelect: 'none'
                }}
              >
                L{comment.startLineNumber}-{comment.lineNumber}
              </span>
            )}
          </span>
        </div>
        <div style={{ marginTop: '8px' }}>
          <CommentForm
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
    )
  }

  return (
    <div className={`comment-bubble ${isResolved ? 'comment-resolved' : ''}`} id={`comment-${comment.id}`}>
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        <span className="comment-bubble-time" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {timeAgo(comment.createdAt)}
          {comment.startLineNumber && comment.startLineNumber !== comment.lineNumber && (
            <span 
              className="comment-bubble-range" 
              style={{
                padding: '1px 5px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-secondary)',
                userSelect: 'none'
              }}
            >
              L{comment.startLineNumber}-{comment.lineNumber}
            </span>
          )}
        </span>
        {isResolved && (
          <span className="comment-bubble-resolved">
            <CheckCircle2 size={14} />
            Resolved
          </span>
        )}
        {!isResolved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              className="comment-bubble-edit"
              onClick={() => setIsEditing(true)}
              title="Edit comment"
            >
              <Pencil size={14} />
            </button>
            <button
              className="comment-bubble-delete"
              onClick={() => onDelete(comment.id)}
              title="Delete comment"
            >
              &times;
            </button>
          </div>
        )}
      </div>
      {hasBodyContent && (
        <div className="comment-bubble-body markdown-body" style={{ textDecoration: 'none' }} dangerouslySetInnerHTML={{ __html: parseMarkdown(comment.body) }} />
      )}
      
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
              marginBottom: '12px',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              overflow: 'hidden',
              background: 'var(--bg-primary)'
            }}
          >
            <div 
              className="suggestion-header" 
              style={{
                padding: '8px 12px',
                background: 'var(--bg-tertiary)',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>Suggested Change</span>
              {isResolved ? (
                <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
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
                    borderRadius: '4px',
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
                  background: 'rgba(191, 97, 106, 0.08)', 
                  borderBottom: '1px dashed var(--border-color)',
                  color: 'var(--danger)',
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
                  background: 'rgba(163, 190, 140, 0.08)',
                  color: 'var(--success)',
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

      {comment.replies?.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map((reply) => {
            const isAgent = reply.role === 'agent'
            return (
              <div key={reply.id} className={`comment-reply ${isAgent ? 'comment-reply-agent' : 'comment-reply-user'}`}>
                <div className="comment-reply-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isAgent ? (
                    <>
                      <Bot size={16} className="comment-reply-avatar" style={{ color: 'var(--primary)' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: 'rgba(129, 161, 193, 0.15)', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Agent</span>
                        {reply.model && (
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 5px', borderRadius: '4px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                            {reply.model}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <UserCircle size={16} className="comment-reply-avatar" style={{ color: 'var(--text-muted)' }} />
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>User</span>
                    </>
                  )}
                  <span className="comment-bubble-time">{timeAgo(reply.createdAt)}</span>
                </div>
                <div className="comment-reply-body markdown-body" dangerouslySetInnerHTML={{ __html: parseMarkdown(reply.body) }} />
              </div>
            )
          })}
        </div>
      )}

      <div 
        className="comment-bubble-footer" 
        style={{ 
          marginTop: '12px', 
          paddingTop: '12px', 
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        {!isReplying && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={() => setIsReplying(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '6px',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <Reply size={14} />
              Reply...
            </button>

            {isResolved ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleUnresolve}
                style={{ fontSize: '12px', padding: '4px 10px' }}
              >
                Unresolve conversation
              </button>
            ) : (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleResolve}
                style={{ fontSize: '12px', padding: '4px 10px' }}
              >
                Resolve conversation
              </button>
            )}
          </div>
        )}

        {isReplying && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Write a reply..."
              rows={2}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                fontFamily: 'var(--font-sans)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                outline: 'none',
                resize: 'vertical'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={() => {
                  setIsReplying(false)
                  setReplyBody('')
                }}
                style={{ fontSize: '12px', padding: '4px 10px' }}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary btn-sm" 
                onClick={handleAddReply}
                disabled={!replyBody.trim()}
                style={{ fontSize: '12px', padding: '4px 10px' }}
              >
                Reply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

