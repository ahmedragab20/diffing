import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const VIEWER_PROBE_TIMEOUT_MS = 1_500

function bundledBinary(callerUrl: string, ext: string): string {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
  const runtime = process.platform === 'linux'
    ? report?.header?.glibcVersionRuntime ? 'gnu' : 'musl'
    : process.platform === 'win32' ? 'msvc' : null
  const target = tuiBinaryTarget(process.platform, process.arch, runtime)
  return resolve(dirname(fileURLToPath(callerUrl)), 'native', target, `diffing-tui${ext}`)
}

export function tuiBinaryTarget(
  platform: NodeJS.Platform,
  arch: string,
  runtime: 'gnu' | 'musl' | 'msvc' | null,
): string {
  return `tui-${[platform, arch, runtime].filter(Boolean).join('-')}`
}

function localTuiCandidates(callerUrl: string): string[] {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const here = dirname(fileURLToPath(callerUrl))
  const bundled = bundledBinary(callerUrl, ext)
  return [
    resolve(here, `diffing-tui${ext}`),
    resolve(here, '..', 'target', 'release', `diffing-tui${ext}`),
    resolve(here, '..', '..', 'target', 'release', `diffing-tui${ext}`),
    resolve(here, '..', 'target', 'debug', `diffing-tui${ext}`),
    resolve(here, '..', '..', 'target', 'debug', `diffing-tui${ext}`),
    bundled,
    resolve(here, '..', 'bin', `diffing-tui${ext}`),
  ]
}

function pathLookupCandidates(): string[] {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(which, ['diffing-tui'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!out) return []
    return out
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(candidate => candidate && isAbsolute(candidate))
  } catch {
    return []
  }
}

/**
 * Locate the `diffing-tui` native binary. Looks, in order:
 *   1. Sibling of the calling module (`dist/diffing-tui[.exe]` after build).
 *   2. `target/release/diffing-tui[.exe]` next to the package root
 *      (cargo release build).
 *   3. `target/debug/diffing-tui[.exe]` next to the package root
 *      (cargo debug build — the common case during development, especially
 *      on Windows where release builds are slow).
 *   4. Matching binary bundled inside the root npm package.
 *   5. `bin/diffing-tui[.exe]` next to the package root.
 *   6. `$PATH` lookup via `which` / `where`.
 *
 * Returns the absolute path of the first match, or `null` if none are found.
 *
 * `callerUrl` is the `import.meta.url` of the caller — pass `import.meta.url`
 * from `cli.ts`. Exposed as a parameter so unit tests can pin the search
 * root to a known location instead of depending on the test runner's CWD.
 */
export function findTuiBinaries(callerUrl: string): string[] {
  const found = localTuiCandidates(callerUrl).filter(candidate => existsSync(candidate))
  for (const candidate of pathLookupCandidates()) {
    if (!found.includes(candidate)) found.push(candidate)
  }
  return [...new Set(found)]
}

export function findTuiBinary(callerUrl: string): string | null {
  for (const candidate of localTuiCandidates(callerUrl)) {
    if (existsSync(candidate)) return candidate
  }
  for (const candidate of pathLookupCandidates()) {
    return candidate
  }
  return null
}

async function probeViewerBinary(candidate: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(candidate, ['--help'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: VIEWER_PROBE_TIMEOUT_MS,
    })
    return stdout.includes('--view-only') ? candidate : null
  } catch {
    return null
  }
}

export async function findViewerTuiBinary(callerUrl: string): Promise<string | null> {
  const candidates = findTuiBinaries(callerUrl)
  const matches = await Promise.all(candidates.map(candidate => probeViewerBinary(candidate)))
  return matches.find((candidate): candidate is string => candidate !== null) ?? null
}
