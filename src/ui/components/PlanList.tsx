import { Check, X, MessageSquareWarning, Clock, Trash2, Bot } from 'lucide-react'
import type { Plan, PlanDecision } from '../../lib/plan-types'
import { timeAgo } from '../utils'

interface PlanListProps {
  plans: Plan[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

const DECISION_ICON: Record<PlanDecision, { icon: typeof Check; className: string; label: string }> = {
  pending: { icon: Clock, className: 'plan-badge-pending', label: 'Pending' },
  approved: { icon: Check, className: 'plan-badge-approved', label: 'Approved' },
  'changes-requested': { icon: MessageSquareWarning, className: 'plan-badge-changes', label: 'Changes' },
  rejected: { icon: X, className: 'plan-badge-rejected', label: 'Rejected' },
}

export function PlanList({ plans, activeId, onSelect, onDelete }: PlanListProps) {
  // Newest first, so a freshly submitted plan jumps to the top of the list.
  const sorted = [...plans].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="plan-list">
      <div className="plan-list-header">Plans ({plans.length})</div>
      {sorted.length === 0 && <div className="plan-list-empty">No plans submitted yet.</div>}
      {sorted.map((plan) => {
        const meta = DECISION_ICON[plan.decision]
        const Icon = meta.icon
        const open = (plan.comments ?? []).filter((c) => c.status === 'open').length
        return (
          <div
            key={plan.id}
            className={`plan-list-item ${plan.id === activeId ? 'plan-list-item-active' : ''}`}
            onClick={() => onSelect(plan.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(plan.id)
              }
            }}
          >
            <div className="plan-list-item-top">
              <span className={`plan-badge plan-badge-dot ${meta.className}`} title={meta.label}>
                <Icon size={11} aria-hidden="true" />
              </span>
              <span className="plan-list-item-title" title={plan.title}>
                {plan.title}
              </span>
              <button
                className="plan-list-delete"
                title="Delete plan"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(plan.id)
                }}
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </div>
            <div className="plan-list-item-sub">
              <span>v{plan.version}</span>
              {open > 0 && <span>· {open} open</span>}
              {plan.model && (
                <span className="plan-list-item-model">
                  · <Bot size={10} aria-hidden="true" /> {plan.model}
                </span>
              )}
              <span className="plan-list-item-time">· {timeAgo(plan.createdAt)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
