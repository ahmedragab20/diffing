import { writeFileSync, readFileSync, mkdirSync, rmSync, unlinkSync, renameSync, rmdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getProjectStorageDir, getRepoRoot } from './git.js'
import type { DiffOptions } from './diff-options.js'

/**
 * A tiny lockfile (`server.json`) written into the per-repo storage dir when a
 * diffing web server starts. It lets the `diffing` CLI subcommands and the MCP
 * server discover the running server's port with zero user input — they resolve
 * the same per-repo directory from the cwd and read this file. Stale locks (from
 * a crashed server) self-heal via `isLockAlive`.
 */
export interface ServerLock {
  port: number
  host: string
  pid: number
  repoRoot: string
  startedAt: number
  version: string
  /**
   * Which surface owns the lock.
   *  - `"web"` — Hono server (port is meaningful).
   *  - `"tui"` — Rust binary in `crates/diffing-tui` (embedded loopback API).
   *  - `"gh-pr"` — Hono server opened on a GitHub PR (port is meaningful).
   * Optional for backward compat with writes made before this field existed;
   * consumers should treat absent as `"web"`.
   */
  mode?: 'web' | 'tui' | 'gh-pr'

  /** Bearer capability for a TUI-owned loopback API. Never sent off-host. */
  capability?: string

  /**
   * When `mode === 'gh-pr'`, the original `gh pr <ref>` input. Used by
   * `diffing gh …` subcommands to re-locate the PR session without
   * re-parsing CLI args.
   */
  prRef?: string

  /** Stable description of the diff scope shown by this server. */
  scope?: string

  /** Original git-diff arguments when the server was started through MCP. */
  diffArgs?: string[]

  /** Identifies sessions started by MCP. Missing means a user-owned session. */
  owner?: 'mcp'

  /** Unique CLI/MCP connection which owns this web-server lock. */
  ownerId?: string
}

interface StartupLeaseRecord {
  ownerId: string
  createdAt: number
  pid: number
}

export interface ServerStartupLease {
  ownerId: string
  release(): void
}

const STARTUP_LEASE_STALE_MS = 30_000

/**
 * Produce a stable comparison key for the diff a server displays. Runtime-only
 * web options are excluded so `--port`/`--no-open` do not create false scope
 * mismatches between a user-started session and an MCP request.
 */
export function diffScopeKey(options: DiffOptions): string {
  const {
    port: _port,
    host: _host,
    noOpen: _noOpen,
    reuseSession: _reuseSession,
    replaceSession: _replaceSession,
    help: _help,
    version: _version,
    outputMode: _outputMode,
    tui: _tui,
    gpu: _gpu,
    noExtDiff: _noExtDiff,
    ...scope
  } = options
  return JSON.stringify(scope)
}

export function lockPath(repoRoot?: string): string {
  return join(getProjectStorageDir(repoRoot), 'server.json')
}

export function writeServerLock(lock: ServerLock): void {
  const path = lockPath(lock.repoRoot)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(lock, null, 2), 'utf-8')
}

export function readServerLock(repoRoot?: string): ServerLock | null {
  try {
    const raw = readFileSync(lockPath(repoRoot), 'utf-8')
    const lock = JSON.parse(raw) as ServerLock
    if (typeof lock.port !== 'number' || typeof lock.pid !== 'number') return null
    return lock
  } catch {
    return null
  }
}

/**
 * True if the process named by the lock is still alive and the lock belongs to
 * this repo. `process.kill(pid, 0)` sends no signal — it just probes existence.
 */
export function isLockAlive(lock: ServerLock, expectedRepoRoot?: string): boolean {
  try {
    process.kill(lock.pid, 0)
  } catch {
    return false
  }
  try {
    return lock.repoRoot === (expectedRepoRoot ?? getRepoRoot())
  } catch {
    return true
  }
}

export function removeServerLock(repoRoot?: string): void {
  try {
    rmSync(lockPath(repoRoot), { force: true })
  } catch {
    // best-effort cleanup
  }
}

/** Remove server.json only while holding the startup lease and only if exact ownership still matches. */
export function removeServerLockIfOwned(repoRoot: string, pid: number, ownerId: string): boolean {
  const cleanupLease = acquireServerStartupLease(repoRoot, `cleanup-${ownerId}`)
  if (!cleanupLease) return false
  try {
    const lock = readServerLock(repoRoot)
    if (!lock || lock.pid !== pid || lock.ownerId !== ownerId) return false
    removeServerLock(repoRoot)
    return true
  } finally {
    cleanupLease.release()
  }
}

/**
 * Atomically reserve server startup for one repository. The exclusive-create
 * directory is the cross-process serialization point; callers must re-read
 * server.json after acquiring it because another process may have completed
 * startup between their first lock check and this lease acquisition.
 */
export function acquireServerStartupLease(
  repoRoot: string,
  ownerId: string,
  now = Date.now(),
): ServerStartupLease | null {
  const path = join(getProjectStorageDir(repoRoot), 'server-startup.lock')
  const recordPath = join(path, 'lease.json')
  const ownerMarkerPath = join(path, `owner-${encodeURIComponent(ownerId)}`)
  mkdirSync(join(path, '..'), { recursive: true })

  const tryCreate = (): boolean => {
    try {
      mkdirSync(path, { recursive: false, mode: 0o700 })
    } catch (error: any) {
      if (error?.code === 'EEXIST') return false
      throw error
    }
    try {
      writeFileSync(recordPath, JSON.stringify({ ownerId, createdAt: now, pid: process.pid } satisfies StartupLeaseRecord), 'utf-8')
      writeFileSync(ownerMarkerPath, '', 'utf-8')
    } catch (error) {
      rmSync(path, { recursive: true, force: true })
      throw error
    }
    return true
  }

  if (!tryCreate()) {
    let reclaim = false
    let acquiredAfterRace = false
    try {
      const record = JSON.parse(readFileSync(recordPath, 'utf-8')) as Partial<StartupLeaseRecord>
      if (typeof record.createdAt !== 'number' || typeof record.pid !== 'number') {
        throw new Error('Malformed startup lease')
      }
      let ownerIsAlive = true
      try {
        process.kill(record.pid, 0)
      } catch (error: any) {
        // ESRCH means no such process. EPERM still proves the pid exists.
        ownerIsAlive = error?.code !== 'ESRCH'
      }
      reclaim = now - record.createdAt > STARTUP_LEASE_STALE_MS && !ownerIsAlive
      if (!reclaim) return null
    } catch {
      try {
        // A crash between mkdir and lease.json can leave an empty directory.
        // Its mtime is the only available age signal; reclaim only after the
        // same conservative stale interval.
        reclaim = now - statSync(path).mtimeMs > STARTUP_LEASE_STALE_MS
      } catch (statError: any) {
        if (statError?.code !== 'ENOENT') return null
        if (!tryCreate()) return null
        acquiredAfterRace = true
      }
      if (!reclaim && !acquiredAfterRace) return null
    }

    if (reclaim && !acquiredAfterRace) {
      // Rename the whole stale lease before replacing it. The previous owner
      // releases through an owner-specific marker, so it can never unlink the
      // new lease even if it wakes after stale recovery.
      const stalePath = `${path}.stale-${process.pid}-${now}`
      renameSync(path, stalePath)
      rmSync(stalePath, { recursive: true, force: true })
    }
    if (!acquiredAfterRace && !tryCreate()) return null
  }

  let released = false
  return {
    ownerId,
    release() {
      if (released) return
      released = true
      try {
        // The marker exists only in this owner's lease directory. If stale
        // recovery renamed it and installed a new lease, this path is absent.
        unlinkSync(ownerMarkerPath)
        unlinkSync(recordPath)
        rmdirSync(path)
      } catch {
        // Best effort: a missing/replaced lease is no longer ours to remove.
      }
    },
  }
}
