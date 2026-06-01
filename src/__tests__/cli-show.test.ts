// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
}).trim()

const CLI = join(REPO_ROOT, 'src', 'cli.ts')
const RUNNER = join(REPO_ROOT, 'node_modules', '.bin', 'tsx')

// Self-contained git repo so tests don't depend on the developer's working
// tree. Seeded with a few commits to exercise single-rev, range, and pathspec
// cases.
const SANDBOX = mkdtempSync(join(tmpdir(), 'diffing-cli-show-'))

beforeAll(() => {
  execFileSync('git', ['init', '-q', '-b', 'main', SANDBOX], { stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: SANDBOX })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: SANDBOX })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: SANDBOX })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: SANDBOX })

  mkdirSync(join(SANDBOX, 'src'), { recursive: true })
  writeFileSync(join(SANDBOX, 'src', 'a.txt'), 'one\n')
  execFileSync('git', ['add', '.'], { cwd: SANDBOX })
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: SANDBOX })

  writeFileSync(join(SANDBOX, 'src', 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(SANDBOX, 'src', 'b.txt'), 'new file\n')
  execFileSync('git', ['add', '.'], { cwd: SANDBOX })
  execFileSync('git', ['commit', '-q', '-m', 'second commit'], { cwd: SANDBOX })

  writeFileSync(join(SANDBOX, 'src', 'a.txt'), 'one\ntwo\nthree\n')
  execFileSync('git', ['add', '.'], { cwd: SANDBOX })
  execFileSync('git', ['commit', '-q', '-m', 'third commit'], { cwd: SANDBOX })
})

afterAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true })
})

function runCli(args: string[], opts: { env?: Record<string, string>; timeout?: number } = {}) {
  return spawnSync(RUNNER, [CLI, ...args], {
    cwd: SANDBOX,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: opts.timeout ?? 30_000,
    env: { ...process.env, ...opts.env },
  })
}

function runGitShow(args: string[]): string {
  return execFileSync('git', ['--no-pager', 'show', '--no-color', '--no-ext-diff', ...args], {
    cwd: SANDBOX,
    encoding: 'utf-8',
  })
}

describe('diffing show subcommand (CLI plumbing)', () => {
  it('prints the same diff as `git show` in terminal mode', () => {
    const ours = runCli(['show', 'HEAD', '--terminal'])
    const theirs = runGitShow(['HEAD'])

    expect(ours.status).toBe(0)
    expect(ours.stdout).toBe(theirs)
  })

  it('prints the same diff as `git show HEAD~1..HEAD` in terminal mode', () => {
    const ours = runCli(['show', 'HEAD~1..HEAD', '--terminal'])
    const theirs = runGitShow(['HEAD~1..HEAD'])

    expect(ours.status).toBe(0)
    expect(ours.stdout).toBe(theirs)
  })

  it('forwards pathspecs to `git show`', () => {
    const ours = runCli(['show', 'HEAD', '--', 'src/a.txt', '--terminal'])
    const theirs = runGitShow(['HEAD', '--', 'src/a.txt'])

    expect(ours.status).toBe(0)
    expect(ours.stdout).toBe(theirs)
  })

  it('exits non-zero for an invalid revspec', () => {
    const ours = runCli(['show', 'definitely-not-a-real-rev', '--terminal'])
    expect(ours.status).not.toBe(0)
  })

  it('exits 5 (usage) when no revspec is provided', () => {
    const ours = runCli(['show'])
    expect(ours.status).toBe(5)
    expect(ours.stderr).toMatch(/usage/i)
  })

  it('parses a multi-rev invocation into a range (oldest-first)', () => {
    const ours = runCli(['show', 'HEAD~1', 'HEAD', '--terminal'])
    const theirs = runGitShow(['HEAD~1', 'HEAD'])

    expect(ours.status).toBe(0)
    expect(ours.stdout).toBe(theirs)
    // Sanity: the terminal output should mention both subject lines.
    expect(ours.stdout).toContain('second commit')
    expect(ours.stdout).toContain('third commit')
  })

  it('does not require --terminal but defaults to starting a server', () => {
    // Without --terminal, `diffing show HEAD` starts the server, which binds a
    // port. We give it a very short window to either bind or fail so the test
    // does not hang. We only care that invocation did not error out on arg
    // parsing.
    const ours = runCli(['show', 'HEAD', '--no-open', '--no-web'], { timeout: 4_000 })
    // `--no-web` is supported in the show subcommand path because the server
    // is the default. If the flag plumbing is wrong the process exits with a
    // usage error and writes a non-empty stderr.
    expect(ours.stderr).toBe('')
  })
})
