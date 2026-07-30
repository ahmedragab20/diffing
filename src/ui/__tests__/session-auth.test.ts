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

  it('resolves token from URL and persists to sessionStorage', async () => {
    window.history.replaceState(null, '', '/?token=url-token')
    const mod = await import('../session-auth')
    mod.installSessionAuth()
    expect(sessionStorage.getItem('diffing-session-token')).toBe('url-token')
    expect(mod.sessionTokenQuerySuffix()).toBe('?token=url-token')
  })

  it('falls back to sessionStorage when URL has no token', async () => {
    sessionStorage.setItem('diffing-session-token', 'stored-token')
    window.history.replaceState(null, '', '/plan/foo')
    const mod = await import('../session-auth')
    mod.installSessionAuth()
    expect(mod.liveEventSourceUrl()).toBe('/api/live?token=stored-token')
  })

  it('withSessionTokenPath appends token to route paths', async () => {
    window.__DIFFING_SESSION_TOKEN__ = 'injected'
    const mod = await import('../session-auth')
    mod.installSessionAuth()
    expect(mod.withSessionTokenPath('/plan/abc')).toBe('/plan/abc?token=injected')
    expect(mod.withSessionTokenPath('/plan/abc?token=existing')).toBe('/plan/abc?token=existing')
  })
})
