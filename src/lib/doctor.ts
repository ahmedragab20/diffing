/**
 * `diffing doctor` — diagnostic checks for a healthy local review setup.
 * Pure-ish helpers so the CLI can print a clean report without side effects
 * beyond read-only probes.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { isLockAlive, readServerLock } from './server-lock.js'
import { detectGhCli, readGithubToken } from './github.js'
import { getSearchStatus } from './search.js'
import { findTuiBinary } from './find-tui-binary.js'
import { loadSettings } from './settings.js'

export type DoctorLevel = 'ok' | 'warn' | 'error'

export interface DoctorCheck {
  id: string
  label: string
  level: DoctorLevel
  detail: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
  ok: boolean
}

function tryGitTopLevel(cwd: string): string | null {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

export async function runDoctor(options: {
  cwd?: string
  /** import.meta.url of the CLI for TUI binary discovery */
  cliImportMetaUrl?: string
}): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd()
  const checks: DoctorCheck[] = []

  // Git repo
  const repoRoot = tryGitTopLevel(cwd)
  if (repoRoot) {
    checks.push({
      id: 'git',
      label: 'Git repository',
      level: 'ok',
      detail: repoRoot,
    })
  } else {
    checks.push({
      id: 'git',
      label: 'Git repository',
      level: 'error',
      detail: `${cwd} is not inside a Git repository`,
    })
  }

  // Server lock
  if (repoRoot) {
    const lock = readServerLock(repoRoot)
    if (!lock) {
      checks.push({
        id: 'server',
        label: 'Review server',
        level: 'warn',
        detail: 'No active server lock (run `diffing` to start one)',
      })
    } else if (!isLockAlive(lock, repoRoot)) {
      checks.push({
        id: 'server',
        label: 'Review server',
        level: 'warn',
        detail: `Stale lock for pid ${lock.pid} — will be replaced on next start`,
      })
    } else {
      const url =
        lock.port > 0 ? `http://${lock.host}:${lock.port}` : `mode=${lock.mode ?? 'web'}`
      checks.push({
        id: 'server',
        label: 'Review server',
        level: 'ok',
        detail: `${url} (pid ${lock.pid}, mode ${lock.mode ?? 'web'})`,
      })
    }
  }

  // gh auth
  try {
    const gh = await detectGhCli()
    if (gh.available && gh.authenticated) {
      checks.push({
        id: 'gh',
        label: 'GitHub CLI (gh)',
        level: 'ok',
        detail: gh.user ? `authenticated as ${gh.user}` : 'authenticated',
      })
    } else if (gh.available) {
      const token = readGithubToken()
      checks.push({
        id: 'gh',
        label: 'GitHub CLI (gh)',
        level: token ? 'warn' : 'warn',
        detail: token
          ? 'gh present but not authenticated; $GITHUB_TOKEN is set (token fallback for submit)'
          : 'gh present but not authenticated — run `gh auth login` for PR mode',
      })
    } else {
      const token = readGithubToken()
      checks.push({
        id: 'gh',
        label: 'GitHub CLI (gh)',
        level: token ? 'warn' : 'warn',
        detail: token
          ? 'gh not found; $GITHUB_TOKEN is set (submit-only token path)'
          : 'gh not found and no $GITHUB_TOKEN — PR mode unavailable',
      })
    }
  } catch (err: any) {
    checks.push({
      id: 'gh',
      label: 'GitHub CLI (gh)',
      level: 'warn',
      detail: err?.message ?? 'failed to probe gh',
    })
  }

  // Search engine
  try {
    const status = await getSearchStatus()
    if (status.available) {
      checks.push({
        id: 'search',
        label: 'Native search (fff)',
        level: 'ok',
        detail: status.indexedFiles != null
          ? `available · ~${status.indexedFiles} indexed files`
          : 'available',
      })
    } else {
      checks.push({
        id: 'search',
        label: 'Native search (fff)',
        level: 'warn',
        detail: status.error || 'unavailable on this platform (graceful degradation)',
      })
    }
  } catch (err: any) {
    checks.push({
      id: 'search',
      label: 'Native search (fff)',
      level: 'warn',
      detail: err?.message ?? 'probe failed',
    })
  }

  // TUI binary (report-only; TUI is experimental)
  const tuiPath = options.cliImportMetaUrl
    ? findTuiBinary(options.cliImportMetaUrl)
    : findTuiBinary(import.meta.url)
  checks.push({
    id: 'tui',
    label: 'TUI binary',
    level: tuiPath ? 'ok' : 'warn',
    detail: tuiPath ?? 'not found (optional — web UI is the supported path)',
  })

  // Settings parse
  try {
    const settings = loadSettings()
    checks.push({
      id: 'settings',
      label: 'User settings',
      level: 'ok',
      detail: `theme=${settings.theme} density=${settings.density} · ${join(homedir(), '.config', 'diffing', 'settings.json')}`,
    })
  } catch (err: any) {
    checks.push({
      id: 'settings',
      label: 'User settings',
      level: 'error',
      detail: err?.message ?? 'failed to load settings.json',
    })
  }

  // Storage dir writable?
  if (repoRoot) {
    try {
      const { getProjectStorageDir } = await import('./git.js')
      const dir = getProjectStorageDir()
      const marker = join(dir, 'repo_path.txt')
      if (existsSync(marker)) {
        const recorded = readFileSync(marker, 'utf-8').trim()
        checks.push({
          id: 'storage',
          label: 'Project storage',
          level: 'ok',
          detail: `${dir} (repo_path=${recorded || 'n/a'})`,
        })
      } else {
        checks.push({
          id: 'storage',
          label: 'Project storage',
          level: 'ok',
          detail: `${dir} (will be created on first use)`,
        })
      }
    } catch (err: any) {
      checks.push({
        id: 'storage',
        label: 'Project storage',
        level: 'warn',
        detail: err?.message ?? 'could not resolve storage dir',
      })
    }
  }

  const ok = !checks.some((c) => c.level === 'error')
  return { checks, ok }
}

export function formatDoctorReport(report: DoctorReport): string {
  const icon = (level: DoctorLevel) =>
    level === 'ok' ? '✓' : level === 'warn' ? '!' : '✗'
  const lines = ['diffing doctor', '─────────────']
  for (const c of report.checks) {
    lines.push(`${icon(c.level)} ${c.label}`)
    lines.push(`  ${c.detail}`)
  }
  lines.push('')
  lines.push(report.ok ? 'Overall: OK' : 'Overall: issues found (see errors above)')
  return lines.join('\n')
}
