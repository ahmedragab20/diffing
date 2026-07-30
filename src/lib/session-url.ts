import type { ServerLock } from './server-lock.js'
import { isLoopbackHost, SESSION_TOKEN_QUERY } from './server-auth.js'

/** Loopback-safe review URL for web / gh-pr locks; null for TUI or invalid ports. */
export function reviewSessionBaseUrl(lock: ServerLock): string | null {
  if ((lock.mode ?? 'web') === 'tui' || !(lock.port > 0)) return null
  if (!isLoopbackHost(lock.host) && lock.host !== '0.0.0.0' && lock.host !== '::') return null
  const host = lock.host === '0.0.0.0' || lock.host === '::' ? '127.0.0.1' : lock.host
  const path = lock.mode === 'gh-pr' ? '/gh/pr' : ''
  return `http://${host}:${lock.port}${path}`
}

/** Browseable review URL without auth query params (auth uses cookie + header). */
export function appendSessionToken(url: string, _token?: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete(SESSION_TOKEN_QUERY)
    const search = parsed.searchParams.toString()
    return `${parsed.origin}${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash}`
  } catch {
    return url
  }
}

/** Public review URL for humans (no `?token=` — session cookie is set when HTML is served). */
export function reviewSessionUrl(lock: ServerLock): string | null {
  const base = reviewSessionBaseUrl(lock)
  if (!base) return null
  return base
}

/** Join an API path to a session base URL (origin only; strips any legacy `?token=`). */
export function joinSessionApiUrl(base: string, path: string): string {
  const origin = new URL(base).origin
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${origin}${normalized}`
}
