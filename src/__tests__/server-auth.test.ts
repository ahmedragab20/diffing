// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import {
  SESSION_TOKEN_HEADER,
  SESSION_TOKEN_QUERY,
  createServerAuthMiddleware,
  injectSessionTokenIntoHtml,
  isAllowedRequestHost,
  isLoopbackHost,
} from '../lib/server-auth.js'
import { appendSessionToken, joinSessionApiUrl, reviewSessionUrl } from '../lib/session-url.js'
import type { ServerLock } from '../lib/server-lock.js'

describe('server-auth', () => {
  it('recognises loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('192.168.1.1')).toBe(false)
  })

  it('rejects non-loopback Host headers on loopback binds', () => {
    expect(isAllowedRequestHost('evil.test', '127.0.0.1')).toBe(false)
    expect(isAllowedRequestHost('127.0.0.1:8080', '127.0.0.1')).toBe(true)
  })

  it('requires a matching token on /api routes when configured', async () => {
    const app = new Hono()
    app.use('*', createServerAuthMiddleware({
      bindHost: '127.0.0.1',
      authToken: 'secret-token',
    }))
    app.get('/api/ping', (c) => c.json({ ok: true }))
    app.get('/index.html', (c) => c.text('ok'))

    expect((await app.fetch(new Request('http://127.0.0.1/api/ping'))).status).toBe(401)
    expect((await app.fetch(new Request(`http://127.0.0.1/api/ping?${SESSION_TOKEN_QUERY}=secret-token`))).status).toBe(200)
    const withHeader = new Request('http://127.0.0.1/api/ping')
    withHeader.headers.set(SESSION_TOKEN_HEADER, 'secret-token')
    expect((await app.fetch(withHeader)).status).toBe(200)
    expect((await app.fetch(new Request('http://127.0.0.1/index.html'))).status).toBe(200)
  })
})

describe('injectSessionTokenIntoHtml', () => {
  it('injects a global token script before </head>', () => {
    const html = '<html><head><title>x</title></head><body></body></html>'
    const out = injectSessionTokenIntoHtml(html, 'abc"123\\token')
    expect(out).toContain('window.__DIFFING_SESSION_TOKEN__="abc\\"123\\\\token"')
    expect(out.indexOf('<script>window.__DIFFING_SESSION_TOKEN__')).toBeLessThan(out.indexOf('</head>'))
  })

  it('returns html unchanged when no token is configured', () => {
    const html = '<html><head></head></html>'
    expect(injectSessionTokenIntoHtml(html, null)).toBe(html)
  })
})

describe('session-url', () => {
  it('appends auth tokens to review URLs', () => {
    const lock: ServerLock = {
      port: 4321,
      host: '127.0.0.1',
      pid: 1,
      repoRoot: '/repo',
      startedAt: 1,
      version: 'test',
      authToken: 'abc123',
    }
    expect(reviewSessionUrl(lock)).toBe('http://127.0.0.1:4321/?token=abc123')
    expect(appendSessionToken('http://127.0.0.1:4321/gh/pr', 'abc123'))
      .toBe('http://127.0.0.1:4321/gh/pr?token=abc123')
  })

  it('joins API paths without inserting path after query params', () => {
    expect(joinSessionApiUrl('http://127.0.0.1:4321/?token=abc123', '/api/ping'))
      .toBe('http://127.0.0.1:4321/api/ping')
    expect(joinSessionApiUrl('http://127.0.0.1:4321/gh/pr?token=abc123', '/api/diff'))
      .toBe('http://127.0.0.1:4321/api/diff')
  })
})
