import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, getDraft, setDraft } from '../drafts'

describe('drafts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns the latest body before the debounced write lands', () => {
    setDraft('typed just now', 'k1')
    expect(getDraft('k1')).toBe('typed just now')
    vi.advanceTimersByTime(600)
    expect(getDraft('k1')).toBe('typed just now')
  })

  it('does not resurrect a draft cleared while its write was pending', () => {
    setDraft('submitted body', 'k2')
    clearDraft('k2')
    vi.advanceTimersByTime(600)
    expect(getDraft('k2')).toBeNull()
  })
})
