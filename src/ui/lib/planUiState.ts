import { getUiStateItem } from '../utils/uiState'

/**
 * Persisted plan-page chrome keys (getUiStateItem / setUiStateItem).
 * Every plan UI toggle that changes layout must use these — no bare useState
 * defaults without read/write through ui-state.
 */
export type PlanViewMode = 'source' | 'rendered' | 'split'
export type PlanSingleViewMode = 'source' | 'rendered'

export const PLAN_UI = {
  viewMode: 'diffing-plan-view-mode',
  /** Last single-pane mode before Split — used when Split auto-downgrades on narrow viewports. */
  lastSingleViewMode: 'diffing-plan-last-single-view-mode',
  tocOpen: 'diffing-plan-toc-open',
  commentsRail: 'diffing-plan-comments-rail',
  decisionFilter: 'diffing-plan-decision-filter',
  /** Source pane width as % of the split content area (20–80). */
  splitRatio: 'diffing-plan-split-ratio',
  /** Immersive full-width Read (zen) mode. */
  zenMode: 'diffing-plan-zen-mode',
} as const

/** Split collapses to the last single mode (default Read) below the split breakpoint. */
export function getEffectivePlanViewMode(
  viewMode: PlanViewMode,
  isNarrowSplit: boolean,
  lastSingleViewMode: PlanSingleViewMode,
): PlanViewMode {
  if (isNarrowSplit && viewMode === 'split') return lastSingleViewMode
  return viewMode
}

export function readLastSingleViewMode(defaultValue: PlanSingleViewMode = 'rendered'): PlanSingleViewMode {
  try {
    const v = getUiStateItem(PLAN_UI.lastSingleViewMode)
    if (v === 'rendered' || v === 'source') return v
  } catch {}
  return defaultValue
}

/** Default comments rail: closed on tablet (769–1024), open elsewhere. */
export function readDefaultCommentsRailOpen(): boolean {
  if (typeof window === 'undefined') return true
  const w = window.innerWidth
  if (w > 768 && w <= 1024) return false
  return true
}

export function readBoolUi(key: string, defaultValue: boolean): boolean {
  try {
    const v = getUiStateItem(key)
    if (v === 'true') return true
    if (v === 'false') return false
  } catch {}
  return defaultValue
}

/** Source-pane share of the split view, clamped to a usable range. */
export function readSplitRatioUi(defaultValue = 50): number {
  try {
    const v = getUiStateItem(PLAN_UI.splitRatio)
    if (v != null && v !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) return clampSplitRatio(n)
    }
  } catch {}
  return clampSplitRatio(defaultValue)
}

export function clampSplitRatio(n: number): number {
  return Math.max(20, Math.min(80, Math.round(n * 10) / 10))
}
