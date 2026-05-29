import { useState, useMemo, useRef, useEffect } from 'react'
import { Bot, Pencil, Trash2, Check, X } from 'lucide-react'
import type { ReviewComment } from '../../lib/types'
import { fileName } from '../utils'
import { Popover } from '../primitives/Popover'

interface SendReviewPopoverProps {
  comments: ReviewComment[]
  onEditComment: (id: string, body: string) => void
  onDeleteComment: (id: string) => void
  onSend: (generalComment?: string) => Promise<unknown>
  sending: boolean
  agentWaiting: boolean
}

/**
 * GitHub-style "finish your review" flow. Clicking "Send to agent" opens a
 * popover that previews every comment that will be handed off — each one can be
 * edited inline or removed — plus an optional overall comment that applies to
 * the whole review. Submitting sends the batch to the waiting agent.
 */
export function SendReviewPopover({
  comments,
  onEditComment,
  onDeleteComment,
  onSend,
  sending,
  agentWaiting,
}: SendReviewPopoverProps) {
  const [open, setOpen] = useState(false)
  const [general, setGeneral] = useState('')

  const count = comments.length

  const sorted = useMemo(
    () => [...comments].sort((a, b) => a.createdAt - b.createdAt),
    [comments],
  )

  // The popover can stay open while comments mutate from elsewhere; if every
  // comment is removed there is nothing left to send, so close it.
  useEffect(() => {
    if (open && count === 0) setOpen(false)
  }, [open, count])

  const handleSend = async () => {
    await onSend(general)
    setGeneral('')
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Review comments before sending to agent"
      className="send-review-popover"
      trigger={
        <button
          className="btn btn-primary btn-sm"
          disabled={count === 0 || sending}
          title={agentWaiting ? 'An agent is connected and waiting' : 'Review and send comments to a waiting agent'}
        >
          {agentWaiting && <span className="agent-waiting-dot" aria-hidden="true" />}
          {sending ? 'Sending…' : `Send to agent (${count})`}
        </button>
      }
    >
      <div className="srp">
        <div className="srp-head">
          <Bot size={15} aria-hidden="true" />
          <span className="srp-title">Send review to agent</span>
          <span className="srp-count">{count} comment{count === 1 ? '' : 's'}</span>
        </div>

        <ul className="srp-list" aria-label="Comments to send">
          {sorted.map((c) => (
            <SendReviewItem
              key={c.id}
              comment={c}
              onEdit={onEditComment}
              onDelete={onDeleteComment}
            />
          ))}
        </ul>

        <div className="srp-general">
          <label className="srp-general-label" htmlFor="srp-general-input">
            Overall comment <span className="srp-optional">(optional)</span>
          </label>
          <textarea
            id="srp-general-input"
            className="srp-general-input"
            value={general}
            placeholder="Add an overall note for the agent that applies to the whole review…"
            rows={3}
            onChange={(e) => setGeneral(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
        </div>

        <div className="srp-footer">
          <button className="btn btn-sm" onClick={() => setOpen(false)} disabled={sending}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSend}
            disabled={count === 0 || sending}
          >
            {sending ? 'Sending…' : `Send ${count} comment${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Popover>
  )
}

function SendReviewItem({
  comment,
  onEdit,
  onDelete,
}: {
  comment: ReviewComment
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  const lineLabel =
    comment.lineNumber > 0
      ? comment.startLineNumber && comment.startLineNumber !== comment.lineNumber
        ? `:${comment.startLineNumber}-${comment.lineNumber}`
        : `:${comment.lineNumber}`
      : ' · file'

  const save = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== comment.body) onEdit(comment.id, trimmed)
    setEditing(false)
  }

  return (
    <li className="srp-item">
      <div className="srp-item-top">
        <span className="srp-item-loc">
          <span className="srp-item-file">{fileName(comment.filePath)}</span>
          <span className="srp-item-line">{lineLabel}</span>
        </span>
        {comment.status === 'resolved' && <span className="srp-item-resolved">resolved</span>}
        <span className="srp-item-actions">
          {editing ? (
            <>
              <button className="srp-icon-btn" onClick={save} title="Save edit">
                <Check size={13} aria-hidden="true" />
              </button>
              <button
                className="srp-icon-btn"
                onClick={() => {
                  setDraft(comment.body)
                  setEditing(false)
                }}
                title="Cancel edit"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </>
          ) : (
            <button className="srp-icon-btn" onClick={() => setEditing(true)} title="Edit comment">
              <Pencil size={13} aria-hidden="true" />
            </button>
          )}
          <button
            className="srp-icon-btn srp-icon-btn-danger"
            onClick={() => onDelete(comment.id)}
            title="Remove from review"
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </span>
      </div>

      {comment.lineContent?.trim() && (
        <code className="srp-item-code">{comment.lineContent.trim().slice(0, 160)}</code>
      )}

      {editing ? (
        <textarea
          ref={ref}
          className="srp-item-edit"
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(comment.body)
              setEditing(false)
            }
          }}
        />
      ) : (
        <p className="srp-item-body">{comment.body}</p>
      )}
    </li>
  )
}
