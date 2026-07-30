import { randomBytes } from 'node:crypto'
import type { Context, Next } from 'hono'

/** Header or query param carrying the per-session review API token. */
export const SESSION_TOKEN_HEADER = 'x-diffing-token'
export const SESSION_TOKEN_QUERY = 'token'

export interface ServerAuthConfig {
  bindHost: string
  authToken: string | null
  /** When true, `/api/*` routes accept requests without a token (LAN exposure only). */
  insecureNoAuth?: boolean
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase()
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true
  const octets = normalized.split('.')
  return octets.length === 4 && octets[0] === '127' && octets.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

export function isWildcardBindHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized === '0.0.0.0' || normalized === '::'
}

function requestHostHeader(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null
  const trimmed = hostHeader.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? trimmed.toLowerCase() : trimmed.slice(1, end).toLowerCase()
  }
  return trimmed.split(':')[0].toLowerCase()
}

/** Reject non-loopback Host headers when the server binds loopback (DNS rebinding guard). */
export function isAllowedRequestHost(hostHeader: string | undefined, bindHost: string): boolean {
  if (!isLoopbackHost(bindHost)) return true
  const host = requestHostHeader(hostHeader)
  if (!host) return true
  return isLoopbackHost(host)
}

export function readSessionToken(c: Context): string | null {
  const header = c.req.header(SESSION_TOKEN_HEADER)
  if (header) return header
  const query = c.req.query(SESSION_TOKEN_QUERY)
  return query || null
}

export function createServerAuthMiddleware(config: ServerAuthConfig) {
  return async (c: Context, next: Next) => {
    if (!c.req.path.startsWith('/api/')) {
      await next()
      return
    }

    if (!isAllowedRequestHost(c.req.header('host'), config.bindHost)) {
      return c.json({ error: 'request Host header is not allowed for this bind address' }, 403)
    }

    if (!config.insecureNoAuth && config.authToken) {
      const provided = readSessionToken(c)
      if (provided !== config.authToken) {
        return c.json({ error: 'invalid or missing review session token' }, 401)
      }
    }

    await next()
  }
}
