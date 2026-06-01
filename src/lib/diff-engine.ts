import { execFileSync } from 'node:child_process'
import type { DiffOptions } from './diff-options.js'
import { buildGitDiffArgs } from './diff-options.js'
import {
  isGitRepo,
  getRepoName,
  getBranchName,
  getGitDiff,
  getCustomGitDiff,
  getGitDiffAsync,
  getCustomGitDiffAsync,
  getUntrackedFilePathsAsync,
  getTabSizeForFiles,
  getShowDiff,
  type CommitInfo,
} from './git.js'

const MAX_BUFFER = 50 * 1024 * 1024

export interface DiffResult {
  patch: string
  binaryFiles: BinaryFileInfo[]
  filePaths: string[]
  tabSizeMap: Record<string, number>
  untrackedFiles: string[]
  /** Populated only when `opts.showMode` is true. */
  commits?: CommitInfo[]
  /** Number of commits dropped past the show-mode cap. */
  truncated?: number
}

export interface DiffMeta {
  repoName: string
  branch: string
}

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

/**
 * Determine whether to use the "standard" web mode (unstaged+staged+untracked)
 * or a "custom" mode (specific revisions / pathspecs).
 *
 * Custom mode is used when the user provides explicit revisions or pathspecs
 * beyond just toggling staged/untracked. `showMode` is *also* a custom mode
 * — the "Show staged / Show untracked" toggles don't apply to a commit view.
 */
function isCustomMode(opts: DiffOptions): boolean {
  return opts.revisions.length > 0 || opts.pathspecs.length > 0 || opts.showMode
}

function parseFilePaths(patch: string): string[] {
  const paths = new Set<string>()
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/)
    if (match) paths.add(match[1])
  }
  return [...paths]
}

function parseBinaryFiles(patch: string, untrackedFiles?: Set<string>): BinaryFileInfo[] {
  const binaryFiles: BinaryFileInfo[] = []
  const lines = patch.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('Binary files ') || !line.includes(' differ')) continue

    let filePath = ''
    for (let j = i - 1; j >= 0; j--) {
      const match = lines[j].match(/^diff --git a\/.+ b\/(.+)$/)
      if (match) {
        filePath = match[1]
        break
      }
    }
    if (!filePath) continue

    let changeType: BinaryFileInfo['type'] = 'changed'
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].startsWith('diff --git')) break
      if (lines[j].startsWith('new file mode')) {
        changeType = 'added'
        break
      }
      if (lines[j].startsWith('deleted file mode')) {
        changeType = 'deleted'
        break
      }
    }

    if (changeType === 'added' && untrackedFiles?.has(filePath)) {
      changeType = 'untracked'
    }
    binaryFiles.push({ path: filePath, type: changeType })
  }
  return binaryFiles
}

/**
 * Execute a diff synchronously.
 */
export function executeDiff(opts: DiffOptions): { patch: string; args: string[] } {
  if (isCustomMode(opts)) {
    const args = buildGitDiffArgs(opts)
    const patch = getCustomGitDiff(args)
    return { patch, args }
  }

  const patch = getGitDiff({
    staged: opts.staged,
    untracked: opts.includeUntracked,
  })
  return { patch, args: [] }
}

/**
 * Execute a diff asynchronously — used by the server.
 *
 * Show mode bypasses the normal `git diff` path entirely: it resolves
 * revspecs to a commit list and fetches per-commit metadata + patches in
 * one `git log` call. The concatenated patch is returned in the same shape
 * the existing UI pipeline expects (so file tree, binary detection, and
 * tab-size detection all keep working unchanged); the per-commit data
 * rides along on `commits` for the metadata banners.
 */
export async function executeDiffAsync(opts: DiffOptions): Promise<{
  patch: string
  args: string[]
  commits?: CommitInfo[]
  truncated?: number
}> {
  if (opts.showMode) {
    const { commits, patch, truncated } = await getShowDiff(opts.showRevspecs, opts.pathspecs)
    return { patch, args: [], commits, truncated }
  }

  if (isCustomMode(opts)) {
    const args = buildGitDiffArgs(opts)
    const patch = await getCustomGitDiffAsync(args)
    return { patch, args }
  }

  const patch = await getGitDiffAsync({
    staged: opts.staged,
    untracked: opts.includeUntracked,
  })
  return { patch, args: [] }
}

/**
 * Execute a diff and produce the full enriched result used by the web API.
 */
export async function executeDiffWithMeta(opts: DiffOptions): Promise<DiffResult & DiffMeta> {
  const { patch, commits, truncated } = await executeDiffAsync(opts)

  const repoName = getRepoName()
  const branch = getBranchName()
  const untrackedFiles = opts.includeUntracked && !opts.showMode
    ? await getUntrackedFilePathsAsync()
    : []

  const untrackedSet = new Set(untrackedFiles)
  const binaryFiles = parseBinaryFiles(patch, untrackedSet)
  const filePaths = parseFilePaths(patch)
  const tabSizeMap = getTabSizeForFiles(filePaths)

  return {
    patch,
    binaryFiles,
    filePaths,
    tabSizeMap,
    untrackedFiles,
    repoName,
    branch,
    ...(commits ? { commits } : {}),
    ...(truncated ? { truncated } : {}),
  }
}

/**
 * Run the diff in terminal mode: forward to git diff with full flags,
 * output to stdout. Behaves identically to `git diff`. In show mode this
 * delegates to `git show` instead so `diffing show <rev>... --terminal`
 * is a drop-in for `git show <rev>...`.
 */
export function runTerminalDiff(opts: DiffOptions): number {
  if (opts.showMode) {
    return runTerminalShow(opts)
  }

  const args = buildGitDiffArgs(opts)

  // --no-ext-diff and --no-color are currently always enforced to ensure
  // a standard unified diff regardless of user's git config.
  // In terminal mode however, we want to respect the user's request,
  // so we only add these if the user hasn't explicitly overridden them.
  const enforceDefaults = !opts.outputFormat && !opts.quiet

  const finalArgs: string[] = []
  if (enforceDefaults) {
    if (!args.includes('--no-ext-diff') && !opts.extDiff) {
      finalArgs.push('--no-ext-diff')
    }
  }
  finalArgs.push(...args)

  try {
    const result = execFileSync(
      'git',
      ['diff', ...finalArgs],
      { encoding: 'utf-8', maxBuffer: MAX_BUFFER, stdio: 'inherit' },
    )
    return 0
  } catch (err: any) {
    // --exit-code causes git diff to exit with 1 if diffs exist
    if (err.status === 1 && opts.exitCode) {
      return 1
    }
    // git diff writes to stderr on error; just propagate exit code
    return err.status ?? 1
  }
}

/**
 * Terminal mode for `diffing show`: spawn `git show` with the user's revspecs
 * and pathspecs, inherit stdio, propagate exit code. We pass `--no-ext-diff`
 * so the output is a clean unified diff regardless of the user's git config
 * (matches the web-mode pipeline), but otherwise hand everything to git.
 */
function runTerminalShow(opts: DiffOptions): number {
  const args = ['show', '--no-ext-diff', ...opts.showRevspecs]
  if (opts.pathspecs.length > 0) {
    args.push('--', ...opts.pathspecs)
  }
  try {
    execFileSync('git', args, { encoding: 'utf-8', maxBuffer: MAX_BUFFER, stdio: 'inherit' })
    return 0
  } catch (err: any) {
    return err.status ?? 1
  }
}

/**
 * Validate the environment: check that we're in a git repo.
 * Returns an error message or null.
 */
export function validateEnvironment(): string | null {
  if (!isGitRepo()) {
    return 'Error: not inside a git repository'
  }
  return null
}
