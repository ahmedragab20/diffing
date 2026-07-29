import {
  removeServerSession,
  type ServerLock,
} from './server-lock.js'
import { loadSettings } from './settings.js'

export interface StopLockOwnerOptions {
  timeoutMs?: number
  killDeadlineMs?: number
  pollMs?: number
  kill?: (pid: number, signal?: NodeJS.Signals | number) => boolean
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  isAlive?: (lock: ServerLock) => boolean
  clearLock?: (lock: ServerLock) => void
}

export interface OpenExistingSessionOptions {
  noOpen: boolean
  /** Injectable browser opener; defaults to the `open` package. */
  openUrl?: (url: string) => Promise<unknown>
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Loopback-safe review URL for web / gh-pr locks; null for TUI or invalid ports. */
export function existingSessionUrl(lock: ServerLock): string | null {
  const mode = lock.mode ?? 'web'
  if (mode === 'tui' || !(lock.port > 0)) return null
  const host = lock.host === '0.0.0.0' ? '127.0.0.1' : lock.host
  const path = mode === 'gh-pr' ? '/gh/pr' : ''
  return `http://${host}:${lock.port}${path}`
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

  if (!isAlive(lock)) {
    clearLock(lock)
    return
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
