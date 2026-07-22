// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ServerLock } from '../lib/server-lock.js'
import {
  conflictFailMessage,
  existingSessionUrl,
  formatExistingSession,
  openExistingSession,
  resolveSessionConflictAction,
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

describe('existingSessionUrl / formatExistingSession', () => {
  it('builds a loopback URL for web sessions', () => {
    expect(existingSessionUrl(makeLock())).toBe('http://127.0.0.1:51835')
  })

  it('rewrites 0.0.0.0 to 127.0.0.1 and appends /gh/pr for PR mode', () => {
    expect(
      existingSessionUrl(makeLock({ host: '0.0.0.0', mode: 'gh-pr' })),
    ).toBe('http://127.0.0.1:51835/gh/pr')
  })

  it('returns null for TUI sessions', () => {
    expect(existingSessionUrl(makeLock({ mode: 'tui', port: 0 }))).toBeNull()
  })

  it('formats a human-readable conflict summary', () => {
    const text = formatExistingSession(makeLock({ pid: 99 }))
    expect(text).toContain('url:  http://127.0.0.1:51835')
    expect(text).toContain('mode: web')
    expect(text).toContain('pid:  99')
  })

  it('keeps the legacy fail message shape', () => {
    expect(conflictFailMessage(makeLock())).toBe(
      'A diffing review is already running for this repository at http://127.0.0.1:51835. End it before starting another scope.',
    )
    expect(conflictFailMessage(makeLock({ mode: 'tui', port: 0 }))).toContain('a TUI session')
  })
})

describe('resolveSessionConflictAction', () => {
  it('honors --reuse-session and --replace-session without prompting', async () => {
    const prompt = vi.fn(async () => 'cancel' as const)
    await expect(
      resolveSessionConflictAction({
        lock: makeLock(),
        reuseSession: true,
        replaceSession: false,
        canPrompt: true,
        prompt,
      }),
    ).resolves.toBe('open')
    await expect(
      resolveSessionConflictAction({
        lock: makeLock(),
        reuseSession: false,
        replaceSession: true,
        canPrompt: true,
        prompt,
      }),
    ).resolves.toBe('replace')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('rejects combining both flags', async () => {
    await expect(
      resolveSessionConflictAction({
        lock: makeLock(),
        reuseSession: true,
        replaceSession: true,
        canPrompt: true,
      }),
    ).rejects.toThrow(/Cannot combine/)
  })

  it('returns cancel when non-interactive and no flag is set', async () => {
    const prompt = vi.fn(async () => 'open' as const)
    await expect(
      resolveSessionConflictAction({
        lock: makeLock(),
        reuseSession: false,
        replaceSession: false,
        canPrompt: false,
        prompt,
      }),
    ).resolves.toBe('cancel')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('prompts when interactive and no flag is set', async () => {
    const prompt = vi.fn(async () => 'replace' as const)
    await expect(
      resolveSessionConflictAction({
        lock: makeLock(),
        reuseSession: false,
        replaceSession: false,
        canPrompt: true,
        prompt,
      }),
    ).resolves.toBe('replace')
    expect(prompt).toHaveBeenCalledOnce()
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
    })
    expect(signals).toContain('SIGTERM')
    expect(signals).toContain('SIGKILL')
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
      }),
    ).rejects.toThrow(/Timed out waiting for diffing pid 7/)
  })
})

describe('openExistingSession', () => {
  it('opens the browser URL for web sessions', async () => {
    const openUrl = vi.fn(async () => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await openExistingSession(makeLock(), { noOpen: false, openUrl })
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:51835')
    expect(log).toHaveBeenCalledWith(
      'Opening existing diffing session at http://127.0.0.1:51835',
    )
    log.mockRestore()
  })

  it('skips browser open when noOpen is set', async () => {
    const openUrl = vi.fn(async () => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await openExistingSession(makeLock(), { noOpen: true, openUrl })
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
})
