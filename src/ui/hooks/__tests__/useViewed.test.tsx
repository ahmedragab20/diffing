import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useViewed } from '../useViewed.js'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useViewed', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('loads viewed files on mount', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/viewed') {
        return Promise.resolve(new Response(JSON.stringify(['src/index.ts', 'src/app.ts'])))
      }
      return Promise.resolve(new Response(JSON.stringify([])))
    })

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.viewedFiles.size).toBe(2)
    })

    expect(result.current.viewedFiles.has('src/index.ts')).toBe(true)
    expect(result.current.viewedFiles.has('src/app.ts')).toBe(true)
  })

  it('starts with empty set when no files viewed', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify([]))))

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.viewedFiles.size).toBe(0)
    })
  })

  it('setViewed marks a file as viewed (optimistic + PUT)', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/viewed' && options?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true })))
      }
      return Promise.resolve(new Response(JSON.stringify([])))
    })

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.viewedFiles.size).toBe(0))

    await act(async () => {
      expect(await result.current.setViewed('src/index.ts', true)).toBe(true)
    })

    expect(result.current.viewedFiles.has('src/index.ts')).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('/api/viewed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'src/index.ts', viewed: true }),
    })
  })

  it('setViewed removes a file from viewed set (optimistic + PUT)', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/viewed' && options?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true })))
      }
      return Promise.resolve(new Response(JSON.stringify(['src/index.ts'])))
    })

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.viewedFiles.has('src/index.ts')).toBe(true))

    await act(async () => {
      expect(await result.current.setViewed('src/index.ts', false)).toBe(true)
    })

    await waitFor(() => {
      expect(result.current.viewedFiles.has('src/index.ts')).toBe(false)
    })
    expect(mockFetch).toHaveBeenCalledWith('/api/viewed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'src/index.ts', viewed: false }),
    })
  })

  it('setViewed does not duplicate on re-adding', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/viewed' && options?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true })))
      }
      return Promise.resolve(new Response(JSON.stringify([])))
    })

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.viewedFiles.size).toBe(0))

    await act(async () => {
      expect(await result.current.setViewed('src/index.ts', true)).toBe(true)
    })
    await act(async () => {
      expect(await result.current.setViewed('src/index.ts', true)).toBe(true)
    })

    expect(result.current.viewedFiles.size).toBe(1)
  })
  it.each([
    { name: 'HTTP failure', body: { error: 'Unavailable' }, status: 500 },
    { name: 'malformed viewed array', body: ['src/index.ts', 42], status: 200 },
    { name: 'non-array payload', body: { viewed: [] }, status: 200 },
  ])('exposes $name without accepting an unsafe viewed set', async ({ body, status }) => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })))
    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.viewedFiles.size).toBe(0)
  })

  it.each(['HTTP', 'network'] as const)('rolls back only the failed file after a %s write failure', async (failure) => {
    let resolveFailed!: (response: Response) => void
    let rejectFailed!: (error: Error) => void
    const failedWrite = new Promise<Response>((resolve, reject) => {
      resolveFailed = resolve
      rejectFailed = reject
    })
    mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        const { filePath } = JSON.parse(String(options.body)) as { filePath: string }
        if (filePath === 'src/failed.ts') return failedWrite
        return Promise.resolve(new Response(JSON.stringify({ ok: true })))
      }
      return Promise.resolve(new Response(JSON.stringify(['src/already.ts'])))
    })
    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.viewedFiles.has('src/already.ts')).toBe(true))
    let mutation!: Promise<boolean>
    act(() => { mutation = result.current.setViewed('src/failed.ts', true) })
    expect(result.current.viewedFiles.has('src/failed.ts')).toBe(true)
    await act(async () => {
      expect(await result.current.setViewed('src/success.ts', true)).toBe(true)
    })
    await act(async () => {
      if (failure === 'HTTP') resolveFailed(new Response(JSON.stringify({ error: 'Write failed' }), { status: 500 }))
      else rejectFailed(new Error('Network unavailable'))
      expect(await mutation).toBe(false)
    })
    expect(result.current.error).toBeTruthy()
    expect(result.current.viewedFiles.has('src/failed.ts')).toBe(false)
    expect(result.current.viewedFiles.has('src/already.ts')).toBe(true)
    expect(result.current.viewedFiles.has('src/success.ts')).toBe(true)
  })

  it('cancels a pending viewed read so its stale response cannot undo a successful write', async () => {
    let resolveRead!: (response: Response) => void
    const pendingRead = new Promise<Response>((resolve) => { resolveRead = resolve })
    let readSignal: AbortSignal | null | undefined
    mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') return Promise.resolve(new Response(JSON.stringify({ ok: true })))
      readSignal = options?.signal
      // Intentionally ignore abort: cancellation must still prevent stale cache writes.
      return pendingRead
    })
    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(readSignal).toBeInstanceOf(AbortSignal)
    await act(async () => {
      expect(await result.current.setViewed('src/index.ts', true)).toBe(true)
    })
    expect(readSignal?.aborted).toBe(true)
    const staleResponse = new Response(JSON.stringify([]))
    const staleJson = vi.spyOn(staleResponse, 'json')
    await act(async () => {
      resolveRead(staleResponse)
      await pendingRead
    })
    await waitFor(() => expect(staleJson).toHaveBeenCalledOnce())
    expect(result.current.viewedFiles.has('src/index.ts')).toBe(true)
  })

  it('serializes rapid toggles of one file and preserves the later intent after an earlier failure', async () => {
    let resolveFirst!: (response: Response) => void
    let resolveSecond!: (response: Response) => void
    const firstWrite = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const secondWrite = new Promise<Response>((resolve) => { resolveSecond = resolve })
    const writes: boolean[] = []
    mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method !== 'PUT') return Promise.resolve(new Response(JSON.stringify(['src/already.ts'])))
      const body = JSON.parse(String(options.body)) as { viewed: boolean }
      writes.push(body.viewed)
      return writes.length === 1 ? firstWrite : secondWrite
    })
    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.viewedFiles.has('src/already.ts')).toBe(true))
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.setViewed('src/index.ts', true)
      second = result.current.setViewed('src/index.ts', false)
    })
    await waitFor(() => expect(writes).toEqual([true]))
    expect(result.current.viewedFiles.has('src/index.ts')).toBe(false)
    await act(async () => {
      resolveFirst(new Response('Write failed', { status: 500 }))
      expect(await first).toBe(false)
    })
    await waitFor(() => expect(writes).toEqual([true, false]))
    expect(result.current.viewedFiles.has('src/index.ts')).toBe(false)
    await act(async () => {
      resolveSecond(new Response(JSON.stringify({ ok: true })))
      expect(await second).toBe(true)
    })
    expect(result.current.viewedFiles.has('src/index.ts')).toBe(false)
    expect(result.current.viewedFiles.has('src/already.ts')).toBe(true)
  })

})
