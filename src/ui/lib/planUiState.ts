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
} as const

export function readBoolUi(key: string, defaultValue: boolean): boolean {
  try {
    const v = getUiStateItem(key)
    if (v === 'true') return true
    if (v === 'false') return false
  } catch {}
  return defaultValue
}
