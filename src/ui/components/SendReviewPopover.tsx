import { useState, useMemo, useRef, useEffect } from 'react'
import { Bot, Pencil, Trash2, Check, X, MessageSquareWarning, MessageSquare, ShieldAlert } from 'lucide-react'
import { useFeedback } from '../hooks/useHaptics'
import type { ReviewComment, ReviewDecision, ReviewMode } from '../../lib/types'
import { fileName } from '../utils'
import { Popover } from '../primitives/Popover'
import { MarkdownField } from './MarkdownField'
import { useSubmitPanelSize, SUBMIT_PANEL_PRESETS } from '../hooks/useSubmitPanelSize'

interface SecretFinding {
  rule: string
  snippet: string
  source: string
}

interface SendReviewPopoverProps {
  comments: ReviewComment[]
  totalFileCount: number
  viewedFileCount: number
  requireViewAllBeforeSend: boolean
  onEditComment: (id: string, body: string) => void
  onDeleteComment: (id: string) => void
  onSend: (
    decision: ReviewDecision,
    generalComment?: string,
    mode?: ReviewMode,
    force?: boolean,
  ) => Promise<unknown>
  sending: boolean
  agentWaiting: boolean
  waitingAgents?: Array<{ id: string; model?: string; label?: string; connectedAt: number }>
  onCopyComments?: () => Promise<void>
  onCopyMarkdown?: () => Promise<void>
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
  totalFileCount,
  viewedFileCount,
  requireViewAllBeforeSend,
  onEditComment,
  onDeleteComment,
  onSend,
  sending,
  agentWaiting,
  waitingAgents = [],
  onCopyComments,
  onCopyMarkdown,
}: SendReviewPopoverProps) {
  const { haptic, sound } = useFeedback()
  const [open, setOpen] = useState(false)
  const [general, setGeneral] = useState('')
  const [verdict, setVerdict] = useState<ReviewDecision | null>(null)
  const [copied, setCopied] = useState(false)
  const [secretFindings, setSecretFindings] = useState<SecretFinding[] | null>(null)
  const [forceConfirmed, setForceConfirmed] = useState(false)
  const {
    popoverStyle,
    activePreset,
    applyPreset,
    startResize,
    startLeftResize,
    startCornerResize,
    handleOpenChange,
    panelRef,
  } = useSubmitPanelSize()

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

  const unviewedCount = Math.max(0, totalFileCount - viewedFileCount)

  const handleSend = async () => {
    if (!verdict) return
    // Guard: warn when "require view-all" is on and some files are unviewed.
    // We bail out and surface the warning so the reviewer can either tick the
    // viewed boxes or change their mind — silently sending would defeat the
    // purpose of the toggle.
    if (requireViewAllBeforeSend && unviewedCount > 0 && !forceConfirmed) {
      haptic('medium')
      const ok =
        typeof window === 'undefined'
          ? false
          : window.confirm(
              `${unviewedCount} file${unviewedCount === 1 ? '' : 's'} ${unviewedCount === 1 ? 'is' : 'are'} still unviewed. ` +
                'Send the review to the agent anyway?',
            )
      if (!ok) {
        setForceConfirmed(false)
        setOpen(true)
        return
      }
      setForceConfirmed(true)
    }

    haptic('heavy')
    sound('send')
    const mode: ReviewMode = verdict === 'comment-only' ? 'comment-only' : 'standard'
    try {
      await onSend(verdict, general, mode, forceConfirmed)
      setGeneral('')
      setVerdict(null)
      setOpen(false)
      setSecretFindings(null)
      setForceConfirmed(false)
    } catch (err: any) {
      // Surface a structured secrets-detected prompt so the reviewer can
      // either redact the credentials or explicitly force-send.
      if (err?.kind === 'secrets') {
        setSecretFindings(err.findings as SecretFinding[])
        setForceConfirmed(false)
        return
      }
      // Re-throw for the surrounding mutation to handle generic failures.
      throw err
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => handleOpenChange(next, details, setOpen)}
      ariaLabel="Submit your review to the agent"
      className="send-review-popover"
      trigger={
        <button
          className="btn btn-primary btn-sm send-review-btn"
          disabled={sending}
          title={
            waitingAgents.length > 0
              ? `Waiting: ${waitingAgents.map((a) => a.label || a.model || a.id.slice(0, 8)).join(', ')}`
              : agentWaiting
                ? 'Agent waiting for your review'
                : 'Submit review to agent'
          }
          aria-label={
            sending
              ? 'Sending review'
              : count > 0
                ? `Send review with ${count} comment${count === 1 ? '' : 's'}`
                : 'Send review to agent'
          }
        >
          {agentWaiting && <span className="agent-waiting-dot" aria-hidden="true" />}
          <Bot size={14} aria-hidden="true" />
          <span className="btn-label">
            {sending
              ? 'Sending…'
              : waitingAgents.length > 1
                ? `Send (${waitingAgents.length})`
                : count > 0
                  ? `Send (${count})`
                  : 'Send review'}
          </span>
        </button>
      }
    >
      <div className="srp" ref={panelRef} style={popoverStyle}>
        <div className="srp-resize-handle-left" onPointerDown={startLeftResize} role="separator" aria-orientation="vertical" aria-label="Resize submit panel width" tabIndex={0} />
        <div className="srp-head">
          <Bot size={15} aria-hidden="true" />
          <span className="srp-title">Submit review</span>
          <div className="srp-size-presets" role="group" aria-label="Panel size">
            {SUBMIT_PANEL_PRESETS.map((p, i) => (
              <button
                key={p.label}
                className="srp-preset-btn"
                role="radio"
                aria-checked={activePreset === i}
                aria-pressed={activePreset === i}
                onClick={() => applyPreset(p)}
                title={`${p.width}×${p.height}px`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {count > 0 && (
            <span className="srp-count">{count} comment{count === 1 ? '' : 's'}</span>
          )}
        </div>

        {waitingAgents.length > 0 && (
          <div className="srp-agents" aria-label="Waiting agents">
            <span className="srp-agents-label">
              {waitingAgents.length === 1 ? 'Agent waiting' : `${waitingAgents.length} agents waiting`}
            </span>
            <ul className="srp-agents-list">
              {waitingAgents.map((a) => (
                <li key={a.id} className="srp-agent-chip" title={a.id}>
                  <span className="agent-waiting-dot" aria-hidden="true" />
                  <span className="srp-agent-name">
                    {a.label || a.model || a.id.slice(0, 8)}
                  </span>
                  {a.model && a.label && (
                    <span className="srp-agent-model">{a.model}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="srp-scroll">
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

        {unviewedCount > 0 && (
          <div className="srp-warning" role="note" data-tone="muted">
            <span>
              <strong>{unviewedCount}</strong> of <strong>{totalFileCount}</strong> file
              {totalFileCount === 1 ? '' : 's'} still unviewed.
              {requireViewAllBeforeSend && (
                <> Sending will require an extra confirmation.</>
              )}
            </span>
          </div>
        )}

        {secretFindings && (
          <div className="srp-warning srp-warning-danger" role="alert" data-tone="danger">
            <div className="srp-warning-head">
              <ShieldAlert size={14} aria-hidden="true" />
              <strong>
                {secretFindings.length} possible secret
                {secretFindings.length === 1 ? '' : 's'} detected
              </strong>
            </div>
            <ul className="srp-warning-list">
              {secretFindings.map((f, i) => (
                <li key={i}>
                  <code>{f.rule}</code>: <code>{f.snippet}</code> <span className="srp-warning-source">in {f.source}</span>
                </li>
              ))}
            </ul>
            <div className="srp-warning-actions">
              <button
                className="btn btn-sm"
                onClick={() => setSecretFindings(null)}
                disabled={sending}
              >
                Cancel &amp; edit
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => {
                  setForceConfirmed(true)
                  setSecretFindings(null)
                  void handleSend()
                }}
                disabled={sending}
              >
                Send anyway
              </button>
            </div>
          </div>
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
        </div>

        <div className="srp-footer">
          {onCopyComments && (
            <div style={{ marginRight: 'auto', display: 'flex', gap: 6 }}>
              <button
                className="btn btn-sm"
                onClick={handleCopy}
                disabled={count === 0}
              >
                {copied ? 'Copied!' : 'Copy XML'}
              </button>
              {onCopyMarkdown && (
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    try {
                      await onCopyMarkdown()
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    } catch {
                      /* ignore */
                    }
                  }}
                  disabled={count === 0}
                  title="Copy review as Markdown"
                >
                  Copy MD
                </button>
              )}
            </div>
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
        <div className="srp-resize-handle" onPointerDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize submit panel" tabIndex={0} />
        <div
          className="srp-resize-handle-corner"
          onPointerDown={startCornerResize}
          role="separator"
          aria-label="Resize submit panel width and height"
          tabIndex={0}
        />
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
