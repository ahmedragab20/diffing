import { SESSION_TOKEN_HEADER, SESSION_TOKEN_QUERY } from '../lib/server-auth.js'

let sessionToken: string | null = null
let installed = false

function readTokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(SESSION_TOKEN_QUERY)
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

/** Attach the review session token from the page URL to fetch and EventSource. */
export function installSessionAuth(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  sessionToken = readTokenFromLocation()
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
