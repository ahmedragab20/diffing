// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { reviewSessionApiOrigin, reviewSessionUrl } from '../lib/session-url.js'
import type { ServerLock } from '../lib/server-lock.js'

const lock: ServerLock = {
  host: '127.0.0.1', port: 43123, pid: 1, repoRoot: '/repo',
  startedAt: 1, version: 'test', mode: 'tui', capability: 'private-capability',
}

describe('session addresses', () => {
  it('exposes the TUI API without inventing a browser link or leaking its capability', () => {
    expect(reviewSessionApiOrigin(lock)).toBe('http://127.0.0.1:43123')
    expect(reviewSessionUrl(lock)).toBeNull()
    expect(reviewSessionApiOrigin({ ...lock, host: '::1' })).toBe('http://[::1]:43123')
  })

  it('keeps PR page routing separate from API requests', () => {
    expect(reviewSessionUrl({ ...lock, mode: 'gh-pr' })).toBe('http://127.0.0.1:43123/gh/pr')
    expect(reviewSessionApiOrigin({ ...lock, mode: 'gh-pr' })).toBe('http://127.0.0.1:43123')
  })

  it('rejects remote hosts and invalid ports', () => {
    expect(reviewSessionApiOrigin({ ...lock, host: 'example.com' })).toBeNull()
    for (const port of [0, -1, 1.5, 65536, NaN]) {
      expect(reviewSessionApiOrigin({ ...lock, port })).toBeNull()
    }
  })
})
