// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const lock = vi.hoisted(() => ({ mode: 'web' as 'web' | 'tui' }))
vi.mock('../lib/server-lock.js', () => ({
  resolveActiveServerLock: () => ({ host: '127.0.0.1', port: 43123, mode: lock.mode }),
}))
import { runSubcommand, validateInspectSelectors } from '../cli-agent.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  lock.mode = 'web'
})

describe('inspect CLI selectors', () => {
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

  it('rejects conflicting continuation flags, other operations and native sessions before fetching', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const args of [
      ['files', '--continuation', 'token', '--path', 'src/**'],
      ['files', '--continuation', 'token', '--cursor', '0'],
      ['summary', '--continuation', 'token'],
    ]) expect(await runSubcommand('inspect', args)).not.toBe(0)
    lock.mode = 'tui'
    expect(await runSubcommand('inspect', ['files', '--continuation', 'token'])).not.toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})
