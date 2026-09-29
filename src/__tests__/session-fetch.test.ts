// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSessionApi, sessionApiOrigin } from '../lib/session-fetch.js'

afterEach(() => vi.unstubAllGlobals())

describe('session API transport', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])('keeps credentials on %s and refuses redirects', async (host) => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const headers = new Headers({ 'x-diffing-token': 'test-token' })
    await fetchSessionApi(`http://${host}:1234/api/comments`, { headers, redirect: 'follow' })
    expect(fetch).toHaveBeenCalledWith(`http://${host}:1234/api/comments`, { headers, redirect: 'error' })
  })

  it.each(['https://localhost/api', 'http://example.com/api', 'http://localhost.example.com/api', 'http://user:pass@localhost/api'])('rejects %s before sending credentials', (url) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(() => fetchSessionApi(url)).toThrow('Refusing non-loopback')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('formats IPv6 loopback and redirects wildcard bindings to loopback', () => {
    expect(sessionApiOrigin('::1', 1234)).toBe('http://[::1]:1234')
    expect(sessionApiOrigin('::', 1234)).toBe('http://127.0.0.1:1234')
    expect(sessionApiOrigin('0.0.0.0', 1234)).toBe('http://127.0.0.1:1234')
  })
})
