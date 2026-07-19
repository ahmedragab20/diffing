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
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/file-text?path=src%2FNew.vue&version=new',
    )
  })
})
