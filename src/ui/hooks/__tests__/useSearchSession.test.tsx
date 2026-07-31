// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSearchSession } from '../useSearchSession'

vi.mock('../../utils', () => ({
  scrollToLine: vi.fn(),
}))

describe('useSearchSession', () => {
  const navContext = {
    diffFileSet: new Set(['src/a.ts']),
    changedKeys: new Set(['src/a.ts:10']),
    customMode: false,
    staged: false,
  }

  it('flashes status when cycling with no active session', () => {
    const onNavigateFile = vi.fn()
    const { result } = renderHook(() => useSearchSession(navContext, onNavigateFile))

    act(() => {
      result.current.nextHit()
    })

    expect(result.current.statusMessage).toBe('no active search results')
    expect(onNavigateFile).not.toHaveBeenCalled()
  })

  it('cycles hits after a snapshot is set', () => {
    const onNavigateFile = vi.fn()
    const { result } = renderHook(() => useSearchSession(navContext, onNavigateFile))

    act(() => {
      result.current.setSnapshot({
        hits: [{ kind: 'file', path: 'src/a.ts' }],
        index: 0,
        query: 'a',
      })
    })

    act(() => {
      result.current.nextHit()
    })

    expect(onNavigateFile).toHaveBeenCalledWith('src/a.ts')
    expect(result.current.session?.index).toBe(0)
  })
})
