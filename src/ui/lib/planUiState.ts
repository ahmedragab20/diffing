import { getUiStateItem } from '../utils/uiState'

/**
 * Persisted plan-page chrome keys (getUiStateItem / setUiStateItem).
 * Every plan UI toggle that changes layout must use these — no bare useState
 * defaults without read/write through ui-state.
 */
export const PLAN_UI = {
  viewMode: 'diffing-plan-view-mode',
  tocOpen: 'diffing-plan-toc-open',
  commentsRail: 'diffing-plan-comments-rail',
  decisionFilter: 'diffing-plan-decision-filter',
  /** Source pane width as % of the split content area (20–80). */
  splitRatio: 'diffing-plan-split-ratio',
  /** Immersive full-width Read (zen) mode. */
  zenMode: 'diffing-plan-zen-mode',
} as const

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
