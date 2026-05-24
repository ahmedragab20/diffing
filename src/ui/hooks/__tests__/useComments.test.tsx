import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useComments } from '../useComments.js'
import type { ReviewComment } from '../../../types.js'

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

const sampleComments: ReviewComment[] = [
  {
    id: 'c1',
    filePath: 'src/index.ts',
    side: 'additions',
    lineNumber: 10,
    lineContent: 'const x = 1',
    body: 'Consider renaming',
    status: 'open',
    createdAt: 1000,
    replies: [],
  },
  {
    id: 'c2',
    filePath: 'src/app.ts',
    side: 'deletions',
    lineNumber: 5,
    lineContent: 'oldCode()',
    body: 'Remove this',
    status: 'open',
    createdAt: 2000,
    replies: [{ id: 'r1', body: 'Done', createdAt: 3000 }],
  },
]

function mockApi() {
  mockFetch.mockImplementation((url: string, options?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString()
    if (urlStr === '/api/comments' && (!options || options.method === 'GET' || !options.method)) {
      return Promise.resolve({ json: () => Promise.resolve(sampleComments) })
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) })
  })
}

describe('useComments', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('loads comments on mount', async () => {
    mockApi()
    const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.comments).toHaveLength(2)
    })

    expect(result.current.comments).toEqual(sampleComments)
  })

  it('adds a comment via mutation', async () => {
    const newComment: ReviewComment = {
      id: 'c3',
      filePath: 'src/index.ts',
      side: 'additions',
      lineNumber: 15,
      lineContent: 'newFn()',
      body: 'Nice addition',
      status: 'open',
      createdAt: 4000,
      replies: [],
    }

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr === '/api/comments' && options?.method === 'POST') {
        return Promise.resolve({ json: () => Promise.resolve(newComment) })
      }
      return Promise.resolve({ json: () => Promise.resolve([]) })
    })

    const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.comments).toEqual([]))

    await act(async () => {
      result.current.addComment('src/index.ts', 'additions', 15, 'newFn()', 'Nice addition')
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: 'src/index.ts',
        side: 'additions',
        lineNumber: 15,
        lineContent: 'newFn()',
        body: 'Nice addition',
      }),
    })

    await waitFor(() => {
      expect(result.current.comments).toHaveLength(1)
    })
  })

  it('removes a comment via mutation', async () => {
    mockApi()
    const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.comments).toHaveLength(2))

    await act(async () => {
      result.current.removeComment('c1')
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/comments/c1', { method: 'DELETE' })
  })

  it('edits a comment via mutation', async () => {
    const updatedComment: ReviewComment = { ...sampleComments[0], body: 'Updated body' }

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.startsWith('/api/comments/') && options?.method === 'PUT') {
        return Promise.resolve({ json: () => Promise.resolve(updatedComment) })
      }
      return Promise.resolve({ json: () => Promise.resolve(sampleComments) })
    })

    const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.comments).toHaveLength(2))

    await act(async () => {
      result.current.editComment('c1', 'Updated body')
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/comments/c1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Updated body' }),
    })
  })

  it('resolves a comment via mutation', async () => {
    const resolvedComment: ReviewComment = { ...sampleComments[0], status: 'resolved' }

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.startsWith('/api/comments/') && options?.method === 'PUT') {
        return Promise.resolve({ json: () => Promise.resolve(resolvedComment) })
      }
      return Promise.resolve({ json: () => Promise.resolve(sampleComments) })
    })

    const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.comments).toHaveLength(2))

    await act(async () => {
      result.current.resolveComment('c1')
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/comments/c1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    })
  })

  describe('getAnnotationsForFile', () => {
    it('returns annotations for a specific file', async () => {
      mockApi()
      const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })
      await waitFor(() => expect(result.current.comments).toHaveLength(2))

      const annotations = result.current.getAnnotationsForFile('src/index.ts')
      expect(annotations).toHaveLength(1)
      expect(annotations[0]).toEqual({
        side: 'additions',
        lineNumber: 10,
        metadata: sampleComments[0],
      })
    })

    it('returns empty array for file with no comments', async () => {
      mockApi()
      const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })
      await waitFor(() => expect(result.current.comments).toHaveLength(2))

      const annotations = result.current.getAnnotationsForFile('src/other.ts')
      expect(annotations).toEqual([])
    })
  })

  describe('formatAllComments', () => {
    it('returns empty string when no comments', async () => {
      mockFetch.mockResolvedValue({ json: () => Promise.resolve([]) })

      const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })
      await waitFor(() => expect(result.current.comments).toEqual([]))

      expect(result.current.formatAllComments()).toBe('')
    })

    it('formats comments as XML', async () => {
      mockApi()
      const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })
      await waitFor(() => expect(result.current.comments).toHaveLength(2))

      const formatted = result.current.formatAllComments()
      expect(formatted).toContain('<code-review-comments>')
      expect(formatted).toContain('</code-review-comments>')
      expect(formatted).toContain('<file path="src/index.ts">')
      expect(formatted).toContain('<comment line="10">')
      expect(formatted).toContain('<code>+ const x = 1</code>')
      expect(formatted).toContain('<file path="src/app.ts">')
      expect(formatted).toContain('<code>- oldCode()</code>')
    })
  })

  describe('copyAllComments', () => {
    it('copies formatted comments to clipboard', async () => {
      const writeText = vi.fn()
      Object.assign(navigator, { clipboard: { writeText } })

      mockApi()
      const { result } = renderHook(() => useComments(), { wrapper: createWrapper() })
      await waitFor(() => expect(result.current.comments).toHaveLength(2))

      await act(async () => {
        await result.current.copyAllComments()
      })

      expect(writeText).toHaveBeenCalledWith(result.current.formatAllComments())
    })
  })
})
