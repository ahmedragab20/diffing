import { readBoolUi } from './planUiState'

/**
 * Persisted diffs-page chrome keys (getUiStateItem / setUiStateItem).
 * Every diffs UI toggle that changes layout must use these — no bare useState
 * defaults without read/write through ui-state.
 */
export const DIFF_UI = {
  /** Immersive diffs-only view: no sidebar, no full toolbar — just a minimal bar. */
  zenMode: 'diffing-zen-mode',
} as const

/** Zen starts off unless the user explicitly enabled it in a previous session. */
export function readZenMode(defaultValue = false): boolean {
  return readBoolUi(DIFF_UI.zenMode, defaultValue)
}
