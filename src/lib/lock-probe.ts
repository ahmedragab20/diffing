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
