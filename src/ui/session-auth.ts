import { SESSION_TOKEN_HEADER, SESSION_TOKEN_QUERY } from '../lib/server-auth.js'

const SESSION_STORAGE_KEY = 'diffing-session-token'

declare global {
  interface Window {
    __DIFFING_SESSION_TOKEN__?: string
  }
}

let sessionToken: string | null = null
let installed = false

function readTokenFromSessionStorage(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function resolveSessionToken(): string | null {
  return (typeof window !== 'undefined' ? window.__DIFFING_SESSION_TOKEN__ ?? null : null)
    ?? readTokenFromSessionStorage()
}

function persistSessionToken(token: string): void {
  sessionToken = token
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, token)
  } catch {
    /* ignore quota / private mode */
  }
}

/** Strip legacy `?token=` from the address bar; persist token for fetch headers. */
function migrateTokenFromAddressBar(): void {
  if (typeof window === 'undefined') return
  const parsed = new URL(window.location.href)
  const fromUrl = parsed.searchParams.get(SESSION_TOKEN_QUERY)
  if (!fromUrl) return
  persistSessionToken(fromUrl)
  parsed.searchParams.delete(SESSION_TOKEN_QUERY)
  const search = parsed.searchParams.toString()
  const clean = `${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash}`
  window.history.replaceState(null, '', clean)
}

function stripTokenFromPath(path: string): string {
  try {
    const parsed = new URL(path, window.location.origin)
    parsed.searchParams.delete(SESSION_TOKEN_QUERY)
    const search = parsed.searchParams.toString()
    return `${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash}`
  } catch {
    return path
  }
}

/** Legacy helper — browseable URLs never include `?token=`. */
export function sessionTokenQuerySuffix(): string {
  return ''
}

/** Normalize a client route path (strip legacy `?token=` if present). */
export function withSessionTokenPath(path: string): string {
  return stripTokenFromPath(path)
}

/** Attach the review session token to fetch (header + same-origin cookie). */
export function installSessionAuth(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  migrateTokenFromAddressBar()
  const resolved = resolveSessionToken()
  if (resolved) persistSessionToken(resolved)
  if (!sessionToken) return

  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    if (url.includes('/api/')) headers.set(SESSION_TOKEN_HEADER, sessionToken!)
    return originalFetch(input, { ...init, headers })
  }
}

export function liveEventSourceUrl(): string {
  return '/api/live'
}
