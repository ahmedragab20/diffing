import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getProjectStorageDir, getRepoRoot } from './git.js'

/**
 * A tiny lockfile (`server.json`) written into the per-repo storage dir when a
 * diffit web server starts. It lets the `diffit` CLI subcommands and the MCP
 * server discover the running server's port with zero user input — they resolve
 * the same per-repo directory from the cwd and read this file. Stale locks (from
 * a crashed server) self-heal via `isLockAlive`.
 */
export interface ServerLock {
  port: number
  host: string
  pid: number
  repoRoot: string
  startedAt: number
  version: string
}

export function lockPath(repoRoot?: string): string {
  return join(getProjectStorageDir(repoRoot), 'server.json')
}

export function writeServerLock(lock: ServerLock): void {
  const path = lockPath(lock.repoRoot)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(lock, null, 2), 'utf-8')
}

export function readServerLock(repoRoot?: string): ServerLock | null {
  try {
    const raw = readFileSync(lockPath(repoRoot), 'utf-8')
    const lock = JSON.parse(raw) as ServerLock
    if (typeof lock.port !== 'number' || typeof lock.pid !== 'number') return null
    return lock
  } catch {
    return null
  }
}

/**
 * True if the process named by the lock is still alive and the lock belongs to
 * this repo. `process.kill(pid, 0)` sends no signal — it just probes existence.
 */
export function isLockAlive(lock: ServerLock): boolean {
  try {
    process.kill(lock.pid, 0)
  } catch {
    return false
  }
  try {
    return lock.repoRoot === getRepoRoot()
  } catch {
    return true
  }
}

export function removeServerLock(repoRoot?: string): void {
  try {
    rmSync(lockPath(repoRoot), { force: true })
  } catch {
    // best-effort cleanup
  }
}
