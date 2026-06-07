import { useState, useMemo, useRef, useEffect } from 'react'
import { Bot, Pencil, Trash2, Check, X, MessageSquareWarning, MessageSquare } from 'lucide-react'
import { useFeedback } from '../hooks/useHaptics'
import type { ReviewComment, ReviewDecision, ReviewMode } from '../../lib/types'
import { fileName } from '../utils'
import { Popover } from '../primitives/Popover'
import { MarkdownField } from './MarkdownField'

interface SendReviewPopoverProps {
  comments: ReviewComment[]
  onEditComment: (id: string, body: string) => void
  onDeleteComment: (id: string) => void
  onSend: (decision: ReviewDecision, generalComment?: string, mode?: ReviewMode) => Promise<unknown>
  sending: boolean
  agentWaiting: boolean
  onCopyComments?: () => Promise<void>
}

const VERDICT_OPTIONS: {
  value: ReviewDecision
  label: string
  description: string
  icon: typeof Check
  className: string
}[] = [
  {
    value: 'approved',
    label: 'Approve',
    description: 'The changes look good — the agent can proceed.',
    icon: Check,
    className: 'plan-verdict-approve',
  },
  {
    value: 'changes-requested',
    label: 'Request edits',
    description: 'The agent should address the comments and apply edits.',
    icon: MessageSquareWarning,
    className: 'plan-verdict-changes',
  },
  {
    value: 'rejected',
    label: 'Reject',
    description: "Don't keep building on this — the approach needs rethinking.",
    icon: X,
    className: 'plan-verdict-reject',
  },
  {
    value: 'comment-only',
    label: 'Comment only',
    description: 'Agent must NOT edit files — only reply to comments. General note goes to chat.',
    icon: MessageSquare,
    className: 'plan-verdict-comment-only',
  },
]

/**
 * GitHub-style "finish your review" flow. Clicking "Send to agent" opens a
 * popover where you pick a verdict (approve / request edits / reject) — mirroring
 * the plan-review submission UI — preview every inline comment that will be
 * handed off (each editable or removable), and optionally add an overall note.
 * A verdict can be submitted on its own, so a review needs no inline comments.
 */
export function SendReviewPopover({
  comments,
  onEditComment,
  onDeleteComment,
  onSend,
  sending,
  agentWaiting,
  onCopyComments,
}: SendReviewPopoverProps) {
  const { haptic, sound } = useFeedback()
  const [open, setOpen] = useState(false)
  const [general, setGeneral] = useState('')
  const [verdict, setVerdict] = useState<ReviewDecision | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (onCopyComments) {
      await onCopyComments()
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const count = comments.length

  const sorted = useMemo(
    () => [...comments].sort((a, b) => a.createdAt - b.createdAt),
    [comments],
  )

  const handleSend = async () => {
    if (!verdict) return
    haptic('heavy')
    sound('send')
    const mode: ReviewMode = verdict === 'comment-only' ? 'comment-only' : 'standard'
    await onSend(verdict, general, mode)
    setGeneral('')
    setVerdict(null)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Submit your review to the agent"
      className="send-review-popover"
      trigger={
        <button
          className="btn btn-primary btn-sm send-review-btn"
          disabled={sending}
          title={agentWaiting ? 'An agent is connected and waiting' : 'Submit your review to a waiting agent'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          {agentWaiting && <span className="agent-waiting-dot" aria-hidden="true" />}
          <Bot size={14} />
          <span className="btn-label">{sending ? 'Sending…' : count > 0 ? `Send to agent (${count})` : 'Send to agent'}</span>
        </button>
      }
    >
      <div className="srp">
        <div className="srp-head">
          <Bot size={15} aria-hidden="true" />
          <span className="srp-title">Send review to agent</span>
          <span className="srp-count">{count} comment{count === 1 ? '' : 's'}</span>
        </div>

        <div className="plan-verdict-options" role="radiogroup" aria-label="Verdict">
          {VERDICT_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const selected = verdict === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`plan-verdict-option ${opt.className} ${selected ? 'plan-verdict-option-selected' : ''}`}
                onClick={() => setVerdict(opt.value)}
              >
                <span className="plan-verdict-icon">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <span className="plan-verdict-text">
                  <span className="plan-verdict-label">{opt.label}</span>
                  <span className="plan-verdict-desc">{opt.description}</span>
                </span>
                <span className="plan-verdict-radio" aria-hidden="true" />
              </button>
            )
          })}
        </div>

        {count > 0 ? (
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
        ) : (
          <p className="srp-empty">No inline comments — your verdict and overall note will be sent on their own.</p>
        )}

        <div className="srp-general">
          <label className="srp-general-label" htmlFor="srp-general-input">
            Overall comment <span className="srp-optional">(optional · Markdown)</span>
          </label>
          <MarkdownField
            id="srp-general-input"
            value={general}
            onChange={setGeneral}
            textareaClassName="srp-general-input"
            placeholder="Add an overall note for the agent that applies to the whole review…"
            rows={3}
            ariaLabel="Overall review comment"
            onSubmitShortcut={handleSend}
          />
        </div>

        <div className="srp-footer">
          {onCopyComments && (
            <button
              className="btn btn-sm"
              onClick={handleCopy}
              disabled={count === 0}
              style={{ marginRight: 'auto' }}
            >
              {copied ? 'Copied!' : 'Copy comments'}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setOpen(false)} disabled={sending}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSend}
            disabled={!verdict || sending}
          >
            {sending ? 'Sending…' : 'Send review'}
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
