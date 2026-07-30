// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('session-auth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    sessionStorage.clear()
    delete window.__DIFFING_SESSION_TOKEN__
    window.history.replaceState(null, '', '/')
    vi.resetModules()
  })

  it('migrates legacy ?token= from the URL into sessionStorage and strips the bar', async () => {
    window.history.replaceState(null, '', '/?token=url-token')
    const mod = await import('../session-auth')
    mod.installSessionAuth()
    expect(sessionStorage.getItem('diffing-session-token')).toBe('url-token')
    expect(window.location.pathname + window.location.search).toBe('/')
    expect(mod.sessionTokenQuerySuffix()).toBe('')
  })

  it('falls back to sessionStorage when URL has no token', async () => {
    sessionStorage.setItem('diffing-session-token', 'stored-token')
    window.history.replaceState(null, '', '/plan/foo')
    const mod = await import('../session-auth')
    mod.installSessionAuth()
    expect(mod.liveEventSourceUrl()).toBe('/api/live')
  })

  it('withSessionTokenPath does not add token query params', async () => {
    window.__DIFFING_SESSION_TOKEN__ = 'injected'
    const mod = await import('../session-auth')
    mod.installSessionAuth()
    expect(mod.withSessionTokenPath('/plan/abc')).toBe('/plan/abc')
    expect(mod.withSessionTokenPath('/plan/abc?token=existing')).toBe('/plan/abc')
    expect(mod.withSessionTokenPath('/plan/abc?foo=bar&token=existing')).toBe('/plan/abc?foo=bar')
  })

  it('patches fetch with x-diffing-token header for /api routes', async () => {
    window.__DIFFING_SESSION_TOKEN__ = 'header-token'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const mod = await import('../session-auth')
    mod.installSessionAuth()
    await window.fetch('/api/ping')
    expect(fetchMock).toHaveBeenCalledOnce()
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init?.headers).get('x-diffing-token')).toBe('header-token')
  })
})
