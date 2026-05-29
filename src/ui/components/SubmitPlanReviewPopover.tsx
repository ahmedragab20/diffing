import { useState } from 'react'
import { Check, MessageSquareWarning, X, ClipboardCheck } from 'lucide-react'
import type { PlanDecision } from '../../lib/plan-types'
import { useFeedback } from '../hooks/useHaptics'
import { Popover } from '../primitives/Popover'

interface SubmitPlanReviewPopoverProps {
  openCommentCount: number
  onSubmit: (decision: PlanDecision, comment?: string) => Promise<unknown>
  submitting: boolean
  agentWaiting: boolean
  /** The plan's current verdict, so an already-decided plan reads as re-deciding. */
  currentDecision: PlanDecision
}

type Verdict = Exclude<PlanDecision, 'pending'>

const OPTIONS: { value: Verdict; label: string; description: string; icon: typeof Check; className: string }[] = [
  {
    value: 'approved',
    label: 'Approve',
    description: 'The plan looks good — the agent should proceed.',
    icon: Check,
    className: 'plan-verdict-approve',
  },
  {
    value: 'changes-requested',
    label: 'Request changes',
    description: 'The agent should revise the plan and resubmit it.',
    icon: MessageSquareWarning,
    className: 'plan-verdict-changes',
  },
  {
    value: 'rejected',
    label: 'Reject',
    description: "Don't proceed — the approach needs rethinking.",
    icon: X,
    className: 'plan-verdict-reject',
  },
]

/**
 * GitHub-style "submit your review" for a plan. Pick a verdict
 * (approve / request changes / reject), optionally add an overall note, and
 * submit — which both records the decision and releases the waiting agent.
 */
export function SubmitPlanReviewPopover({
  openCommentCount,
  onSubmit,
  submitting,
  agentWaiting,
  currentDecision,
}: SubmitPlanReviewPopoverProps) {
  const { haptic, sound } = useFeedback()
  const [open, setOpen] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [comment, setComment] = useState('')

  const handleSubmit = async () => {
    if (!verdict) return
    haptic('heavy')
    sound('send')
    await onSubmit(verdict, comment)
    setComment('')
    setVerdict(null)
    setOpen(false)
  }

  const alreadyDecided = currentDecision !== 'pending'

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Submit plan review"
      className="submit-plan-review-popover"
      trigger={
        <button
          className="btn btn-primary btn-sm"
          disabled={submitting}
          title={agentWaiting ? 'An agent is connected and waiting for your verdict' : 'Submit your verdict on this plan'}
        >
          {agentWaiting && <span className="agent-waiting-dot" aria-hidden="true" />}
          {submitting ? 'Submitting…' : alreadyDecided ? 'Update review' : 'Submit review'}
        </button>
      }
    >
      <div className="srp">
        <div className="srp-head">
          <ClipboardCheck size={15} aria-hidden="true" />
          <span className="srp-title">Submit plan review</span>
          {openCommentCount > 0 && (
            <span className="srp-count">
              {openCommentCount} open comment{openCommentCount === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="plan-verdict-options" role="radiogroup" aria-label="Verdict">
          {OPTIONS.map((opt) => {
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

        <div className="srp-general">
          <label className="srp-general-label" htmlFor="plan-decision-comment">
            Overall comment <span className="srp-optional">(optional)</span>
          </label>
          <textarea
            id="plan-decision-comment"
            className="srp-general-input"
            value={comment}
            placeholder="Add an overall note for the agent that applies to the whole plan…"
            rows={3}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
        </div>

        <div className="srp-footer">
          <button className="btn btn-sm" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={!verdict || submitting}>
            {submitting ? 'Submitting…' : 'Submit review'}
          </button>
        </div>
      </div>
    </Popover>
  )
}
