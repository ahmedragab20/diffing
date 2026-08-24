// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ServerLock } from '../lib/server-lock.js'
import {
  existingSessionUrl,
  findReusableSession,
  openExistingSession,
  sessionMatchesLaunch,
  stopLockOwner,
} from '../lib/session-conflict.js'

function makeLock(overrides: Partial<ServerLock> = {}): ServerLock {
  return {
    port: 51835,
    host: '127.0.0.1',
    pid: 4242,
    repoRoot: '/tmp/demo-repo',
    startedAt: 1,
    version: '0.0.0',
    mode: 'web',
    ...overrides,
  }
}

describe('existingSessionUrl', () => {
  it('builds a loopback URL for web sessions', () => {
    expect(existingSessionUrl(makeLock())).toBe('http://127.0.0.1:51835')
  })

  it('returns clean URLs when auth is configured', () => {
    expect(existingSessionUrl(makeLock({ authToken: 'secret' })))
      .toBe('http://127.0.0.1:51835')
  })

  it('rewrites 0.0.0.0 to 127.0.0.1 and appends /gh/pr for PR mode', () => {
    expect(
      existingSessionUrl(makeLock({ host: '0.0.0.0', mode: 'gh-pr' })),
    ).toBe('http://127.0.0.1:51835/gh/pr')
  })

  it('returns clean gh-pr URLs when auth is configured', () => {
    expect(
      existingSessionUrl(makeLock({ host: '0.0.0.0', mode: 'gh-pr', authToken: 'tok' })),
    ).toBe('http://127.0.0.1:51835/gh/pr')
  })

  it('returns null for TUI sessions', () => {
    expect(existingSessionUrl(makeLock({ mode: 'tui', port: 0 }))).toBeNull()
  })

})

describe('matching reusable launches', () => {
  const request = {
    mode: 'web' as const,
    scope: 'working-tree-scope',
    host: '127.0.0.1',
  }

  it('matches the same mode, scope, and bind target', () => {
    expect(sessionMatchesLaunch(makeLock({ scope: request.scope }), request)).toBe(true)
  })

  it('matches legacy scope JSON after removing launch-only fields', () => {
    const semanticRequest = { ...request, scope: JSON.stringify({ staged: false }) }
    const legacyScope = JSON.stringify({
      staged: false,
      skipSetup: true,
      viewOnly: false,
      outputMode: 'web',
    })
    expect(sessionMatchesLaunch(makeLock({ scope: legacyScope }), semanticRequest)).toBe(true)
  })

  it('rejects a different scope, mode, host, or explicitly requested port', () => {
    expect(sessionMatchesLaunch(makeLock({ scope: 'other' }), request)).toBe(false)
    expect(sessionMatchesLaunch(makeLock({ scope: request.scope, mode: 'tui' }), request)).toBe(false)
    expect(sessionMatchesLaunch(makeLock({ scope: request.scope, host: '0.0.0.0' }), request)).toBe(false)
    expect(sessionMatchesLaunch(makeLock({ scope: request.scope }), { ...request, port: 3433 })).toBe(false)
  })

  it('keeps GitHub PR identity separate from diff scope', () => {
    const prRequest = { ...request, mode: 'gh-pr' as const, prRef: '123' }
    expect(sessionMatchesLaunch(makeLock({ mode: 'gh-pr', scope: request.scope, prRef: '123' }), prRequest)).toBe(true)
    expect(sessionMatchesLaunch(makeLock({ mode: 'gh-pr', scope: request.scope, prRef: '456' }), prRequest)).toBe(false)
  })

  it('selects the first compatible entry, preserving newest-first registry order', () => {
    const older = makeLock({ sessionId: 'older', scope: request.scope, startedAt: 1 })
    const newer = makeLock({ sessionId: 'newer', scope: request.scope, startedAt: 2 })
    expect(findReusableSession([newer, older], request)).toBe(newer)
  })
})

describe('stopLockOwner', () => {
  it('sends SIGTERM and resolves once the pid dies', async () => {
    const signals: Array<NodeJS.Signals | number | undefined> = []
    let alive = true
    const kill = vi.fn((pid: number, signal?: NodeJS.Signals | number) => {
      expect(pid).toBe(4242)
      signals.push(signal)
      if (signal === 'SIGTERM') alive = false
      if (signal === 0 && !alive) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      return true
    })
    const clearLock = vi.fn()
    let t = 0

    await stopLockOwner(makeLock(), {
      timeoutMs: 1_000,
      pollMs: 1,
      kill,
      sleep: async () => {
        t += 1
      },
      now: () => t,
      isAlive: () => alive,
      clearLock,
      lockMatches: async () => true,
    })

    expect(signals[0]).toBe('SIGTERM')
    expect(clearLock).toHaveBeenCalledOnce()
    expect(signals).not.toContain('SIGKILL')
  })

  it('escalates to SIGKILL after the soft timeout', async () => {
    const signals: Array<NodeJS.Signals | number | undefined> = []
    let alive = true
    let t = 0
    await stopLockOwner(makeLock(), {
      timeoutMs: 5,
      killDeadlineMs: 5,
      pollMs: 1,
      kill: (pid, signal) => {
        signals.push(signal)
        if (signal === 'SIGKILL') alive = false
        return true
      },
      sleep: async () => {
        t += 3
      },
      now: () => t,
      isAlive: () => alive,
      clearLock: () => {},
      lockMatches: async () => true,
    })
    expect(signals).toContain('SIGTERM')
    expect(signals).toContain('SIGKILL')
  })

  it('clears a stale lock without signaling when the port probe fails', async () => {
    const kill = vi.fn()
    const clearLock = vi.fn()
    await stopLockOwner(makeLock(), {
      lockMatches: async () => false,
      isAlive: () => false,
      kill,
      clearLock,
    })
    expect(kill).not.toHaveBeenCalled()
    expect(clearLock).toHaveBeenCalledOnce()
  })

  it('refuses to signal a live owner when the port probe is inconclusive', async () => {
    const kill = vi.fn()
    const clearLock = vi.fn()
    await expect(stopLockOwner(makeLock(), {
      lockMatches: async () => false,
      isAlive: () => true,
      kill,
      clearLock,
    })).rejects.toThrow(/review API did not answer/)
    expect(kill).not.toHaveBeenCalled()
    expect(clearLock).not.toHaveBeenCalled()
  })

  it('throws when the process never exits', async () => {
    let t = 0
    await expect(
      stopLockOwner(makeLock({ pid: 7 }), {
        timeoutMs: 2,
        killDeadlineMs: 2,
        pollMs: 1,
        kill: () => true,
        sleep: async () => {
          t += 2
        },
        now: () => t,
        isAlive: () => true,
        clearLock: () => {},
        lockMatches: async () => true,
      }),
    ).rejects.toThrow(/Timed out waiting for diffing pid 7/)
  })
})

describe('openExistingSession', () => {
  it('opens the browser URL for web sessions', async () => {
    const openUrl = vi.fn(async () => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await openExistingSession(makeLock(), { noOpen: false, openUrl, probeUi: () => true })
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:51835')
    expect(log).toHaveBeenCalledWith(
      'Opening existing diffing session at http://127.0.0.1:51835',
    )
    log.mockRestore()
  })

  it('opens a clean browser URL when auth is configured', async () => {
    const openUrl = vi.fn(async () => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await openExistingSession(makeLock({ authToken: 'secret' }), {
      noOpen: false,
      openUrl,
      probeUi: () => true,
    })
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:51835')
    log.mockRestore()
  })

  it('skips browser open when noOpen is set', async () => {
    const openUrl = vi.fn(async () => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await openExistingSession(makeLock(), { noOpen: true, openUrl, probeUi: () => true })
    expect(openUrl).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('does not open a browser for TUI sessions', async () => {
    const openUrl = vi.fn(async () => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await openExistingSession(makeLock({ mode: 'tui', port: 0 }), {
      noOpen: false,
      openUrl,
    })
    expect(openUrl).not.toHaveBeenCalled()
    expect(log.mock.calls[0]?.[0]).toMatch(/TUI session is already open/)
    log.mockRestore()
  })

  it('refuses to open an API-only web session with a broken UI shell', async () => {
    const openUrl = vi.fn(async () => {})
    await expect(openExistingSession(makeLock(), {
      noOpen: false,
      openUrl,
      probeUi: () => false,
    })).rejects.toThrow(/review UI is unavailable/)
    expect(openUrl).not.toHaveBeenCalled()
  })
})
