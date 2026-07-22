import { createInterface } from 'node:readline'
import {
  readServerLock,
  removeServerLock,
  type ServerLock,
} from './server-lock.js'
import { loadSettings } from './settings.js'

export type SessionConflictAction = 'open' | 'replace' | 'cancel'

export interface ResolveSessionConflictOptions {
  lock: ServerLock
  reuseSession: boolean
  replaceSession: boolean
  canPrompt: boolean
  /** Injectable for tests. Defaults to the interactive readline prompt. */
  prompt?: (lock: ServerLock) => Promise<SessionConflictAction>
}

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

export function formatExistingSession(lock: ServerLock): string {
  const mode = lock.mode ?? 'web'
  const url = existingSessionUrl(lock)
  const lines = [
    'A diffing review is already running for this repository',
    url ? `  url:  ${url}` : '  url:  (TUI session — no browser URL)',
    `  mode: ${mode}`,
    `  pid:  ${lock.pid}`,
  ]
  return lines.join('\n')
}

export function conflictFailMessage(lock: ServerLock): string {
  const url = existingSessionUrl(lock)
  const existing = url ?? (lock.mode === 'tui' || lock.port <= 0 ? 'a TUI session' : `http://${lock.host}:${lock.port}`)
  return `A diffing review is already running for this repository at ${existing}. End it before starting another scope.`
}

/**
 * Resolve how to handle a live session conflict.
 * Flags win over the prompt; non-interactive callers get `cancel`.
 */
export async function resolveSessionConflictAction(
  options: ResolveSessionConflictOptions,
): Promise<SessionConflictAction> {
  if (options.reuseSession && options.replaceSession) {
    throw new Error('Cannot combine --reuse-session and --replace-session.')
  }
  if (options.reuseSession) return 'open'
  if (options.replaceSession) return 'replace'
  if (!options.canPrompt) return 'cancel'
  const prompt = options.prompt ?? promptSessionConflict
  return prompt(options.lock)
}

/**
 * Interactive o/r/c prompt. Empty input defaults to open. Ctrl+C → cancel.
 */
export async function promptSessionConflict(lock: ServerLock): Promise<SessionConflictAction> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    console.error(formatExistingSession(lock))
    console.error('')
    console.error('What do you want to do?')
    console.error('  [o] Open the existing session (default)')
    console.error(`  [r] Replace it (stop pid ${lock.pid}, start a new review)`)
    console.error('  [c] Cancel')
    console.error('')

    while (true) {
      const answer = await new Promise<string>((resolve, reject) => {
        const onSigInt = () => {
          cleanup()
          reject(new Error('cancelled'))
        }
        const cleanup = () => {
          process.off('SIGINT', onSigInt)
        }
        process.on('SIGINT', onSigInt)
        rl.question('Choice [o/r/c]: ', (raw) => {
          cleanup()
          resolve(raw)
        })
      })

      const choice = answer.trim().toLowerCase()
      if (choice === '' || choice === 'o' || choice === 'open') return 'open'
      if (choice === 'r' || choice === 'replace') return 'replace'
      if (choice === 'c' || choice === 'cancel' || choice === 'q' || choice === 'quit') {
        return 'cancel'
      }
      console.error('Please enter o, r, or c.')
    }
  } catch {
    return 'cancel'
  } finally {
    rl.close()
  }
}

function defaultClearLock(lock: ServerLock): void {
  const current = readServerLock(lock.repoRoot)
  if (current && current.pid === lock.pid) {
    removeServerLock(lock.repoRoot)
  }
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
