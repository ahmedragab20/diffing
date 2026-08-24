import { spawnSync } from 'node:child_process'
import { SESSION_TOKEN_HEADER } from './server-auth.js'
import type { ServerLock } from './server-lock.js'

/** Map wildcard bind hosts to loopback for local probes. */
export function loopbackProbeHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  return host
}

/**
 * Synchronous loopback probe: GET `/api/review/status` and expect a JSON body
 * with a numeric `round` field. Used to detect stale locks after PID reuse.
 */
export function probeLockServerSync(lock: ServerLock): boolean {
  if (lock.port <= 0) return true

  const host = loopbackProbeHost(lock.host)
  const headers: Record<string, string> = {}
  if (lock.capability) headers['X-Diffing-Capability'] = lock.capability
  if (lock.authToken) headers[SESSION_TOKEN_HEADER] = lock.authToken

  const script = `
import http from 'node:http';
const host = ${JSON.stringify(host)};
const port = ${lock.port};
const headers = ${JSON.stringify(headers)};
const req = http.request({
  hostname: host,
  port,
  path: '/api/review/status',
  method: 'GET',
  headers,
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => { process.stdout.write(data); });
});
req.on('error', () => process.exit(2));
req.setTimeout(400, () => { req.destroy(); process.exit(2); });
req.end();
`

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    timeout: 900,
    encoding: 'utf8',
  })
  if (result.status !== 0) return false
  try {
    const body = JSON.parse(result.stdout.trim()) as { round?: unknown }
    return typeof body.round === 'number'
  } catch {
    return false
  }
}

export interface ReviewUiProbeResponse {
  status: number
  contentType: string
  body: string
}

export function isReviewUiProbeResponse(
  value: unknown,
): value is ReviewUiProbeResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Partial<ReviewUiProbeResponse>
  return response.status === 200 &&
    typeof response.contentType === 'string' &&
    response.contentType.toLowerCase().includes('text/html') &&
    typeof response.body === 'string' &&
    /<!doctype html|<html[\s>]/i.test(response.body)
}

/** Verify that a web/PR session can serve its human UI, not only its API. */
export function probeLockReviewUiSync(lock: ServerLock): boolean {
  if ((lock.mode ?? 'web') === 'tui' || lock.port <= 0) return true

  const host = loopbackProbeHost(lock.host)
  const headers: Record<string, string> = {}
  if (lock.authToken) headers[SESSION_TOKEN_HEADER] = lock.authToken
  const path = lock.mode === 'gh-pr' ? '/gh/pr' : '/'
  const script = `
import http from 'node:http';
const req = http.request({
  hostname: ${JSON.stringify(host)},
  port: ${lock.port},
  path: ${JSON.stringify(path)},
  method: 'GET',
  headers: ${JSON.stringify(headers)},
}, (res) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    if (body.length < 4096) body += chunk;
  });
  res.on('end', () => {
    process.stdout.write(JSON.stringify({
      status: res.statusCode ?? 0,
      contentType: String(res.headers['content-type'] ?? ''),
      body: body.slice(0, 4096),
    }));
  });
});
req.on('error', () => process.exit(2));
req.setTimeout(700, () => { req.destroy(); process.exit(2); });
req.end();
`

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    timeout: 1_200,
    encoding: 'utf8',
  })
  if (result.status !== 0) return false
  try {
    return isReviewUiProbeResponse(JSON.parse(result.stdout.trim()))
  } catch {
    return false
  }
}
