import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

export interface McpClientTarget {
  id: string
  label: string
  path: string
  scope: 'global' | 'project'
}

export interface McpConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>
}

export interface DiffingMcpEntry {
  command: string
  args: string[]
}

const DIFFING_SERVER_KEY = 'diffing'

export function buildDiffingMcpEntry(repoPath?: string): DiffingMcpEntry {
  if (repoPath) {
    return { command: 'diffing', args: ['mcp', '--repo', repoPath] }
  }
  return { command: 'diffing', args: ['mcp'] }
}

export function formatMcpSnippet(entry: DiffingMcpEntry): string {
  return JSON.stringify({ mcpServers: { [DIFFING_SERVER_KEY]: entry } }, null, 2)
}

export function detectGlobalMcpClients(home = homedir()): McpClientTarget[] {
  const clients: McpClientTarget[] = []
  const cursor = join(home, '.cursor', 'mcp.json')
  clients.push({
    id: 'cursor',
    label: 'Cursor',
    path: cursor,
    scope: 'global',
  })

  const claude = claudeDesktopConfigPath(home)
  if (claude) {
    clients.push({
      id: 'claude-desktop',
      label: 'Claude Desktop',
      path: claude,
      scope: 'global',
    })
  }
  return clients
}

export function projectMcpPath(cwd: string): string {
  return join(cwd, '.cursor', 'mcp.json')
}

function claudeDesktopConfigPath(home: string): string | null {
  const os = platform()
  if (os === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  if (os === 'win32') {
    const appData = process.env.APPDATA
    if (!appData) return null
    return join(appData, 'Claude', 'claude_desktop_config.json')
  }
  return join(home, '.config', 'Claude', 'claude_desktop_config.json')
}

export function readMcpConfig(path: string): McpConfig {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as McpConfig
  } catch {
    return {}
  }
}

/** Merge only `mcpServers.diffing`; preserve every other server and top-level key. */
export function mergeDiffingMcpConfig(existing: McpConfig, entry: DiffingMcpEntry): McpConfig {
  const servers = { ...(existing.mcpServers ?? {}) }
  servers[DIFFING_SERVER_KEY] = entry
  return { ...existing, mcpServers: servers }
}

export function backupMcpConfig(path: string, backupsRoot = join(homedir(), '.diffing', 'backups')): string | null {
  if (!existsSync(path)) return null
  mkdirSync(backupsRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeName = path.replaceAll(/[/\\:]/g, '_')
  const backupPath = join(backupsRoot, `${safeName}.${stamp}.json`)
  copyFileSync(path, backupPath)
  return backupPath
}

export interface WriteMcpResult {
  path: string
  written: boolean
  backupPath: string | null
  created: boolean
}

export function writeMcpConfig(
  target: McpClientTarget,
  entry: DiffingMcpEntry,
  options?: { dryRun?: boolean; backupsRoot?: string },
): WriteMcpResult {
  const existing = readMcpConfig(target.path)
  const merged = mergeDiffingMcpConfig(existing, entry)
  const created = !existsSync(target.path)
  if (options?.dryRun) {
    return { path: target.path, written: false, backupPath: null, created }
  }
  mkdirSync(join(target.path, '..'), { recursive: true })
  const backupPath = backupMcpConfig(target.path, options?.backupsRoot)
  writeFileSync(target.path, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8')
  return { path: target.path, written: true, backupPath, created }
}

export function writeGlobalMcpConfigs(
  entry: DiffingMcpEntry,
  options?: { dryRun?: boolean; backupsRoot?: string; home?: string },
): WriteMcpResult[] {
  return detectGlobalMcpClients(options?.home).map((target) =>
    writeMcpConfig(target, entry, options),
  )
}

export function writeProjectMcpConfig(
  cwd: string,
  entry: DiffingMcpEntry,
  options?: { dryRun?: boolean; backupsRoot?: string },
): WriteMcpResult {
  const target: McpClientTarget = {
    id: 'cursor-project',
    label: 'Cursor (project)',
    path: projectMcpPath(cwd),
    scope: 'project',
  }
  return writeMcpConfig(target, entry, options)
}
