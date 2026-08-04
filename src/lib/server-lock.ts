import {
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  renameSync,
  rmdirSync,
  statSync,
  chmodSync,
} from 'node:fs'
import { probeLockServerSync } from './lock-probe.js'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getProjectStorageDir, getRepoRoot } from './git.js'
import type { DiffOptions } from './diff-options.js'

/**
 * A discovery record shared by web, TUI, and PR sessions. Each live review has
 * a file under `sessions/`; `server.json` mirrors the selected active record so
 * older CLI/MCP clients can still discover one target with zero configuration.
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

  /** Per-session API token for web/gh-pr review servers. Omitted when auth is disabled. */
  authToken?: string

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

  /** Stable public identifier used by the multi-session registry and CLI. */
  sessionId?: string
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
    insecureNoAuth: _insecureNoAuth,
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

export function sessionsPath(repoRoot?: string): string {
  return join(getProjectStorageDir(repoRoot), 'sessions')
}

/** Stable identity for both current and pre-registry lock records. */
export function serverSessionId(lock: ServerLock): string {
  return lock.sessionId ?? lock.ownerId ?? `${lock.mode ?? 'web'}-${lock.pid}-${lock.startedAt}`
}

export function sameServerSession(left: ServerLock, right: ServerLock): boolean {
  if (left.sessionId && right.sessionId) return left.sessionId === right.sessionId
  return left.pid === right.pid && left.startedAt === right.startedAt && left.port === right.port
}

function sessionPath(lock: ServerLock): string {
  return join(sessionsPath(lock.repoRoot), `${encodeURIComponent(serverSessionId(lock))}.json`)
}

function writeJsonAtomically(path: string, value: unknown): void {
  const parent = join(path, '..')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  try {
    chmodSync(parent, 0o700)
  } catch {
    // best-effort when parent already existed with different ownership
  }
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
  renameSync(temporary, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    // best-effort
  }
}

function normalizedLock(lock: ServerLock): ServerLock {
  return lock.sessionId ? lock : { ...lock, sessionId: serverSessionId(lock) }
}

function writeSessionRecord(lock: ServerLock): ServerLock {
  const normalized = normalizedLock(lock)
  writeJsonAtomically(sessionPath(normalized), normalized)
  return normalized
}

/**
 * Register a session and make it the active target for legacy clients. Before
 * replacing server.json, adopt a live pre-registry lock so an upgrade never
 * makes an already-running review disappear from the session manager.
 */
export function writeServerLock(lock: ServerLock): void {
  const current = readServerLock(lock.repoRoot)
  if (current && isLockAlive(current, lock.repoRoot) && !sameServerSession(current, lock)) {
    writeSessionRecord(current)
  }
  const normalized = writeSessionRecord(lock)
  try {
    writeJsonAtomically(lockPath(lock.repoRoot), normalized)
  } catch (error) {
    // Publishing is transactional from the caller's perspective: never leave
    // an unreachable registry entry when the active pointer could not move.
    rmSync(sessionPath(normalized), { force: true })
    throw error
  }
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

/** Return every live registered session, newest first, and prune stale entries. */
export function listServerLocks(repoRoot?: string): ServerLock[] {
  let expectedRepoRoot: string
  try {
    expectedRepoRoot = repoRoot ?? getRepoRoot()
  } catch {
    return []
  }

  const sessions = new Map<string, ServerLock>()
  const addIfLive = (candidate: ServerLock, stalePath?: string) => {
    if (candidate.repoRoot !== expectedRepoRoot || !isLockAlive(candidate, expectedRepoRoot)) {
      if (stalePath) rmSync(stalePath, { force: true })
      return
    }
    const normalized = normalizedLock(candidate)
    sessions.set(serverSessionId(normalized), normalized)
  }

  const active = readServerLock(expectedRepoRoot)
  if (active) addIfLive(active)

  const directory = sessionsPath(expectedRepoRoot)
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const path = join(directory, entry.name)
      try {
        const candidate = JSON.parse(readFileSync(path, 'utf-8')) as ServerLock
        if (typeof candidate.port !== 'number' || typeof candidate.pid !== 'number') {
          rmSync(path, { force: true })
          continue
        }
        addIfLive(candidate, path)
      } catch {
        rmSync(path, { force: true })
      }
    }
  } catch {
    // A repository with no registry yet simply has no sessions directory.
  }

  return [...sessions.values()].sort((left, right) => right.startedAt - left.startedAt)
}

/** Resolve the active session, electing the newest live fallback when needed. */
export function resolveActiveServerLock(repoRoot?: string): ServerLock | null {
  let expectedRepoRoot: string
  try {
    expectedRepoRoot = repoRoot ?? getRepoRoot()
  } catch {
    return null
  }
  const active = readServerLock(expectedRepoRoot)
  if (active && isLockAlive(active, expectedRepoRoot)) {
    const normalized = normalizedLock(active)
    // Opportunistically migrate a legacy singleton into the registry.
    if (!existsSync(sessionPath(normalized))) writeSessionRecord(normalized)
    if (!active.sessionId) writeJsonAtomically(lockPath(expectedRepoRoot), normalized)
    return normalized
  }

  const fallback = listServerLocks(expectedRepoRoot)[0]
  if (!fallback) {
    removeServerLock(expectedRepoRoot)
    return null
  }
  return activateServerLock(fallback)
}

/** Make an existing registered session the default target for CLI/MCP clients. */
export function activateServerLock(lock: ServerLock): ServerLock {
  const normalized = writeSessionRecord(lock)
  writeJsonAtomically(lockPath(lock.repoRoot), normalized)
  return normalized
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined
    // ESRCH means no such process; EPERM still proves the pid exists.
    return code === 'EPERM'
  }
}

/**
 * True when the lock pid is alive, belongs to this repo, and the loopback port
 * still serves a diffing review status endpoint (detects PID reuse).
 */
export function isLockAlive(lock: ServerLock, expectedRepoRoot?: string): boolean {
  if (!isPidAlive(lock.pid)) return false
  try {
    if (lock.repoRoot !== (expectedRepoRoot ?? getRepoRoot())) return false
  } catch {
    // keep checking when repo root cannot be resolved
  }
  return probeLockServerSync(lock)
}

export function removeServerLock(repoRoot?: string): void {
  try {
    rmSync(lockPath(repoRoot), { force: true })
  } catch {
    // best-effort cleanup
  }
}

/** Remove one registry entry and elect another live session if it was active. */
export function removeServerSession(lock: ServerLock): void {
  const normalized = normalizedLock(lock)
  const path = sessionPath(normalized)
  try {
    const stored = JSON.parse(readFileSync(path, 'utf-8')) as ServerLock
    if (sameServerSession(stored, normalized)) rmSync(path, { force: true })
  } catch {
    // Missing or malformed session records are already effectively removed.
  }

  const active = readServerLock(lock.repoRoot)
  if (!active || !sameServerSession(active, normalized)) return

  const fallback = listServerLocks(lock.repoRoot).find(
    (candidate) => !sameServerSession(candidate, normalized),
  )
  if (fallback) activateServerLock(fallback)
  else removeServerLock(lock.repoRoot)
}

/**
 * Unregister live sessions owned by one exact CLI/MCP process identity.
 *
 * Matches by pid + ownerId against the raw lock files, never via the liveness
 * probe. This runs during our own shutdown (SIGINT/SIGTERM): the probe
 * synchronously spawns a child that HTTP-asks this very process, but the
 * blocked event loop cannot answer, so the probe fails and the lock is
 * skipped as "stale" — leaving `server.json` behind on every clean exit.
 */
export function removeServerLockIfOwned(repoRoot: string, pid: number, ownerId: string): boolean {
  const cleanupLease = acquireServerStartupLease(repoRoot, `cleanup-${ownerId}`)
  if (!cleanupLease) return false
  try {
    const owned: ServerLock[] = []
    const active = readServerLock(repoRoot)
    if (active && active.pid === pid && active.ownerId === ownerId) owned.push(active)
    const directory = sessionsPath(repoRoot)
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        try {
          const candidate = JSON.parse(readFileSync(join(directory, entry.name), 'utf-8')) as ServerLock
          if (candidate.pid === pid && candidate.ownerId === ownerId) owned.push(candidate)
        } catch {
          // Malformed session record — not ours to repair here.
        }
      }
    } catch {
      // A repository with no registry yet simply has no sessions directory.
    }
    if (owned.length === 0) return false
    for (const lock of owned) removeServerSession(lock)
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
      try {
        renameSync(path, stalePath)
        rmSync(stalePath, { recursive: true, force: true })
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          if (!tryCreate()) return null
          acquiredAfterRace = true
        } else {
          return null
        }
      }
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
