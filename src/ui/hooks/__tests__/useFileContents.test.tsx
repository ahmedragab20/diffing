// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFileContents } from '../useFileContents'

describe('useFileContents', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests a renamed file from its old path on the deletion side', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: 'old', missing: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: 'new', missing: false })))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useFileContents('src/New.vue', true, 'src/Old.vue'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.oldContent).toBe('old')
    expect(result.current.newContent).toBe('new')
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/file-text?path=src%2FOld.vue&version=old',
      { signal: expect.any(AbortSignal) },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/file-text?path=src%2FNew.vue&version=new',
      { signal: expect.any(AbortSignal) },
    )
  })

  it.each(['disable', 'unmount'] as const)('aborts both outstanding file reads on %s', (operation) => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useFileContents('src/example.ts', enabled),
      { initialProps: { enabled: true } },
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const signals = fetchMock.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1]?.signal)
    expect(signals).toEqual([expect.any(AbortSignal), expect.any(AbortSignal)])
    expect(signals.every((signal) => !signal?.aborted)).toBe(true)
    if (operation === 'disable') rerender({ enabled: false })
    else unmount()
    expect(signals.every((signal) => signal?.aborted)).toBe(true)
  })
})
