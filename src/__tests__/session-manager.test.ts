// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerLock } from '../lib/server-lock.js'

const {
  listServerLocks,
  resolveActiveServerLock,
  activateServerLock,
  openExistingSession,
  stopLockOwner,
} = vi.hoisted(() => ({
  listServerLocks: vi.fn(),
  resolveActiveServerLock: vi.fn(),
  activateServerLock: vi.fn((lock) => lock),
  openExistingSession: vi.fn(async () => {}),
  stopLockOwner: vi.fn(async () => {}),
}))

vi.mock('../lib/server-lock.js', () => ({
  listServerLocks,
  resolveActiveServerLock,
  activateServerLock,
  serverSessionId: (lock: ServerLock) => lock.sessionId,
  sameServerSession: (left: ServerLock, right: ServerLock) => left.sessionId === right.sessionId,
}))

vi.mock('../lib/session-conflict.js', () => ({
  existingSessionUrl: (lock: ServerLock) => lock.mode === 'tui' ? null : `http://127.0.0.1:${lock.port}`,
  openExistingSession,
  stopLockOwner,
}))

function lock(id: string, overrides: Partial<ServerLock> = {}): ServerLock {
  return {
    sessionId: id,
    port: 4000,
    host: '127.0.0.1',
    pid: 42,
    repoRoot: '/tmp/repo',
    startedAt: Date.now(),
    version: '0.0.0',
    mode: 'web',
    ...overrides,
  }
}

describe('sessions command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists every session as safe JSON without exposing TUI capabilities', async () => {
    const web = lock('web-session')
    const tui = lock('tui-session', { mode: 'tui', capability: 'secret-token' })
    listServerLocks.mockReturnValue([tui, web])
    resolveActiveServerLock.mockReturnValue(web)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { runSessionsCommand } = await import('../lib/session-manager.js')

    await expect(runSessionsCommand(['--json'])).resolves.toBe(0)
    const json = String(output.mock.calls[0][0])
    expect(json).toContain('tui-session')
    expect(json).toContain('"active": true')
    expect(json).not.toContain('secret-token')
  })

  it('selects a session by a unique short prefix', async () => {
    const first = lock('12345678-first')
    const second = lock('abcdef12-second', { mode: 'tui' })
    listServerLocks.mockReturnValue([second, first])
    resolveActiveServerLock.mockReturnValue(first)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { runSessionsCommand } = await import('../lib/session-manager.js')

    await expect(runSessionsCommand(['use', 'abcdef12'])).resolves.toBe(0)
    expect(activateServerLock).toHaveBeenCalledWith(second)
  })

  it('stops all live sessions through the graceful lifecycle path', async () => {
    const first = lock('first')
    const second = lock('second', { pid: 43 })
    listServerLocks.mockReturnValue([second, first])
    resolveActiveServerLock.mockReturnValue(second)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { runSessionsCommand } = await import('../lib/session-manager.js')

    await expect(runSessionsCommand(['stop', 'all'])).resolves.toBe(0)
    expect(stopLockOwner).toHaveBeenCalledTimes(2)
    expect(stopLockOwner).toHaveBeenNthCalledWith(1, second)
    expect(stopLockOwner).toHaveBeenNthCalledWith(2, first)
  })
})
