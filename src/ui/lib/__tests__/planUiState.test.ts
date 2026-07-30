import { describe, it, expect } from 'vitest'
import { getEffectivePlanViewMode } from '../planUiState'

describe('getEffectivePlanViewMode', () => {
  it('downgrades split to the last single mode on narrow viewports', () => {
    expect(getEffectivePlanViewMode('split', true, 'source')).toBe('source')
    expect(getEffectivePlanViewMode('split', true, 'rendered')).toBe('rendered')
  })

  it('keeps split on wide viewports', () => {
    expect(getEffectivePlanViewMode('split', false, 'rendered')).toBe('split')
  })

  it('passes through non-split modes unchanged', () => {
    expect(getEffectivePlanViewMode('source', true, 'rendered')).toBe('source')
    expect(getEffectivePlanViewMode('rendered', false, 'source')).toBe('rendered')
  })
})
