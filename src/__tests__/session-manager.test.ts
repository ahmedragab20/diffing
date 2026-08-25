// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerLock } from '../lib/server-lock.js'

const {
  listServerLocks,
  listRegisteredServerLocks,
  resolveActiveServerLock,
  resolveUnresponsiveServerLock,
  recoverOrphanedServerStartupLease,
  activateServerLock,
  openExistingSession,
  stopLockOwner,
} = vi.hoisted(() => ({
  listServerLocks: vi.fn(),
  listRegisteredServerLocks: vi.fn(),
  resolveActiveServerLock: vi.fn(),
  resolveUnresponsiveServerLock: vi.fn(),
  recoverOrphanedServerStartupLease: vi.fn(() => false),
  activateServerLock: vi.fn((lock) => lock),
  openExistingSession: vi.fn(async () => {}),
  stopLockOwner: vi.fn(async () => {}),
}))

vi.mock('../lib/server-lock.js', () => ({
  listServerLocks,
  listRegisteredServerLocks,
  resolveActiveServerLock,
  resolveUnresponsiveServerLock,
  recoverOrphanedServerStartupLease,
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
    listRegisteredServerLocks.mockImplementation(() => listServerLocks())
    recoverOrphanedServerStartupLease.mockReturnValue(false)
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

  it('shows unreachable registered sessions and force-stops them with kill', async () => {
    const stuck = lock('stuck-session')
    listServerLocks.mockReturnValue([])
    listRegisteredServerLocks.mockReturnValue([stuck])
    resolveActiveServerLock.mockReturnValue(null)
    resolveUnresponsiveServerLock.mockReturnValue(stuck)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { runSessionsCommand } = await import('../lib/session-manager.js')

    await expect(runSessionsCommand(['--json'])).resolves.toBe(0)
    expect(String(output.mock.calls[0][0])).toContain('"status": "unreachable"')

    await expect(runSessionsCommand(['kill', 'all'])).resolves.toBe(0)
    expect(stopLockOwner).toHaveBeenCalledWith(stuck, expect.objectContaining({
      lockMatches: expect.any(Function),
    }))
  })

  it('repairs an orphaned startup lease when kill all has no sessions', async () => {
    listServerLocks.mockReturnValue([])
    listRegisteredServerLocks.mockReturnValue([])
    resolveActiveServerLock.mockReturnValue(null)
    resolveUnresponsiveServerLock.mockReturnValue(null)
    recoverOrphanedServerStartupLease.mockReturnValue(true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { runSessionsCommand } = await import('../lib/session-manager.js')

    await expect(runSessionsCommand(['kill', 'all'])).resolves.toBe(0)
    expect(log).toHaveBeenCalledWith('Recovered an orphaned diffing startup lease for this repository.')
  })
})
