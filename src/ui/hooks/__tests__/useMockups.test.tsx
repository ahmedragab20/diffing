// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, Set<(data: string) => void>>() }))
vi.mock('../../live', () => ({
  subscribeLive: (event: string, handler: (data: string) => void) => {
    const listeners = handlers.get(event) ?? new Set<(data: string) => void>()
    handlers.set(event, listeners)
    listeners.add(handler)
    return () => listeners.delete(handler)
  },
}))

import { useComments } from '../useComments'
import { usePlans } from '../usePlans'
import { useMockups } from '../useMockups'

const mockFetch = vi.fn()

beforeEach(() => {
  handlers.clear()
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})
afterEach(() => vi.unstubAllGlobals())

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('handoff status recovery', () => {
  it.each([
    { name: 'comments', hook: useComments, endpoint: '/api/review/status', event: 'agent-status' },
    { name: 'plans', hook: usePlans, endpoint: '/api/plan-review/status', event: 'plan-review-status' },
    { name: 'mockups', hook: () => useMockups(null), endpoint: '/api/mockup-review/status', event: 'mockup-review-status' },
  ])('$name refreshes on reconnect and preserves newer live status over a stale HTTP response', async ({ hook, endpoint, event }) => {
    let resolvePending!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { resolvePending = resolve })
    let pendingSignal: AbortSignal | null | undefined
    let statusReads = 0
    const status = (waiters: number) => ({ round: 1, waiters, lastSentAt: null, lastDecidedAt: null })
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url !== endpoint) return Promise.resolve(new Response(JSON.stringify([])))
      statusReads++
      if (statusReads <= 2) return Promise.resolve(new Response(JSON.stringify(status(statusReads === 1 ? 1 : 0))))
      pendingSignal = options?.signal
      // Ignore cancellation at the HTTP boundary to prove the state guard too.
      return pending
    })
    const { result, unmount } = renderHook(() => hook(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.agentWaiting).toBe(true))
    act(() => { for (const listener of handlers.get('reconnect') ?? []) listener('') })
    await waitFor(() => expect(result.current.agentWaiting).toBe(false))
    expect(statusReads).toBe(2)
    act(() => { for (const listener of handlers.get('reconnect') ?? []) listener('') })
    expect(statusReads).toBe(3)
    expect(pendingSignal?.aborted).toBe(false)
    act(() => { for (const listener of handlers.get(event) ?? []) listener(JSON.stringify(status(1))) })
    expect(result.current.agentWaiting).toBe(true)
    expect(pendingSignal?.aborted).toBe(true)
    const staleResponse = new Response(JSON.stringify(status(0)))
    const staleJson = vi.spyOn(staleResponse, 'json')
    await act(async () => { resolvePending(staleResponse); await pending })
    await waitFor(() => expect(staleJson).toHaveBeenCalledOnce())
    expect(result.current.agentWaiting).toBe(true)
    unmount()
    expect(handlers.get('reconnect')?.size).toBe(0)
    expect(handlers.get(event)?.size).toBe(0)
  })
})
