import { execFileSync, execFile } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { isSafePath } from './path.js'
import { parseSync as parseEditorConfig, type ProcessedFileConfig } from 'editorconfig'

const execFileAsync = promisify(execFile)

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
])

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function isBinaryFile(absolutePath: string): boolean {
  try {
    const buffer = readFileSync(absolutePath)
    const bytesToCheck = Math.min(buffer.length, 8192)
    for (let i = 0; i < bytesToCheck; i++) {
      if (buffer[i] === 0) return true
    }
    return false
  } catch {
    return true
  }
}

export function getFileContent(filePath: string, version: 'old' | 'new'): Buffer | null {
  const root = getRepoRoot()
  if (!isSafePath(filePath, root)) {
    return null
  }
  const resolved = resolve(root, filePath)
  if (version === 'new') {
    try {
      return readFileSync(resolved)
    } catch {
      return null
    }
  }
  // old version: try staged first, then HEAD
  try {
    return execFileSync('git', ['show', `HEAD:${filePath}`], { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 })
  } catch {
    return null
  }
}

let cachedRepoRoot: string | null = null
const editorConfigCache = new Map<string, ProcessedFileConfig>()

export function _resetRepoRootCache(): void {
  cachedRepoRoot = null
  editorConfigCache.clear()
}

export function isGitRepo(): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function getRepoRoot(): string {
  if (cachedRepoRoot !== null) return cachedRepoRoot
  cachedRepoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
  }).trim()
  return cachedRepoRoot
}

export function getRepoName(): string {
  return basename(getRepoRoot())
}

export function getBranchName(): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stdio: 'pipe', encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

// Force standard unified diff regardless of user's git config
// (e.g. diff.external = difftastic, color.ui = always).
const DIFF_FLAGS = ['--no-ext-diff', '--no-color'] as const

export function getCustomGitDiff(args: string[]): string {
  return execFileSync('git', ['diff', ...DIFF_FLAGS, ...args], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
}

export function getGitDiff(options: { staged?: boolean; untracked?: boolean } = {}): string {
  const parts: string[] = []

  // unstaged changes (always included as the base)
  const unstaged = execFileSync('git', ['diff', ...DIFF_FLAGS], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  if (unstaged) parts.push(unstaged)

  // staged changes
  if (options.staged) {
    const staged = execFileSync('git', ['diff', ...DIFF_FLAGS, '--staged'], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
    if (staged) parts.push(staged)
  }

  // untracked files
  if (options.untracked) {
    const untrackedPatch = getUntrackedFilesDiff()
    if (untrackedPatch) parts.push(untrackedPatch)
  }

  return parts.join('\n')
}

export function getTabSizeForFiles(filePaths: string[]): Record<string, number> {
  const root = getRepoRoot()
  const result: Record<string, number> = {}
  for (const filePath of filePaths) {
    try {
      const absPath = join(root, filePath)
      const config = parseEditorConfig(absPath, { cache: editorConfigCache })
      const size = config.tab_width ?? (config.indent_size === 'tab' ? undefined : config.indent_size)
      if (typeof size === 'number') {
        result[filePath] = size
      }
    } catch {
      // skip files that fail to resolve
    }
  }
  return result
}

export function getUntrackedFilePaths(): string[] {
  const output = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  }).trim()
  return output ? output.split('\n') : []
}

function getUntrackedFilesDiff(): string {
  const root = getRepoRoot()
  const output = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  }).trim()

  if (!output) return ''

  const files = output.split('\n')
  const patches: string[] = []

  for (const file of files) {
    const absolutePath = join(root, file)
    if (isBinaryFile(absolutePath)) {
      const patch = [
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        'index 0000000..0000001',
        `Binary files /dev/null and b/${file} differ`,
      ].join('\n')
      patches.push(patch)
    } else {
      try {
        const content = readFileSync(absolutePath, 'utf-8')
        const lines = content.split('\n')
        const diffLines = lines.map((l: string) => `+${l}`)
        const patch = [
          `diff --git a/${file} b/${file}`,
          'new file mode 100644',
          'index 0000000..0000001',
          '--- /dev/null',
          `+++ b/${file}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...diffLines,
        ].join('\n')
        patches.push(patch)
      } catch {
        // skip unreadable files
      }
    }
  }

  return patches.length > 0 ? '\n' + patches.join('\n') : ''
}

export async function getRepoRootAsync(): Promise<string> {
  if (cachedRepoRoot !== null) return cachedRepoRoot
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' })
    cachedRepoRoot = stdout.trim()
    return cachedRepoRoot
  } catch {
    return ''
  }
}

export async function getBranchNameAsync(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stdio: 'pipe', encoding: 'utf-8' })
    return stdout.trim()
  } catch {
    return ''
  }
}

export async function getUntrackedFilePathsAsync(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
    const trimmed = stdout.trim()
    return trimmed ? trimmed.split('\n') : []
  } catch {
    return []
  }
}

async function getUntrackedFilesDiffAsync(): Promise<string> {
  const root = await getRepoRootAsync()
  const filePaths = await getUntrackedFilePathsAsync()

  if (filePaths.length === 0) return ''

  const patches: string[] = []

  const fileDiffPromises = filePaths.map(async (file) => {
    const absolutePath = join(root, file)
    if (isBinaryFile(absolutePath)) {
      return [
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        'index 0000000..0000001',
        `Binary files /dev/null and b/${file} differ`,
      ].join('\n')
    } else {
      try {
        const content = await readFile(absolutePath, 'utf-8')
        const lines = content.split('\n')
        const diffLines = lines.map((l: string) => `+${l}`)
        return [
          `diff --git a/${file} b/${file}`,
          'new file mode 100644',
          'index 0000000..0000001',
          '--- /dev/null',
          `+++ b/${file}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...diffLines,
        ].join('\n')
      } catch {
        return ''
      }
    }
  })

  const results = await Promise.all(fileDiffPromises)
  for (const r of results) {
    if (r) patches.push(r)
  }

  return patches.length > 0 ? '\n' + patches.join('\n') : ''
}

export async function getCustomGitDiffAsync(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', ...DIFF_FLAGS, ...args], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
    return stdout
  } catch {
    return ''
  }
}

export async function getGitDiffAsync(options: { staged?: boolean; untracked?: boolean } = {}): Promise<string> {
  const unstagedPromise = execFileAsync('git', ['diff', ...DIFF_FLAGS], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
    .then(({ stdout }) => stdout)
    .catch(() => '')

  const stagedPromise = options.staged
    ? execFileAsync('git', ['diff', ...DIFF_FLAGS, '--staged'], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
        .then(({ stdout }) => stdout)
        .catch(() => '')
    : Promise.resolve('')

  const untrackedPromise = options.untracked
    ? getUntrackedFilesDiffAsync()
    : Promise.resolve('')

  const [unstaged, staged, untrackedPatch] = await Promise.all([
    unstagedPromise,
    stagedPromise,
    untrackedPromise,
  ])

  const parts: string[] = []
  if (unstaged) parts.push(unstaged)
  if (staged) parts.push(staged)
  if (untrackedPatch) parts.push(untrackedPatch)

  return parts.join('\n')
}

/**
 * Lists every file the working tree knows about (tracked + untracked,
 * excluding standard-ignored paths). Used by the Phase D file viewer to
 * power a path picker.
 */
export function listRepoFiles(): string[] {
  try {
    const tracked = execFileSync(
      'git',
      ['ls-files'],
      { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 },
    ).trim()
    const untracked = execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 },
    ).trim()
    const set = new Set<string>()
    for (const list of [tracked, untracked]) {
      if (!list) continue
      for (const line of list.split('\n')) {
        if (line) set.add(line)
      }
    }
    return [...set].sort()
  } catch {
    return []
  }
}

export interface MergeStatus {
  inMerge: boolean
  conflicts: string[]
}

/**
 * Reports whether the repo is currently in the middle of a merge and which
 * files have unresolved conflicts. Used by the Phase C merge-conflict UI to
 * decide when to render the @pierre/diffs UnresolvedFile component.
 */
export function getMergeStatus(): MergeStatus {
  let root: string
  try {
    root = getRepoRoot()
  } catch {
    return { inMerge: false, conflicts: [] }
  }
  const mergeHead = join(root, '.git', 'MERGE_HEAD')
  let inMerge = false
  try {
    readFileSync(mergeHead)
    inMerge = true
  } catch {
    inMerge = false
  }

  let conflicts: string[] = []
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=U'],
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
    ).trim()
    conflicts = out ? out.split('\n') : []
  } catch {
    conflicts = []
  }
  return { inMerge: inMerge || conflicts.length > 0, conflicts }
}

export function gitAddFile(filePath: string): void {
  execFileSync('git', ['add', '--', filePath], { stdio: 'pipe' })
}

/**
 * Returns a unified diff for a single working-tree file (covers unstaged
 * and untracked changes). Used by the Phase E hunk-revert flow to derive
 * the exact patch text we need to `git apply --reverse`.
 */
export function getFilePatch(filePath: string): string {
  try {
    const unstaged = execFileSync(
      'git',
      ['diff', ...DIFF_FLAGS, '--', filePath],
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
    )
    if (unstaged) return unstaged
  } catch {
    // fall through
  }
  // Untracked: synthesize a new-file patch like getGitDiff does.
  try {
    const root = getRepoRoot()
    const absolutePath = join(root, filePath)
    if (isBinaryFile(absolutePath)) return ''
    const content = readFileSync(absolutePath, 'utf-8')
    const lines = content.split('\n')
    return [
      `diff --git a/${filePath} b/${filePath}`,
      'new file mode 100644',
      'index 0000000..0000001',
      '--- /dev/null',
      `+++ b/${filePath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((l) => `+${l}`),
    ].join('\n')
  } catch {
    return ''
  }
}

/**
 * Extracts the Nth hunk text from a single-file patch. Returns the lines
 * from `@@ ... @@` through the line before the next `@@` (or EOF).
 */
export function extractHunk(patch: string, hunkIndex: number): string | null {
  const lines = patch.split('\n')
  const hunkStarts: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('@@ ')) hunkStarts.push(i)
  }
  if (hunkIndex < 0 || hunkIndex >= hunkStarts.length) return null
  const start = hunkStarts[hunkIndex]
  const end =
    hunkIndex + 1 < hunkStarts.length ? hunkStarts[hunkIndex + 1] : lines.length
  return lines.slice(start, end).join('\n')
}

/** Header lines that the per-file patch needs in order for `git apply` to
 * recognize the target. Stops just before the first `@@` hunk header. */
export function extractPatchHeader(patch: string): string {
  const lines = patch.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (line.startsWith('@@ ')) break
    out.push(line)
  }
  return out.join('\n')
}

/**
 * Reverts a single hunk from the working tree by piping a minimal patch to
 * `git apply --reverse`. Throws if git rejects the apply (typically because
 * the file has shifted since the diff was rendered).
 */
export function revertHunk(filePath: string, hunkIndex: number): void {
  const patch = getFilePatch(filePath)
  if (!patch) {
    throw new Error('No diff available for this file')
  }
  const header = extractPatchHeader(patch)
  const hunk = extractHunk(patch, hunkIndex)
  if (!hunk) {
    throw new Error(`Hunk ${hunkIndex} not found`)
  }
  const minimal = `${header}\n${hunk}\n`
  execFileSync('git', ['apply', '--reverse', '-'], {
    input: minimal,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

export function getProjectStorageDir(customRepoRoot?: string): string {
  const root = customRepoRoot || getRepoRoot()
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8)
  const repoName = basename(root)
  return join(homedir(), '.diffit', `${repoName}-${hash}`)
}
