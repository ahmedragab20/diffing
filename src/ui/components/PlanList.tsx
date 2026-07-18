import { useState, useMemo, useCallback } from 'react'
import {
  Check,
  X,
  MessageSquareWarning,
  Clock,
  Trash2,
  Bot,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Copy,
} from 'lucide-react'
import type { Plan, PlanDecision } from '../../lib/plan-types'
import { timeAgo } from '../utils'
import { Tooltip } from '../primitives/Tooltip'
import { getUiStateItem, setUiStateItem } from '../utils/uiState'
import { PLAN_UI } from '../lib/planUiState'

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

type DecisionFilter = 'all' | PlanDecision

const DECISION_FILTERS: DecisionFilter[] = [
  'all',
  'pending',
  'approved',
  'changes-requested',
  'rejected',
  'comment-only',
]

function readDecisionFilter(): DecisionFilter {
  try {
    const v = getUiStateItem(PLAN_UI.decisionFilter)
    if (v && (DECISION_FILTERS as string[]).includes(v)) return v as DecisionFilter
  } catch {}
  return 'all'
}

export function PlanList({ plans, activeId, onSelect, onDelete, collapsed, onToggleCollapse }: PlanListProps) {
  const [filter, setFilter] = useState('')
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>(readDecisionFilter)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleDecisionFilter = useCallback((next: DecisionFilter) => {
    setDecisionFilter(next)
    setUiStateItem(PLAN_UI.decisionFilter, next)
  }, [])

  // Newest first, so a freshly submitted plan jumps to the top of the list.
  const sorted = useMemo(() => [...plans].sort((a, b) => b.createdAt - a.createdAt), [plans])

  const filteredPlans = useMemo(() => {
    const q = filter.toLowerCase().trim()
    return sorted.filter((plan) => {
      if (decisionFilter !== 'all' && plan.decision !== decisionFilter) return false
      if (!q) return true
      const hay = `${plan.title} ${plan.source ?? ''} ${plan.sourcePath ?? ''} ${plan.model ?? ''} ${plan.id}`.toLowerCase()
      return hay.includes(q)
    })
  }, [sorted, filter, decisionFilter])

  const pendingCount = useMemo(
    () => plans.filter((p) => p.decision === 'pending').length,
    [plans],
  )

  if (collapsed) {
    return (
      <div className="plan-list plan-list-collapsed">
        {onToggleCollapse && (
          <Tooltip content="Expand sidebar · b" side="right">
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
    )
  }

  return (
    <div className="plan-list">
      <div className="plan-list-chrome">
        <div className="plan-list-toolbar">
          {onToggleCollapse && (
            <Tooltip content="Collapse sidebar · b" side="right">
              <button
                className="sidebar-toggle"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose size={16} />
              </button>
            </Tooltip>
          )}
          <div className="plan-list-search">
            <Search size={14} className="plan-list-search-icon" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search plans…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="plan-list-search-input"
              aria-label="Search plans"
            />
          </div>
        </div>

        <div className="plan-list-filters" role="group" aria-label="Filter by decision">
          {(
            [
              { id: 'all' as const, label: 'All' },
              { id: 'pending' as const, label: pendingCount ? `Pending ${pendingCount}` : 'Pending' },
              { id: 'approved' as const, label: 'Approved' },
              { id: 'changes-requested' as const, label: 'Changes' },
              { id: 'rejected' as const, label: 'Rejected' },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`plan-list-filter ${decisionFilter === chip.id ? 'is-active' : ''}`}
              aria-pressed={decisionFilter === chip.id}
              onClick={() => handleDecisionFilter(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="plan-list-scroll">
        <div className="plan-list-header">
          <span>
            {filteredPlans.length === plans.length
              ? `${plans.length} plan${plans.length === 1 ? '' : 's'}`
              : `${filteredPlans.length} of ${plans.length}`}
          </span>
        </div>

        {filteredPlans.length === 0 && (
          <div className="plan-list-empty">
            {filter || decisionFilter !== 'all' ? 'No matching plans.' : 'No plans yet.'}
          </div>
        )}

        <div className="plan-list-items">
          {filteredPlans.map((plan) => {
            const meta = DECISION_ICON[plan.decision]
            const Icon = meta.icon
            const open = (plan.comments ?? []).filter((c) => c.status === 'open').length
            const path = plan.sourcePath || plan.source
            const isActive = plan.id === activeId
            return (
              <div
                key={plan.id}
                className={`plan-list-item ${isActive ? 'plan-list-item-active' : ''}`}
                onClick={() => onSelect(plan.id)}
                role="button"
                tabIndex={0}
                aria-current={isActive ? 'true' : undefined}
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
                  {path && (
                    <Tooltip content="Copy source path">
                      <button
                        className="plan-list-copy-path"
                        title="Copy source path"
                        aria-label="Copy source path"
                        onClick={(e) => {
                          e.stopPropagation()
                          const full = plan.sourcePath || plan.source || ''
                          navigator.clipboard?.writeText(full).then(
                            () => {
                              setCopiedId(plan.id)
                              window.setTimeout(() => setCopiedId(null), 1200)
                            },
                            () => {},
                          )
                        }}
                      >
                        {copiedId === plan.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </Tooltip>
                  )}
                  <button
                    className="plan-list-delete"
                    title="Delete plan"
                    aria-label="Delete plan"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(plan.id)
                    }}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
                <div className="plan-list-item-sub">
                  <span className="plan-list-item-version">v{plan.version}</span>
                  {open > 0 && (
                    <span className="plan-list-item-open">{open} open</span>
                  )}
                  {plan.model && (
                    <span className="plan-list-item-model" title={plan.model}>
                      <Bot size={10} aria-hidden="true" />
                      {plan.model}
                    </span>
                  )}
                  <span className="plan-list-item-time">{timeAgo(plan.createdAt)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
