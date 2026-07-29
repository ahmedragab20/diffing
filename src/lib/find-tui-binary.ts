import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

function packagedBinary(callerUrl: string, ext: string): string | null {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
  const runtime = process.platform === 'linux'
    ? report?.header?.glibcVersionRuntime ? 'gnu' : 'musl'
    : process.platform === 'win32' ? 'msvc' : null
  const packageName = tuiPackageName(process.platform, process.arch, runtime)
  try {
    return createRequire(callerUrl).resolve(`${packageName}/bin/diffing-tui${ext}`)
  } catch {
    return null
  }
}

export function tuiPackageName(
  platform: NodeJS.Platform,
  arch: string,
  runtime: 'gnu' | 'musl' | 'msvc' | null,
): string {
  return `@diffing/tui-${[platform, arch, runtime].filter(Boolean).join('-')}`
}

/**
 * Locate the `diffing-tui` native binary. Looks, in order:
 *   1. Sibling of the calling module (`dist/diffing-tui[.exe]` after build).
 *   2. `target/release/diffing-tui[.exe]` next to the package root
 *      (cargo release build).
 *   3. `target/debug/diffing-tui[.exe]` next to the package root
 *      (cargo debug build — the common case during development, especially
 *      on Windows where release builds are slow).
 *   4. Matching optional npm package.
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
  const ext = process.platform === 'win32' ? '.exe' : ''
  const here = dirname(fileURLToPath(callerUrl))
  const packaged = packagedBinary(callerUrl, ext)
  const candidates: string[] = [
    resolve(here, `diffing-tui${ext}`),
    resolve(here, '..', 'target', 'release', `diffing-tui${ext}`),
    resolve(here, '..', '..', 'target', 'release', `diffing-tui${ext}`),
    resolve(here, '..', 'target', 'debug', `diffing-tui${ext}`),
    resolve(here, '..', '..', 'target', 'debug', `diffing-tui${ext}`),
    ...(packaged ? [packaged] : []),
    resolve(here, '..', 'bin', `diffing-tui${ext}`),
  ]
  const found = candidates.filter(c => existsSync(c))
  // Final fallback: $PATH lookup.
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(which, ['diffing-tui'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (out) {
      for (const line of out.split(/\r?\n/)) {
        const candidate = line.trim()
        if (candidate && isAbsolute(candidate)) found.push(candidate)
      }
    }
  } catch {
    // not on $PATH — fall through
  }
  return [...new Set(found)]
}

export function findTuiBinary(callerUrl: string): string | null {
  return findTuiBinaries(callerUrl)[0] ?? null
}
