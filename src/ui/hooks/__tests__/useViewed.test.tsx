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
        return Promise.resolve({ json: () => Promise.resolve(['src/index.ts', 'src/app.ts']) })
      }
      return Promise.resolve({ json: () => Promise.resolve([]) })
    })

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.viewedFiles.size).toBe(2)
    })

    expect(result.current.viewedFiles.has('src/index.ts')).toBe(true)
    expect(result.current.viewedFiles.has('src/app.ts')).toBe(true)
  })

  it('starts with empty set when no files viewed', async () => {
    mockFetch.mockResolvedValue({ json: () => Promise.resolve([]) })

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.viewedFiles.size).toBe(0)
    })
  })

  it('setViewed marks a file as viewed (optimistic + PUT)', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/viewed' && options?.method === 'PUT') {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true }) })
      }
      return Promise.resolve({ json: () => Promise.resolve([]) })
    })

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.viewedFiles.size).toBe(0))

    await act(async () => {
      await result.current.setViewed('src/index.ts', true)
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
        return Promise.resolve({ json: () => Promise.resolve({ ok: true }) })
      }
      return Promise.resolve({ json: () => Promise.resolve(['src/index.ts']) })
    })

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.viewedFiles.has('src/index.ts')).toBe(true))

    await act(async () => {
      await result.current.setViewed('src/index.ts', false)
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
        return Promise.resolve({ json: () => Promise.resolve({ ok: true }) })
      }
      return Promise.resolve({ json: () => Promise.resolve([]) })
    })

    const { result } = renderHook(() => useViewed(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.viewedFiles.size).toBe(0))

    await act(async () => {
      await result.current.setViewed('src/index.ts', true)
    })
    await act(async () => {
      await result.current.setViewed('src/index.ts', true)
    })

    expect(result.current.viewedFiles.size).toBe(1)
  })
})
