import {
  probeLockReviewUiSync,
  probeLockServerSync,
} from './lock-probe.js'
import {
  removeServerSession,
  sameDiffScope,
  type ServerLock,
} from './server-lock.js'
import { loadSettings } from './settings.js'
import { reviewSessionUrl } from './session-url.js'

export interface StopLockOwnerOptions {
  timeoutMs?: number
  killDeadlineMs?: number
  pollMs?: number
  kill?: (pid: number, signal?: NodeJS.Signals | number) => boolean
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  isAlive?: (lock: ServerLock) => boolean
  clearLock?: (lock: ServerLock) => void
  /** When false, the lock is stale — clear it without signaling the pid. */
  lockMatches?: (lock: ServerLock) => boolean | Promise<boolean>
}

export interface OpenExistingSessionOptions {
  noOpen: boolean
  /** Injectable browser opener; defaults to the `open` package. */
  openUrl?: (url: string) => Promise<unknown>
  /** Injectable UI readiness check. */
  probeUi?: (lock: ServerLock) => boolean
}

export interface SessionLaunchRequest {
  mode: 'web' | 'tui' | 'gh-pr'
  scope: string
  host: string
  port?: number
  prRef?: string
}

/** True when a live registry entry can serve the requested launch exactly. */
export function sessionMatchesLaunch(
  lock: ServerLock,
  request: SessionLaunchRequest,
): boolean {
  const mode = lock.mode ?? 'web'
  if (
    mode !== request.mode ||
    !lock.scope ||
    !sameDiffScope(lock.scope, request.scope)
  ) return false

  if (mode === 'gh-pr' && lock.prRef !== request.prRef) return false
  if (mode !== 'tui' && lock.host !== request.host) return false
  if (request.port !== undefined && lock.port !== request.port) return false
  return true
}

/** Pick the newest compatible session from `listServerLocks()` output. */
export function findReusableSession(
  sessions: ServerLock[],
  request: SessionLaunchRequest,
): ServerLock | null {
  return sessions.find((lock) => sessionMatchesLaunch(lock, request)) ?? null
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Loopback-safe review URL for web / gh-pr locks; null for TUI or invalid ports. */
export function existingSessionUrl(lock: ServerLock): string | null {
  return reviewSessionUrl(lock)
}

function defaultClearLock(lock: ServerLock): void {
  removeServerSession(lock)
}

function pidAlive(
  pid: number,
  kill: (pid: number, signal?: NodeJS.Signals | number) => boolean,
): boolean {
  try {
    kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Gracefully stop the process that owns `lock`, then clear a matching lockfile.
 * SIGTERM → wait → SIGKILL → wait → throw.
 */
export async function stopLockOwner(
  lock: ServerLock,
  options: StopLockOwnerOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const killDeadlineMs = options.killDeadlineMs ?? 2_000
  const pollMs = options.pollMs ?? 100
  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal))
  const sleep = options.sleep ?? sleepMs
  const now = options.now ?? Date.now
  const isAlive =
    options.isAlive ??
    ((candidate) => pidAlive(candidate.pid, kill))
  const clearLock = options.clearLock ?? defaultClearLock
  const lockMatches =
    options.lockMatches ?? ((candidate) => probeLockServerSync(candidate))

  if (!isAlive(lock)) {
    clearLock(lock)
    return
  }

  const matches = await lockMatches(lock)
  if (!matches) {
    throw new Error(
      `Diffing pid ${lock.pid} is still running, but its review API did not answer. ` +
        'Refusing to signal a process that cannot be verified; retry shortly or end that pid manually.',
    )
  }

  try {
    kill(lock.pid, 'SIGTERM')
  } catch {
    // Process may have exited between the alive check and the signal.
  }

  const termDeadline = now() + timeoutMs
  while (now() < termDeadline) {
    if (!isAlive(lock)) {
      clearLock(lock)
      return
    }
    await sleep(pollMs)
  }

  try {
    kill(lock.pid, 'SIGKILL')
  } catch {
    // Already gone.
  }

  const killDeadline = now() + killDeadlineMs
  while (now() < killDeadline) {
    if (!isAlive(lock)) {
      clearLock(lock)
      return
    }
    await sleep(pollMs)
  }

  throw new Error(
    `Timed out waiting for diffing pid ${lock.pid} to exit after SIGTERM/SIGKILL. ` +
      'End that process manually and try again.',
  )
}

/** Print and optionally open the existing web/gh-pr session; message-only for TUI. */
export async function openExistingSession(
  lock: ServerLock,
  options: OpenExistingSessionOptions,
): Promise<void> {
  const mode = lock.mode ?? 'web'
  if (mode === 'tui') {
    console.log(
      `A diffing TUI session is already open for this repository (pid ${lock.pid}). ` +
        'Use that terminal, or replace it with --replace-session.',
    )
    return
  }

  const probeUi = options.probeUi ?? probeLockReviewUiSync
  if (!probeUi(lock)) {
    throw new Error(
      `The diffing API on port ${lock.port} is alive, but its review UI is unavailable. ` +
        'The client bundle may be missing or mid-rebuild; rebuild it or restart the session, then retry.',
    )
  }

  const url = existingSessionUrl(lock)
  if (!url) {
    console.log(`A diffing review is already running for this repository (pid ${lock.pid}).`)
    return
  }

  console.log(`Opening existing diffing session at ${url}`)
  if (options.noOpen) return

  if (options.openUrl) {
    await options.openUrl(url)
    return
  }

  try {
    const settings = loadSettings()
    const openModule = await import('open')
    let appName: string | readonly string[] | undefined
    if (settings.browser) {
      const apps = openModule.apps as Record<string, string | readonly string[]>
      appName = apps[settings.browser] || settings.browser
    }
    const openOptions = appName ? { app: { name: appName } } : {}
    await openModule.default(url, openOptions)
  } catch (err) {
    console.error('Failed to open browser:', err instanceof Error ? err.message : err)
  }
}
