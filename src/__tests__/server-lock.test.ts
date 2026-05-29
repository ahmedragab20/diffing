// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mockGetProjectStorageDir = vi.fn()
const mockGetRepoRoot = vi.fn()

vi.mock('../lib/git.js', () => ({
  getProjectStorageDir: (...args: any[]) => mockGetProjectStorageDir(...args),
  getRepoRoot: () => mockGetRepoRoot(),
}))

let storageDir: string

async function loadModule() {
  return import('../lib/server-lock.js')
}

function makeLock(overrides: Partial<import('../lib/server-lock.js').ServerLock> = {}) {
  return {
    port: 3433,
    host: '127.0.0.1',
    pid: process.pid,
    repoRoot: '/tmp/test-repo',
    startedAt: 1000,
    version: '0.0.0',
    ...overrides,
  }
}

describe('server-lock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storageDir = mkdtempSync(join(tmpdir(), 'diffit-lock-'))
    mockGetProjectStorageDir.mockReturnValue(storageDir)
    mockGetRepoRoot.mockReturnValue('/tmp/test-repo')
  })

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true })
  })

  it('round-trips a lock through write/read', async () => {
    const { writeServerLock, readServerLock } = await loadModule()
    writeServerLock(makeLock({ port: 5050 }))
    const read = readServerLock()
    expect(read).toMatchObject({ port: 5050, pid: process.pid, repoRoot: '/tmp/test-repo' })
  })

  it('returns null when no lock exists', async () => {
    const { readServerLock } = await loadModule()
    expect(readServerLock()).toBeNull()
  })

  it('treats a live process in the same repo as alive', async () => {
    const { isLockAlive } = await loadModule()
    expect(isLockAlive(makeLock({ pid: process.pid }))).toBe(true)
  })

  it('treats a dead pid as not alive', async () => {
    const { isLockAlive } = await loadModule()
    // 2^31-1 is effectively never a live pid.
    expect(isLockAlive(makeLock({ pid: 2147483646 }))).toBe(false)
  })

  it('treats a lock from a different repo as not alive', async () => {
    const { isLockAlive } = await loadModule()
    expect(isLockAlive(makeLock({ pid: process.pid, repoRoot: '/somewhere/else' }))).toBe(false)
  })

  it('removes the lock file', async () => {
    const { writeServerLock, removeServerLock, readServerLock } = await loadModule()
    writeServerLock(makeLock())
    expect(existsSync(join(storageDir, 'server.json'))).toBe(true)
    removeServerLock()
    expect(readServerLock()).toBeNull()
  })
})
