import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Locate the `diffing-tui` native binary. Looks, in order:
 *   1. Sibling of the calling module (`dist/diffing-tui[.exe]` after build).
 *   2. `bin/diffing-tui[.exe]` next to the package root.
 *   3. `target/release/diffing-tui[.exe]` next to the package root
 *      (cargo release build).
 *   4. `target/debug/diffing-tui[.exe]` next to the package root
 *      (cargo debug build — the common case during development, especially
 *      on Windows where release builds are slow).
 *   5. `$PATH` lookup via `which` / `where`.
 *
 * Returns the absolute path of the first match, or `null` if none are found.
 *
 * `callerUrl` is the `import.meta.url` of the caller — pass `import.meta.url`
 * from `cli.ts`. Exposed as a parameter so unit tests can pin the search
 * root to a known location instead of depending on the test runner's CWD.
 */
export function findTuiBinary(callerUrl: string): string | null {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const here = dirname(fileURLToPath(callerUrl))
  const candidates: string[] = [
    resolve(here, `diffing-tui${ext}`),
    resolve(here, '..', 'bin', `diffing-tui${ext}`),
    resolve(here, '..', 'target', 'release', `diffing-tui${ext}`),
    resolve(here, '..', '..', 'target', 'release', `diffing-tui${ext}`),
    resolve(here, '..', 'target', 'debug', `diffing-tui${ext}`),
    resolve(here, '..', '..', 'target', 'debug', `diffing-tui${ext}`),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  // Final fallback: $PATH lookup.
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(which, ['diffing-tui'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (out) {
      const first = out.split(/\r?\n/)[0]?.trim()
      if (first && isAbsolute(first)) return first
    }
  } catch {
    // not on $PATH — fall through
  }
  return null
}
