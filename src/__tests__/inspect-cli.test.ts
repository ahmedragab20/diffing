// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const lock = vi.hoisted(() => ({ mode: 'web' as 'web' | 'tui' }))
vi.mock('../lib/server-lock.js', () => ({
  resolveActiveServerLock: () => ({ host: '127.0.0.1', port: 43123, mode: lock.mode, ...(lock.mode === 'tui' ? { capability: 'test-capability' } : {}) }),
}))
import { runSubcommand, validateInspectSelectors } from '../cli-agent.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  lock.mode = 'web'
})

describe('inspect CLI selectors', () => {
  it.each([[400, 'invalid_continuation'], [410, 'snapshot_expired']] as const)('preserves structured recovery for HTTP %s', async (status, code) => {
    const body = { error: 'Restart this inspection.', code, recovery: 'restart_files' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await runSubcommand('inspect', ['files', '--continuation', 'payload.signature'])).toBe(1)
    expect(output).not.toHaveBeenCalled()
    expect(JSON.parse(String(error.mock.calls[0][0]))).toEqual(body)
  })

  it('requires file or path for slice and hunks', () => {
    expect(validateInspectSelectors('slice')).toMatch(/--file or --path is required/)
    expect(validateInspectSelectors('hunks', '0')).toBeNull()
    expect(validateInspectSelectors('slice', undefined, 'src/a.ts')).toBeNull()
  })

  it('rejects file and path together for slice and hunks', () => {
    expect(validateInspectSelectors('slice', '0', 'src/a.ts')).toMatch(/mutually exclusive/)
    expect(validateInspectSelectors('files', '0', 'src/**')).toBeNull()
  })

  it('forwards a file continuation alone without injecting numeric defaults', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await runSubcommand('inspect', ['files', '--continuation', 'payload.signature'])).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:43123/api/diff/files?continuation=payload.signature')
  })

  it.each(['web', 'tui'] as const)('forwards retained reads in %s without requiring new selectors', async (mode) => {
    lock.mode = mode
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (mode === 'tui') expect(new Headers(init?.headers).get('X-Diffing-Capability')).toBe('test-capability')
      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const snapshot = '00000000-0000-4000-8000-000000000001'
    for (const operation of ['files', 'hunks', 'slice', 'search']) {
      expect(await runSubcommand('inspect', [operation, '--continuation', 'payload.signature'])).toBe(0)
      expect(fetch.mock.calls.at(-1)![0]).toBe(`http://127.0.0.1:43123/api/diff/${operation}?continuation=payload.signature`)
    }
    expect(await runSubcommand('inspect', ['slice', '--snapshot-id', snapshot, '--file', '0'])).toBe(0)
    expect(new URL(String(fetch.mock.calls.at(-1)![0])).searchParams.get('snapshotId')).toBe(snapshot)
  })

  it('rejects conflicting continuation flags and other operations before fetching', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const args of [
      ['files', '--continuation', 'token', '--path', 'src/**'],
      ['files', '--continuation', 'token', '--cursor', '0'],
      ['summary', '--continuation', 'token'],
      ['search', 'changed query', '--continuation', 'token'],
    ]) expect(await runSubcommand('inspect', args)).not.toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})
