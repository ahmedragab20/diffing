import { SESSION_TOKEN_HEADER, SESSION_TOKEN_QUERY } from '../lib/server-auth.js'

const SESSION_STORAGE_KEY = 'diffing-session-token'

declare global {
  interface Window {
    __DIFFING_SESSION_TOKEN__?: string
  }
}

let sessionToken: string | null = null
let installed = false

function readTokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(SESSION_TOKEN_QUERY)
}

function readTokenFromSessionStorage(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function resolveSessionToken(): string | null {
  return readTokenFromLocation()
    ?? (typeof window !== 'undefined' ? window.__DIFFING_SESSION_TOKEN__ ?? null : null)
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

function withTokenQuery(url: string): string {
  if (!sessionToken) return url
  try {
    const parsed = new URL(url, window.location.origin)
    if (!parsed.pathname.startsWith('/api/')) return url
    if (!parsed.searchParams.has(SESSION_TOKEN_QUERY)) {
      parsed.searchParams.set(SESSION_TOKEN_QUERY, sessionToken)
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}

/** `?token=…` suffix when a session token is available (empty string otherwise). */
export function sessionTokenQuerySuffix(): string {
  if (!sessionToken) return ''
  return `?${SESSION_TOKEN_QUERY}=${encodeURIComponent(sessionToken)}`
}

/** Append the session token query param to a client route path when missing. */
export function withSessionTokenPath(path: string): string {
  if (!sessionToken) return path
  try {
    const parsed = new URL(path, window.location.origin)
    if (!parsed.searchParams.has(SESSION_TOKEN_QUERY)) {
      parsed.searchParams.set(SESSION_TOKEN_QUERY, sessionToken)
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return path
  }
}

/** Attach the review session token to fetch and EventSource. */
export function installSessionAuth(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const resolved = resolveSessionToken()
  if (resolved) persistSessionToken(resolved)
  if (!sessionToken) return

  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      const url = withTokenQuery(input)
      const headers = new Headers(init?.headers)
      if (url.startsWith('/api/')) headers.set(SESSION_TOKEN_HEADER, sessionToken!)
      return originalFetch(url, { ...init, headers })
    }
    if (input instanceof URL) {
      const url = withTokenQuery(input.toString())
      const headers = new Headers(init?.headers)
      if (url.includes('/api/')) headers.set(SESSION_TOKEN_HEADER, sessionToken!)
      return originalFetch(url, { ...init, headers })
    }
    const headers = new Headers(init?.headers)
    if (input.url.includes('/api/')) headers.set(SESSION_TOKEN_HEADER, sessionToken!)
    return originalFetch(input, { ...init, headers })
  }
}

export function liveEventSourceUrl(): string {
  if (!sessionToken) return '/api/live'
  return `/api/live?${SESSION_TOKEN_QUERY}=${encodeURIComponent(sessionToken)}`
}
