// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeIntelTarget } from '../useCodeIntel'
import type { CodeIntelSource } from '../../../lib/code-intel-source'

const liveState = vi.hoisted(() => ({ onChange: null as (() => void) | null, listeners: new Set<() => void>() }))

vi.mock('../../live', () => ({
  subscribeLive: (event: string, callback: () => void) => {
    if (event === 'change') {
      liveState.listeners.add(callback)
      liveState.onChange = () => { for (const listener of liveState.listeners) listener() }
    }
    return () => { liveState.listeners.delete(callback) }
  },
}))

describe('useCodeIntel', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    liveState.onChange = null
    liveState.listeners.clear()
    vi.useFakeTimers()
    fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: true, extensions: ['ts'] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, op: 'hover', hover: 'test' }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('probes nothing while the setting is off', async () => {
    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: false, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)
  })

  it('reports not ready when no language server is configured', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: false, extensions: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, op: 'hover', hover: 'test' }),
      })
    })

    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.capabilities).toBeTruthy()
    expect(result.current.ready).toBe(false)
  })

  it('reports not ready when the review cannot answer', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: true, extensions: ['ts'], unavailable: 'pull-request' }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, op: 'hover', hover: 'test' }),
      })
    })

    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.capabilities).toBeTruthy()
    expect(result.current.ready).toBe(false)
  })

  it('becomes ready when configured and in scope', async () => {
    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.ready).toBe(true)
    expect(result.current.capabilities?.configured).toBe(true)
  })

  it('waits for a working draft sync before querying staged hover', async () => {
    let resolveSync!: () => void
    const sync = new Promise<void>((resolve) => { resolveSync = resolve })
    const { trackCodeIntelDocument, useCodeIntel } = await import('../useCodeIntel')
    trackCodeIntelDocument('src/a.ts', sync)
    const { result } = renderHook(() => useCodeIntel({
      enabled: true,
      staged: true,
      source: { kind: 'working' },
    }))
    await act(async () => { await vi.runAllTimersAsync() })

    const target: CodeIntelTarget = {
      path: 'src/a.ts', side: 'additions', line: 1, character: 0,
      tokenText: 'foo', anchor: document.createElement('span'),
    }
    await act(async () => {
      result.current.hoverToken(target)
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
    })
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/code-intel')).toHaveLength(0)

    await act(async () => {
      resolveSync()
      await vi.runAllTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await vi.runAllTimersAsync()
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/code-intel')).not.toHaveLength(0)
    expect(result.current.hover?.status).toBe('ready')
  })

  it.each([
    ['pending', () => new Promise<void>(() => {})],
    ['failed', () => Promise.reject(new Error('draft sync failed'))],
  ])('does not let a %s working draft sync block historical hover', async (_label, makeSync) => {
    const { trackCodeIntelDocument, useCodeIntel } = await import('../useCodeIntel')
    trackCodeIntelDocument('src/a.ts', makeSync())
    const source: CodeIntelSource = { kind: 'commit', revision: '4'.repeat(40) }
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: true, source }))
    await act(async () => { await vi.runAllTimersAsync() })
    const target: CodeIntelTarget = {
      path: 'src/a.ts', source, side: 'additions', line: 1, character: 0,
      tokenText: 'foo', anchor: document.createElement('span'),
    }
    await act(async () => {
      result.current.hoverToken(target)
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await vi.runAllTimersAsync()
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/code-intel')).not.toHaveLength(0)
    expect(result.current.hover?.status).toBe('ready')
  })

  it('shows unavailable and avoids an LSP query when working draft sync fails', async () => {
    const { trackCodeIntelDocument, useCodeIntel } = await import('../useCodeIntel')
    trackCodeIntelDocument('src/a.ts', Promise.reject(new Error('draft sync failed')))
    const { result } = renderHook(() => useCodeIntel({
      enabled: true,
      staged: true,
      source: { kind: 'working' },
    }))
    await act(async () => { await vi.runAllTimersAsync() })
    const target: CodeIntelTarget = {
      path: 'src/a.ts', side: 'additions', line: 1, character: 0,
      tokenText: 'foo', anchor: document.createElement('span'),
    }
    await act(async () => {
      result.current.hoverToken(target)
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await vi.runAllTimersAsync()
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/code-intel')).toHaveLength(0)
    expect(result.current.hover).toMatchObject({ status: 'unavailable' })
  })

  it('requests no hover until the debounce elapses', async () => {
    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.ready).toBe(true)

    const target: CodeIntelTarget = {
      path: 'src/a.ts',
      side: 'additions',
      line: 7,
      character: 2,
      tokenText: 'foo',
      anchor: document.createElement('span'),
    }

    await act(async () => {
      result.current.hoverToken(target)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1) // only capabilities
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/code-intel'),
      expect.any(Object),
    )

    await act(async () => {
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/code-intel',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('publishes valid hover markdown before optional details resolve', async () => {
    let resolveHover!: (value: Response) => void
    const hover = new Promise<Response>((resolve) => {
      resolveHover = resolve
    })
    let resolveSignature!: (value: Response) => void
    let resolveHighlights!: (value: Response) => void
    const signature = new Promise<Response>((resolve) => {
      resolveSignature = resolve
    })
    const highlights = new Promise<Response>((resolve) => {
      resolveHighlights = resolve
    })
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: true, extensions: ['ts'] }),
        })
      }
      const body = JSON.parse(String(init?.body)) as { op?: string }
      if (body.op === 'signature') return signature
      if (body.op === 'highlights') return highlights
      return hover
    })

    const hoverResponse = {
        ok: true,
        json: () => Promise.resolve({ available: true, op: 'hover', hover: '**docs**' }),
    } as Response

    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const target: CodeIntelTarget = {
      path: 'src/a.ts',
      side: 'additions',
      line: 7,
      character: 2,
      tokenText: 'foo',
      anchor: document.createElement('span'),
    }
    await act(async () => {
      result.current.hoverToken(target)
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
    })
    resolveHover(hoverResponse)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.hover).toMatchObject({
      status: 'ready',
      markdown: '**docs**',
    })

    resolveSignature({
      ok: true,
      json: () => Promise.resolve({ available: true, op: 'signature', signatures: [] }),
    } as Response)
    resolveHighlights({
      ok: true,
      json: () => Promise.resolve({ available: true, op: 'highlights', highlights: [] }),
    } as Response)
    await act(async () => {
      await vi.runAllTimersAsync()
    })
  })

  it('refreshes capabilities after a live change for an already mounted hook', async () => {
    let capabilityVersion = 1
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            configured: true,
            extensions: capabilityVersion === 1 ? ['ts'] : ['ts', 'tsx'],
          }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ available: true, op: 'hover', hover: 'test' }) })
    })

    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.capabilities?.extensions).toEqual(['ts'])

    capabilityVersion = 2
    expect(liveState.onChange).toBeTypeOf('function')
    await act(async () => {
      liveState.onChange?.()
      await vi.runAllTimersAsync()
    })

    expect(result.current.capabilities?.extensions).toEqual(['ts', 'tsx'])
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/capabilities'))).toHaveLength(2)
  })

  it('does not reuse stale answers after a document-change event', async () => {
    let hoverVersion = 1
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: true, extensions: ['ts'] }),
        })
      }
      const body = JSON.parse(String(init?.body)) as { op?: string }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, op: body.op, hover: `hover-${hoverVersion}`, signatures: [], highlights: [] }),
      })
    })

    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const target: CodeIntelTarget = {
      path: 'src/a.ts',
      side: 'additions',
      line: 7,
      character: 2,
      tokenText: 'foo',
      anchor: document.createElement('span'),
    }
    const requestHover = async () => {
      result.current.hoverToken(target)
      await vi.advanceTimersByTimeAsync(250)
      await vi.runAllTimersAsync()
    }

    await act(requestHover)
    expect(result.current.hover?.markdown).toBe('hover-1')
    hoverVersion = 2
    await act(async () => {
      window.dispatchEvent(new CustomEvent('diffing-code-intel-document-change', {
        detail: { path: 'src/a.ts', version: 2 },
      }))
      result.current.clearHover()
      vi.advanceTimersByTime(150)
      await vi.runAllTimersAsync()
    })
    await act(requestHover)

    expect(result.current.hover?.markdown).toBe('hover-2')
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/code-intel')).toHaveLength(6)
  })

  it('coalesces a pointer sweep into one request', async () => {
    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.ready).toBe(true)

    const target1: CodeIntelTarget = {
      path: 'src/a.ts',
      side: 'additions',
      line: 7,
      character: 2,
      tokenText: 'foo',
      anchor: document.createElement('span'),
    }

    const target2: CodeIntelTarget = {
      ...target1,
      line: 8,
    }

    const target3: CodeIntelTarget = {
      ...target1,
      line: 9,
    }

    await act(async () => {
      result.current.hoverToken(target1)
      vi.advanceTimersByTime(50)
      result.current.hoverToken(target2)
      vi.advanceTimersByTime(50)
      result.current.hoverToken(target3)
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
    })

    const hoverPosts = fetchMock.mock.calls.filter((call) => {
      if (call[0] !== '/api/code-intel') return false
      const body = JSON.parse(String((call[1] as RequestInit).body)) as { op?: string }
      return body.op === 'hover'
    })
    expect(hoverPosts).toHaveLength(1)
  })

  it('asks nothing for a file with unsaved edits', async () => {
    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() =>
      useCodeIntel({
        enabled: true,
        staged: false,
        isDirty: () => true,
      }),
    )

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.ready).toBe(true)

    const target: CodeIntelTarget = {
      path: 'src/a.ts',
      side: 'additions',
      line: 7,
      character: 2,
      tokenText: 'foo',
      anchor: document.createElement('span'),
    }

    await act(async () => {
      result.current.hoverToken(target)
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
    })

    const postCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/code-intel')
    expect(postCalls).toHaveLength(0)
  })

  it('serves a repeated position from cache', async () => {
    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.ready).toBe(true)

    const target: CodeIntelTarget = {
      path: 'src/a.ts',
      side: 'additions',
      line: 7,
      character: 2,
      tokenText: 'foo',
      anchor: document.createElement('span'),
    }

    await act(async () => {
      result.current.hoverToken(target)
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
    })

    expect(result.current.hover).toBeTruthy()

    await act(async () => {
      result.current.clearHover()
      vi.advanceTimersByTime(200)
    })

    await act(async () => {
      result.current.hoverToken(target)
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
    })

    const hoverPosts = fetchMock.mock.calls.filter((call) => {
      if (call[0] !== '/api/code-intel') return false
      const body = JSON.parse(String((call[1] as RequestInit).body)) as { op?: string }
      return body.op === 'hover'
    })
    expect(hoverPosts).toHaveLength(1)
  })

  it('surfaces an explicit refusal rather than an empty hover', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: true, extensions: ['ts'] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: false, reason: 'unsupported-language' }),
      })
    })

    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.ready).toBe(true)

    const target: CodeIntelTarget = {
      path: 'src/a.ts',
      side: 'additions',
      line: 7,
      character: 2,
      tokenText: 'foo',
      anchor: document.createElement('span'),
    }

    await act(async () => {
      result.current.hoverToken(target)
      vi.advanceTimersByTime(250)
      await vi.runAllTimersAsync()
    })

    expect(result.current.hover?.status).toBe('unavailable')
    expect(result.current.hover?.reason).toBe('unsupported-language')
  })

  it('returns definition locations', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: true, extensions: ['ts'] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          available: true,
          op: 'definition',
          locations: [{ path: 'src/b.ts', line: 3, character: 0, endLine: 3, endCharacter: 4, inRepository: true }],
        }),
      })
    })

    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.ready).toBe(true)

    const target: CodeIntelTarget = {
      path: 'src/a.ts',
      side: 'additions',
      line: 7,
      character: 2,
      tokenText: 'foo',
      anchor: document.createElement('span'),
    }

    const locations = await act(async () => {
      const result2 = await result.current.resolveDefinition(target)
      await vi.runAllTimersAsync()
      return result2
    })

    expect(locations).toEqual([{ path: 'src/b.ts', line: 3, character: 0, endLine: 3, endCharacter: 4, inRepository: true }])
  })

  it('returns rename edits for the open file', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: true, extensions: ['ts'] }),
        })
      }
      const body = JSON.parse(String(init?.body)) as { op?: string }
      if (body.op === 'rename') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              available: true,
              op: 'rename',
              edits: {
                edits: [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 3 },
                    },
                    newText: 'bar',
                  },
                ],
                otherEdits: 0,
                otherFiles: 0,
              },
            }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, op: 'hover', hover: 'test' }),
      })
    })

    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const edits = await result.current.renameAt('src/a.ts', 1, 0, 'bar')
    expect(edits).toEqual({
      edits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          newText: 'bar',
        },
      ],
      otherEdits: 0,
      otherFiles: 0,
    })
  })

  it('returns a multi-file rename without applying it', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/capabilities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: true, extensions: ['ts'] }),
        })
      }
      const body = JSON.parse(String(init?.body)) as { op?: string }
      if (body.op === 'rename') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              available: true,
              op: 'rename',
              edits: { edits: [], otherEdits: 12, otherFiles: 4 },
            }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, op: 'hover', hover: 'test' }),
      })
    })

    const { useCodeIntel } = await import('../useCodeIntel')
    const { result } = renderHook(() => useCodeIntel({ enabled: true, staged: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const edits = await result.current.renameAt('src/a.ts', 1, 0, 'bar')
    expect(edits).toEqual({ edits: [], otherEdits: 12, otherFiles: 4 })
  })
})
