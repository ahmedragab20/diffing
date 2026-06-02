import { useState, useMemo, useCallback } from 'react'
import { useFeedback } from '../hooks/useHaptics'
import { CommentForm } from './CommentForm'
import {
  MessageSquare,
  Check,
  RotateCcw,
  CornerUpLeft,
  Pencil,
  Trash2,
  Bot,
  ChevronRight,
  X,
} from 'lucide-react'
import type { ReviewComment, CommentReply } from '../../lib/types'
import { timeAgo, fileName, scrollToLine } from '../utils'
import { Markdown } from './Markdown'

interface CommentTrackerProps {
  comments: ReviewComment[]
  resolveComment: (id: string) => void
  unresolveComment: (id: string) => void
  removeComment: (id: string) => void
  addReply: (id: string, body: string) => void
  editComment: (id: string, body: string) => void
  editReply: (commentId: string, replyId: string, body: string) => void
  removeReply: (commentId: string, replyId: string) => void
}

type Status = 'open' | 'replied' | 'resolved'
type FilterKey = 'all' | Status

function statusOf(c: ReviewComment): Status {
  if (c.status === 'resolved') return 'resolved'
  if (c.replies?.length) return 'replied'
  return 'open'
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'replied', label: 'Replied' },
  { key: 'resolved', label: 'Resolved' },
]

export function CommentTracker({
  comments,
  resolveComment,
  unresolveComment,
  removeComment,
  addReply,
  editComment,
  editReply,
  removeReply,
}: CommentTrackerProps) {
  const [filter, setFilter] = useState<FilterKey>('all')

  const counts = useMemo(() => {
    const c = { all: comments.length, open: 0, replied: 0, resolved: 0 }
    for (const comment of comments) c[statusOf(comment)]++
    return c
  }, [comments])

  const sorted = useMemo(
    () => [...comments].sort((a, b) => b.createdAt - a.createdAt),
    [comments],
  )

  const visible = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((c) => statusOf(c) === filter)),
    [sorted, filter],
  )

  if (comments.length === 0) return null

  return (
    <div className="cmt" role="complementary" aria-label="Review comments">
      <div className="cmt-head">
        <div className="cmt-title">
          <MessageSquare size={14} aria-hidden="true" />
          <span>Comments</span>
          <span className="cmt-total">{comments.length}</span>
        </div>
        <div className="cmt-filters" role="tablist" aria-label="Filter comments">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={`cmt-filter ${filter === f.key ? 'cmt-filter-active' : ''}`}
              onClick={() => setFilter(f.key)}
              disabled={f.key !== 'all' && counts[f.key] === 0}
            >
              {f.label}
              <span className="cmt-filter-count">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <ul className="cmt-list" aria-label="Comment threads">
        {visible.length === 0 ? (
          <li className="cmt-empty">No {filter} comments</li>
        ) : (
          visible.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              resolveComment={resolveComment}
              unresolveComment={unresolveComment}
              removeComment={removeComment}
              addReply={addReply}
              editComment={editComment}
              editReply={editReply}
              removeReply={removeReply}
            />
          ))
        )}
      </ul>
    </div>
  )
}

interface CardProps extends Omit<CommentTrackerProps, 'comments'> {
  comment: ReviewComment
}

function CommentCard({
  comment,
  resolveComment,
  unresolveComment,
  removeComment,
  addReply,
  editComment,
  editReply,
  removeReply,
}: CardProps) {
  const status = statusOf(comment)
  const resolved = comment.status === 'resolved'
  const replyCount = comment.replies?.length ?? 0
  const { haptic, sound } = useFeedback()

  const [expanded, setExpanded] = useState(false)
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const jump = useCallback(() => {
    if (comment.lineNumber > 0) {
      scrollToLine(comment.filePath, comment.lineNumber, comment.side)
    } else {
      document.getElementById(`file-${comment.filePath}`)?.scrollIntoView({ block: 'start' })
    }
  }, [comment.filePath, comment.lineNumber, comment.side])

  const lineLabel = comment.lineNumber > 0 ? `:${comment.lineNumber}` : ' · file'

  return (
    <li className={`cmt-card cmt-card-${status} ${resolved ? 'cmt-card-resolved' : ''}`}>
      <div className="cmt-card-top">
        <span className={`cmt-dot cmt-dot-${status}`} aria-hidden="true" />
        <button className="cmt-loc" onClick={jump} title={`Jump to ${comment.filePath}${lineLabel}`}>
          <span className="cmt-loc-file">{fileName(comment.filePath)}</span>
          <span className="cmt-loc-line">{lineLabel}</span>
        </button>
        <span className="cmt-time">{timeAgo(comment.createdAt)}</span>
      </div>

      {comment.lineContent?.trim() && (
        <button className="cmt-codeline" onClick={jump} title="Jump to line">
          <code>{comment.lineContent.trim().slice(0, 160)}</code>
        </button>
      )}

      {editing ? (
        <CommentForm
          draftKey={`tracker-edit:${comment.id}`}
          initialBody={comment.body}
          onCancel={() => setEditing(false)}
          onSubmit={(body) => {
            editComment(comment.id, body)
            setEditing(false)
          }}
        />
      ) : (
        <Markdown content={comment.body} className="cmt-body markdown-body" />
      )}

      <div className="cmt-actions">
        <button className="cmt-act" onClick={() => { setReplying((v) => !v); setExpanded(true) }} title="Reply">
          <CornerUpLeft size={13} aria-hidden="true" />
          <span>Reply</span>
        </button>
        <button className="cmt-act" onClick={() => setEditing((v) => !v)} title="Edit comment">
          <Pencil size={13} aria-hidden="true" />
        </button>
        <button
          className={`cmt-act ${resolved ? 'cmt-act-resolved' : ''}`}
          onClick={() => {
            if (resolved) {
              unresolveComment(comment.id)
              haptic('light'); sound('toggle')
            } else {
              resolveComment(comment.id)
              haptic('success'); sound('resolve')
            }
          }}
          title={resolved ? 'Reopen' : 'Resolve'}
        >
          {resolved ? <RotateCcw size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
        </button>
        {confirmDelete ? (
          <span className="cmt-confirm">
            <button className="cmt-act cmt-act-danger" onClick={() => { removeComment(comment.id); haptic('medium'); sound('remove') }} title="Confirm delete">
              Delete?
            </button>
            <button className="cmt-act" onClick={() => setConfirmDelete(false)} title="Cancel">
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        ) : (
          <button className="cmt-act cmt-act-del" onClick={() => setConfirmDelete(true)} title="Delete comment">
            <Trash2 size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      {replyCount > 0 && (
        <button className="cmt-thread-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <ChevronRight size={12} className={`cmt-chev ${expanded ? 'cmt-chev-open' : ''}`} aria-hidden="true" />
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </button>
      )}

      {expanded && replyCount > 0 && (
        <ul className="cmt-replies">
          {comment.replies.map((r) => (
            <ReplyRow
              key={r.id}
              reply={r}
              onEdit={(body) => editReply(comment.id, r.id, body)}
              onRemove={() => removeReply(comment.id, r.id)}
            />
          ))}
        </ul>
      )}

      {replying && (
        <CommentForm
          draftKey={`reply:${comment.id}`}
          onCancel={() => setReplying(false)}
          onSubmit={(body) => {
            addReply(comment.id, body)
            haptic('light'); sound('success')
            setReplying(false)
            setExpanded(true)
          }}
        />
      )}
    </li>
  )
}

function ReplyRow({
  reply,
  onEdit,
  onRemove,
}: {
  reply: CommentReply
  onEdit: (body: string) => void
  onRemove: () => void
}) {
  const isAgent = reply.role === 'agent' || (reply.role == null && !!reply.model)
  const [editing, setEditing] = useState(false)

  return (
    <li className={`cmt-reply ${isAgent ? 'cmt-reply-agent' : ''}`}>
      <div className="cmt-reply-head">
        <span className={`cmt-reply-who ${isAgent ? 'cmt-reply-who-agent' : ''}`}>
          {isAgent ? <Bot size={11} aria-hidden="true" /> : null}
          {isAgent ? reply.model || 'Agent' : 'You'}
        </span>
        <span className="cmt-time">{timeAgo(reply.createdAt)}</span>
        {!isAgent && (
          <button className="cmt-reply-act" onClick={() => setEditing((v) => !v)} title="Edit reply">
            <Pencil size={11} aria-hidden="true" />
          </button>
        )}
        <button className="cmt-reply-act cmt-act-del" onClick={onRemove} title="Delete reply">
          <Trash2 size={11} aria-hidden="true" />
        </button>
      </div>
      {editing ? (
        <CommentForm
          draftKey={`tracker-reply-edit:${reply.id}`}
          initialBody={reply.body}
          onCancel={() => setEditing(false)}
          onSubmit={(body) => {
            onEdit(body)
            setEditing(false)
          }}
        />
      ) : (
        <Markdown content={reply.body} className="cmt-reply-body markdown-body" />
      )}
    </li>
  )
}

