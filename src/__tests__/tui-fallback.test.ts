// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
}).trim()

const CLI = join(REPO_ROOT, 'src', 'cli.ts')
const RUNNER = join(REPO_ROOT, 'node_modules', '.bin', 'tsx')

// We need a self-contained git repo for the fallback test, so the run does
// not depend on whatever uncommitted changes the developer happens to have in
// the diffing working tree. Use a temp dir with one seeded commit.
const SANDBOX = mkdtempSync(join(tmpdir(), 'diffing-tui-fallback-'))

beforeAll(() => {
  execFileSync('git', ['init', '-q', '-b', 'main', SANDBOX], { stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: SANDBOX })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: SANDBOX })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: SANDBOX })
  mkdirSync(join(SANDBOX, 'src'), { recursive: true })
  writeFileSync(join(SANDBOX, 'src', 'a.txt'), 'one\n')
  execFileSync('git', ['add', '.'], { cwd: SANDBOX })
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: SANDBOX })
  // Now mutate so `git diff` is non-empty.
  writeFileSync(join(SANDBOX, 'src', 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(SANDBOX, 'src', 'b.txt'), 'new file\n')
})

afterAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true })
})

function runCli(args: string[]) {
  return spawnSync(RUNNER, [CLI, ...args], {
    cwd: SANDBOX,
    encoding: 'utf-8',
    // Force piped stdio so isTTY is false in the child.
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  })
}

function runGitDiff(): string {
  // Mirror the CLI's `runTerminalDiff` defaults: --no-color and --no-ext-diff
  // so the user's local git config (e.g. `diff.external=difftastic`) does
  // not change the output format and break the byte-for-byte comparison.
  return execFileSync('git', ['diff', '--no-color', '--no-ext-diff'], {
    cwd: SANDBOX,
    encoding: 'utf-8',
  })
}

describe('TUI fallback (no TTY)', () => {
  it('falls back to git diff when --tui is passed in a non-TTY', () => {
    const result = runCli(['--tui'])
    expect(result.status).toBe(0)
    // The TUI's stderr line should announce the fallback.
    expect(result.stderr).toContain('diffing --tui requires a TTY')
    // And stdout should equal the default git diff output.
    expect(result.stdout).toBe(runGitDiff())
  })

  it('does not change `diffing` (no flag) output in a non-TTY', () => {
    const result = runCli([])
    expect(result.status).toBe(0)
    // No fallback message — terminal mode is the default and just runs.
    expect(result.stderr).not.toContain('diffing --tui requires a TTY')
    expect(result.stdout).toBe(runGitDiff())
  })

  it('--tui with --staged also falls back to git diff', () => {
    execFileSync('git', ['add', '.'], { cwd: SANDBOX })
    const result = runCli(['--tui', '--staged'])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('diffing --tui requires a TTY')
    // Staged diff includes both the modified and the new file.
    expect(result.stdout).toContain('b.txt')
    execFileSync('git', ['reset', '-q'], { cwd: SANDBOX })
  })
})
