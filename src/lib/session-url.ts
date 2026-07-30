import type { ServerLock } from './server-lock.js'
import { isLoopbackHost } from './server-auth.js'

/** Loopback-safe review URL for web / gh-pr locks; null for TUI or invalid ports. */
export function reviewSessionBaseUrl(lock: ServerLock): string | null {
  if ((lock.mode ?? 'web') === 'tui' || !(lock.port > 0)) return null
  if (!isLoopbackHost(lock.host) && lock.host !== '0.0.0.0' && lock.host !== '::') return null
  const host = lock.host === '0.0.0.0' || lock.host === '::' ? '127.0.0.1' : lock.host
  const path = lock.mode === 'gh-pr' ? '/gh/pr' : ''
  return `http://${host}:${lock.port}${path}`
}

export function appendSessionToken(url: string, token?: string): string {
  if (!token) return url
  const parsed = new URL(url)
  parsed.searchParams.set('token', token)
  return parsed.toString()
}

/** Public review URL including the session token when one is configured. */
export function reviewSessionUrl(lock: ServerLock): string | null {
  const base = reviewSessionBaseUrl(lock)
  if (!base) return null
  return appendSessionToken(base, lock.authToken)
}
