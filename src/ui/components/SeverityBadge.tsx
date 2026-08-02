import {
  AlertOctagon,
  CircleDot,
  HelpCircle,
  Minus,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { CommentSeverity } from '../../lib/types'

/**
 * Per-severity display metadata — icons mirror the `SeveritySelect` picker so
 * the badge, the dropdown, and the form trigger all share one visual language.
 */
const SEVERITY_META: Record<CommentSeverity, { label: string; Icon: LucideIcon }> = {
  none: { label: 'None', Icon: Minus },
  blocking: { label: 'Blocking', Icon: AlertOctagon },
  nit: { label: 'Nit', Icon: CircleDot },
  question: { label: 'Question', Icon: HelpCircle },
  praise: { label: 'Praise', Icon: Sparkles },
}

export interface SeverityBadgeProps {
  severity: CommentSeverity
  /** Extra class hook for layout-specific tweaks. */
  className?: string
  /** Accessible title override; defaults to "Severity: <Label>". */
  title?: string
}

/**
 * Soft, icon-led severity pill — filled tinted background + matching subtle
 * border (no hard neutral outline) + per-severity lucide icon. Mirrors the
 * `.comment-outdated-badge` treatment so the two chips look like siblings
 * wherever they appear together (comment card footer, comments sidebar, …).
 *
 * The soft style is intentionally consistent across every context: the old
 * `.comment-severity-badge` was outlined + iconless, which read as a disjoint
 * next to the soft + icon outdated badge ("outlined once, soft once; icon
 * once, not once"). Reusing this component everywhere restores parity.
 */
export function SeverityBadge({ severity, className, title }: SeverityBadgeProps) {
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.none
  const { Icon } = meta
  return (
    <span
      className={`comment-sev-badge-soft${className ? ` ${className}` : ''}`}
      data-severity={severity}
      title={title ?? `Severity: ${meta.label}`}
    >
      <Icon size={10} aria-hidden="true" />
      {meta.label.toLowerCase()}
    </span>
  )
}