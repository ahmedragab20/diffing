import { useState, useMemo } from 'react'
import { Check, X, MessageSquareWarning, Clock, Trash2, Bot, Search, PanelLeftClose, PanelLeftOpen, MessageSquare } from 'lucide-react'
import type { Plan, PlanDecision } from '../../lib/plan-types'
import { timeAgo } from '../utils'
import { Tooltip } from '../primitives/Tooltip'

interface PlanListProps {
  plans: Plan[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const DECISION_ICON: Record<PlanDecision, { icon: typeof Check; className: string; label: string }> = {
  pending: { icon: Clock, className: 'plan-badge-pending', label: 'Pending' },
  approved: { icon: Check, className: 'plan-badge-approved', label: 'Approved' },
  'changes-requested': { icon: MessageSquareWarning, className: 'plan-badge-changes', label: 'Changes' },
  rejected: { icon: X, className: 'plan-badge-rejected', label: 'Rejected' },
  'comment-only': { icon: MessageSquare, className: 'plan-badge-comment-only', label: 'Comment only' },
}

export function PlanList({ plans, activeId, onSelect, onDelete, collapsed, onToggleCollapse }: PlanListProps) {
  const [filter, setFilter] = useState('')

  // Newest first, so a freshly submitted plan jumps to the top of the list.
  const sorted = useMemo(() => [...plans].sort((a, b) => b.createdAt - a.createdAt), [plans])

  const filteredPlans = useMemo(() => {
    return sorted.filter((plan) =>
      plan.title.toLowerCase().includes(filter.toLowerCase())
    )
  }, [sorted, filter])

  if (collapsed) {
    return (
      <div className="ft">
        <div className="ft-search">
          {onToggleCollapse && (
            <Tooltip content="Expand sidebar" side="right">
              <button
                className="sidebar-toggle"
                onClick={onToggleCollapse}
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen size={16} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ft" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ft-search">
        {onToggleCollapse && (
          <Tooltip content="Collapse sidebar" side="right">
            <button
              className="sidebar-toggle"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          </Tooltip>
        )}
        <div className="ft-search-wrapper">
          <Search size={14} className="ft-search-icon" />
          <input
            type="text"
            placeholder="Filter plans..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ft-search-input"
          />
        </div>
      </div>
      <div className="plan-list-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="plan-list-header">Plans ({filteredPlans.length})</div>
        {filteredPlans.length === 0 && (
          <div className="plan-list-empty">
            {filter ? 'No matching plans found.' : 'No plans submitted yet.'}
          </div>
        )}
        {filteredPlans.map((plan) => {
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
    </div>
  )
}
