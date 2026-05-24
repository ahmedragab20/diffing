import { useState, useEffect } from 'react'
import { UserCircle, CheckCircle2, Bot, Reply } from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo, parseMarkdown } from '../utils'
import { useComments } from '../hooks/useComments'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
}

export function CommentBubble({ comment, onDelete }: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const { resolveComment, unresolveComment, addReply } = useComments()
  const isResolved = comment.status === 'resolved'
  const [collapsed, setCollapsed] = useState(isResolved)
  const [replyBody, setReplyBody] = useState('')
  const [isReplying, setIsReplying] = useState(false)

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

  return (
    <div className={`comment-bubble ${isResolved ? 'comment-resolved' : ''}`} id={`comment-${comment.id}`}>
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>
        {isResolved && (
          <span className="comment-bubble-resolved">
            <CheckCircle2 size={14} />
            Resolved
          </span>
        )}
        {!isResolved && (
          <button
            className="comment-bubble-delete"
            onClick={() => onDelete(comment.id)}
            title="Delete comment"
          >
            &times;
          </button>
        )}
      </div>
      <div className="comment-bubble-body markdown-body" style={{ textDecoration: 'none' }} dangerouslySetInnerHTML={{ __html: parseMarkdown(comment.body) }} />
      {comment.replies?.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="comment-reply">
              <div className="comment-reply-header">
                <Bot size={16} className="comment-reply-avatar" />
                <span className="comment-bubble-time">{timeAgo(reply.createdAt)}</span>
              </div>
              <div className="comment-reply-body markdown-body" dangerouslySetInnerHTML={{ __html: parseMarkdown(reply.body) }} />
            </div>
          ))}
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

