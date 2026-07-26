// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const CLI = join(REPO_ROOT, 'src', 'cli.ts')
const USER_HOME = mkdtempSync(join(tmpdir(), 'diffing-mode-'))

afterAll(() => {
  rmSync(USER_HOME, { recursive: true, force: true })
})

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, HOME: USER_HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  })
}

describe('diffing mode CLI', () => {
  it('persists and prints the user preference', () => {
    const set = runCli(['mode', 'tui'])
    expect(set.status).toBe(0)
    expect(set.stdout).toBe('Default mode set to tui.\n')

    const saved = JSON.parse(
      readFileSync(join(USER_HOME, '.config', 'diffing', 'settings.json'), 'utf-8'),
    )
    expect(saved.defaultMode).toBe('tui')

    const get = runCli(['mode'])
    expect(get.status).toBe(0)
    expect(get.stdout).toBe('tui\n')
  })

  it('rejects unsupported modes without overwriting the preference', () => {
    const result = runCli(['mode', 'terminal'])
    expect(result.status).toBe(5)
    expect(result.stderr).toContain('Usage: diffing mode <web|tui>')

    const get = runCli(['mode'])
    expect(get.stdout).toBe('tui\n')
  })
})
