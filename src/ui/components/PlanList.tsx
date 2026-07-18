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
      <div className="ft-search" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
        <div className="ft-search-row">
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
        <div className="ft-chips plan-list-chips" role="group" aria-label="Filter by decision">
          {(
            [
              { id: 'all' as const, label: 'All' },
              { id: 'pending' as const, label: pendingCount ? `Pending (${pendingCount})` : 'Pending' },
              { id: 'approved' as const, label: 'Approved' },
              { id: 'changes-requested' as const, label: 'Changes' },
              { id: 'rejected' as const, label: 'Rejected' },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`ft-chip ${decisionFilter === chip.id ? 'ft-chip-active' : ''}`}
              aria-pressed={decisionFilter === chip.id}
              onClick={() => handleDecisionFilter(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
      <div className="plan-list-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="plan-list-header">
          Plans ({filteredPlans.length}
          {filteredPlans.length !== plans.length ? ` / ${plans.length}` : ''})
        </div>
        {filteredPlans.length === 0 && (
          <div className="plan-list-empty">
            {filter || decisionFilter !== 'all' ? 'No matching plans found.' : 'No plans submitted yet.'}
          </div>
        )}
        {filteredPlans.map((plan) => {
          const meta = DECISION_ICON[plan.decision]
          const Icon = meta.icon
          const open = (plan.comments ?? []).filter((c) => c.status === 'open').length
          const path = plan.sourcePath || plan.source
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
              {path && (
                <div className="plan-list-item-path" title={path}>
                  {path.replace(/\\/g, '/').split('/').slice(-2).join('/')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
