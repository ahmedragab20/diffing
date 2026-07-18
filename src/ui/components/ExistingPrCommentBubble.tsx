import { useState } from 'react'
import { MessageCircle, AlertTriangle, CheckCircle2, CornerUpLeft } from 'lucide-react'
import type { PrExistingComment } from '../../lib/pr-session'

interface ExistingPrCommentBubbleProps {
  comment: PrExistingComment
  onReply?: (commentId: number, body: string) => Promise<void> | void
}

/**
 * Bubble for an existing PR review comment. Read-only body/metadata; optional
 * reply posts to GitHub via the parent handler.
 */
export function ExistingPrCommentBubble({ comment, onReply }: ExistingPrCommentBubbleProps) {
  const [expanded, setExpanded] = useState(false)
  const [replying, setReplying] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stateBadge = comment.state
    ? {
        APPROVED: { icon: CheckCircle2, label: 'Approved', cls: 'badge-approved' },
        CHANGES_REQUESTED: { icon: AlertTriangle, label: 'Changes requested', cls: 'badge-changes' },
        COMMENTED: { icon: MessageCircle, label: 'Commented', cls: 'badge-commented' },
        PENDING: { icon: MessageCircle, label: 'Pending', cls: 'badge-pending' },
        DISMISSED: { icon: AlertTriangle, label: 'Dismissed', cls: 'badge-dismissed' },
      }[comment.state]
    : null

  const handleSendReply = async () => {
    const trimmed = replyBody.trim()
    if (!trimmed || !onReply) return
    setSending(true)
    setError(null)
    try {
      await onReply(comment.id, trimmed)
      setReplyBody('')
      setReplying(false)
      setExpanded(true)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to reply')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="pr-existing-bubble">
      <div className="pr-existing-bubble-head">
        {comment.author ? (
          <img
            className="pr-existing-avatar"
            src={comment.author.avatarUrl}
            alt={comment.author.login}
          />
        ) : (
          <div className="pr-existing-avatar pr-existing-avatar-fallback" />
        )}
        <div className="pr-existing-bubble-meta">
          <span className="pr-existing-bubble-author">
            @{comment.author?.login ?? 'unknown'}
          </span>
          <span className="pr-existing-bubble-date">
            {new Date(comment.createdAt).toLocaleString()}
          </span>
        </div>
        <span className="pr-existing-bubble-source">from GitHub</span>
        {stateBadge && (
          <span className={`pr-existing-bubble-badge ${stateBadge.cls}`}>
            <stateBadge.icon size={11} /> {stateBadge.label}
          </span>
        )}
        {comment.isOutdated && (
          <span className="pr-existing-bubble-badge badge-outdated">
            <AlertTriangle size={11} /> outdated
          </span>
        )}
      </div>
      <p className="pr-existing-bubble-body">{comment.body}</p>
      {comment.replies.length > 0 && (
        <button
          type="button"
          className="pr-existing-bubble-toggle"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Hide' : 'Show'} {comment.replies.length} repl
          {comment.replies.length === 1 ? 'y' : 'ies'}
        </button>
      )}
      {expanded && comment.replies.length > 0 && (
        <ul className="pr-existing-replies">
          {comment.replies.map((r) => (
            <li key={r.id} className="pr-existing-reply">
              <div className="pr-existing-bubble-meta">
                <span className="pr-existing-bubble-author">
                  @{r.author?.login ?? 'unknown'}
                </span>
                <span className="pr-existing-bubble-date">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              <p>{r.body}</p>
            </li>
          ))}
        </ul>
      )}
      {onReply && (
        <div className="pr-existing-reply-actions">
          {!replying ? (
            <button
              type="button"
              className="btn btn-sm pr-existing-reply-btn"
              onClick={() => setReplying(true)}
            >
              <CornerUpLeft size={12} />
              Reply on GitHub
            </button>
          ) : (
            <div className="pr-existing-reply-form">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={3}
                placeholder="Reply to this thread on GitHub…"
                aria-label="Reply body"
              />
              {error && <p className="pr-existing-reply-error">{error}</p>}
              <div className="pr-existing-reply-form-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setReplying(false)
                    setReplyBody('')
                    setError(null)
                  }}
                  disabled={sending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={handleSendReply}
                  disabled={sending || !replyBody.trim()}
                >
                  {sending ? 'Sending…' : 'Post reply'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
