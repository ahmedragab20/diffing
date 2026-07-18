import { describe, expect, it } from 'vitest'
import { checksRefreshInterval, type PrCheck } from '../PrChecksPopover'

describe('GitHub checks live refresh cadence', () => {
  it('polls frequently while a workflow is pending', () => {
    const checks: PrCheck[] = [
      { name: 'build', state: 'success' },
      { name: 'integration', state: 'pending' },
    ]
    expect(checksRefreshInterval(checks)).toBe(8_000)
  })

  it('backs off after every workflow reaches a terminal state', () => {
    const checks: PrCheck[] = [
      { name: 'build', state: 'success' },
      { name: 'integration', state: 'failure' },
    ]
    expect(checksRefreshInterval(checks)).toBe(30_000)
  })
})
