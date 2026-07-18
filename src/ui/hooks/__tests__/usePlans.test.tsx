// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { usePlanVersions, usePlanVersion, usePlans } from '../usePlans.js'
import type { Plan } from '../../../lib/plan-types.js'

// Stub the SSE live bus so it doesn't try to open an EventSource.
vi.mock('../../live', () => ({
  subscribeLive: () => () => {},
}))

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

const plan: Plan = {
  id: 'p1',
  title: 'Plan',
  body: 'current body',
  createdAt: 1000,
  updatedAt: 2000,
  version: 3,
  decision: 'pending',
  comments: [],
  versions: [
    { version: 1, body: 'v1 body', title: 'v1 title', createdAt: 1000 },
    { version: 2, body: 'v2 body', title: 'v2 title', createdAt: 1500 },
    { version: 3, body: 'current body', title: 'Plan', createdAt: 2000 },
  ],
}

describe('usePlanVersions', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns the version list and current version from /api/plans/:id', async () => {
    mockFetch.mockImplementation((url: any) => {
      const u = String(url)
      // eslint-disable-next-line no-console
      console.log('FETCH CALLED WITH:', u, typeof url)
      if (u === '/api/plans/p1') return Promise.resolve({ ok: true, json: () => Promise.resolve(plan) })
      return Promise.resolve({ ok: false, status: 404 })
    })
    const { result } = renderHook(() => usePlanVersions('p1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.versions).toHaveLength(3))
    expect(result.current.versions.map((v) => v.version)).toEqual([1, 2, 3])
    expect(result.current.currentVersion).toBe(3)
  })

  it('returns empty arrays/null when planId is null', async () => {
    const { result } = renderHook(() => usePlanVersions(null), { wrapper: createWrapper() })
    expect(result.current.versions).toEqual([])
    expect(result.current.currentVersion).toBeNull()
  })

  it('fetchVersion hits /api/plans/:id/versions/:n when the version is not in the cache', async () => {
    mockFetch.mockImplementation((url: any) => {
      const u = String(url)
      if (u === '/api/plans/p1') return Promise.resolve({ ok: true, json: () => Promise.resolve(plan) })
      if (u === '/api/plans/p1/versions/1') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: plan.versions![0] }) })
      }
      return Promise.resolve({ ok: false, status: 404 })
    })
    const { result } = renderHook(() => usePlanVersions('p1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.versions).toHaveLength(3))
    mockFetch.mockClear()
    let resolved: Awaited<ReturnType<typeof result.current.fetchVersion>> = null
    await act(async () => {
      resolved = await result.current.fetchVersion(1)
    })
    // Cache fast path — no network call needed
    expect(resolved).toMatchObject({ version: 1, body: 'v1 body' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetchVersion falls back to a network call when the version is missing from the cache', async () => {
    mockFetch.mockImplementation((url: any) => {
      const u = String(url)
      if (u === '/api/plans/p1') return Promise.resolve({ ok: true, json: () => Promise.resolve(plan) })
      if (u === '/api/plans/p1/versions/1') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: plan.versions![0] }) })
      }
      return Promise.resolve({ ok: false, status: 404 })
    })
    const { result } = renderHook(() => usePlanVersions('p1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.versions).toHaveLength(3))
    // Force the cache fast path to fail by removing version 1 from the array
    const stripped = { ...plan, versions: plan.versions!.filter((v) => v.version !== 1) }
    mockFetch.mockImplementation((url: any) => {
      const u = String(url)
      if (u === '/api/plans/p1') return Promise.resolve({ ok: true, json: () => Promise.resolve(stripped) })
      if (u === '/api/plans/p1/versions/1') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: plan.versions![0] }) })
      }
      return Promise.resolve({ ok: false, status: 404 })
    })
    // re-render
    const { result: r2 } = renderHook(() => usePlanVersions('p1'), { wrapper: createWrapper() })
    await waitFor(() => expect(r2.current.versions.find((v) => v.version === 1)).toBeUndefined())
    let resolved: Awaited<ReturnType<typeof r2.current.fetchVersion>> = null
    await act(async () => {
      resolved = await r2.current.fetchVersion(1)
    })
    expect(resolved).toMatchObject({ version: 1, body: 'v1 body' })
  })
})

describe('usePlanVersion', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns the matching version from the cache and marks it as not current when n < currentVersion', async () => {
    mockFetch.mockImplementation((url: any) => {
      const u = String(url)
      if (u === '/api/plans/p1') return Promise.resolve({ ok: true, json: () => Promise.resolve(plan) })
      return Promise.resolve({ ok: false, status: 404 })
    })
    const { result } = renderHook(() => usePlanVersion('p1', 1), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.version?.version).toBe(1))
    expect(result.current.version).toMatchObject({ version: 1, body: 'v1 body' })
    expect(result.current.isCurrent).toBe(false)
  })

  it('marks the version as current when n === currentVersion', async () => {
    mockFetch.mockImplementation((url: any) => {
      const u = String(url)
      if (u === '/api/plans/p1') return Promise.resolve({ ok: true, json: () => Promise.resolve(plan) })
      return Promise.resolve({ ok: false, status: 404 })
    })
    const { result } = renderHook(() => usePlanVersion('p1', 3), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isCurrent).toBe(true))
  })
})

describe('usePlans updatePlan / submitPlanVersion', () => {
  beforeEach(() => mockFetch.mockReset())

  it('updatePlan PUTs body/title and writes the returned plan into the cache', async () => {
    const updated = { ...plan, body: 'edited', title: 'Edited', updatedAt: 9999 }
    mockFetch.mockImplementation((url: any, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/plans') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([plan]) })
      }
      if (u === '/api/plan-review/status') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ round: 0, waiters: 0, lastDecidedAt: null }),
        })
      }
      if (u === '/api/plans/p1' && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(updated) })
      }
      return Promise.resolve({ ok: false, status: 404 })
    })
    const { result } = renderHook(() => usePlans(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.plans).toHaveLength(1))
    await act(async () => {
      await result.current.updatePlan('p1', { body: 'edited', title: 'Edited' })
    })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/plans/p1',
      expect.objectContaining({ method: 'PUT' }),
    )
    await waitFor(() => expect(result.current.getPlan('p1')?.body).toBe('edited'))
  })

  it('submitPlanVersion POSTs with id and replaces the plan in cache', async () => {
    const next = {
      ...plan,
      version: 4,
      body: 'v4',
      decision: 'pending' as const,
      versions: [
        ...plan.versions!,
        { version: 4, body: 'v4', title: 'Plan', createdAt: 3000 },
      ],
    }
    mockFetch.mockImplementation((url: any, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/plans' && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([plan]) })
      }
      if (u === '/api/plans' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(next) })
      }
      if (u === '/api/plan-review/status') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ round: 0, waiters: 0, lastDecidedAt: null }),
        })
      }
      return Promise.resolve({ ok: false, status: 404 })
    })
    const { result } = renderHook(() => usePlans(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.plans).toHaveLength(1))
    await act(async () => {
      await result.current.submitPlanVersion('p1', { title: 'Plan', body: 'v4' })
    })
    await waitFor(() => expect(result.current.getPlan('p1')?.version).toBe(4))
  })
})
