import { useState } from 'react'
import { MessageCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { PrExistingComment } from '../../lib/pr-session'

interface ExistingPrCommentBubbleProps {
  comment: PrExistingComment
}

/**
 * Read-only bubble for an existing PR review comment. Shown inline in the
 * diff so the reviewer sees context (what was already said, by whom, with
 * what state). Never editable, never deletable — the user can only ADD
 * their own new comments.
 */
export function ExistingPrCommentBubble({ comment }: ExistingPrCommentBubbleProps) {
  const [expanded, setExpanded] = useState(false)
  const stateBadge = comment.state
    ? {
        APPROVED: { icon: CheckCircle2, label: 'Approved', cls: 'badge-approved' },
        CHANGES_REQUESTED: { icon: AlertTriangle, label: 'Changes requested', cls: 'badge-changes' },
        COMMENTED: { icon: MessageCircle, label: 'Commented', cls: 'badge-commented' },
        PENDING: { icon: MessageCircle, label: 'Pending', cls: 'badge-pending' },
        DISMISSED: { icon: AlertTriangle, label: 'Dismissed', cls: 'badge-dismissed' },
      }[comment.state]
    : null

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
          className="pr-existing-bubble-toggle"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Hide' : 'Show'} {comment.replies.length} repl{comment.replies.length === 1 ? 'y' : 'ies'}
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
    </div>
  )
}
