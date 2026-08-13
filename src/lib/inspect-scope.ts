/**
 * Query-time inspect scope: git pathspec-ish globs and lockfile noise filters.
 * Does not rebuild git or change session diffArgs.
 */

export const LOCKFILE_EXCLUDE = 'lockfiles'
const PATH_MATCH_CAP = 20

export type InspectScopeError = {
  error: string
  status: number
  path?: string
  matches?: Array<{ index: number; path: string }>
}

export type PathMatcher = {
  source: string
  test: (path: string) => boolean
}

export function compilePathspecGlob(pattern: string): PathMatcher | InspectScopeError {
  const source = pattern.trim()
  if (!source) {
    return { error: 'invalid path glob: empty pattern', status: 400, path: pattern }
  }
  try {
    const test = compileGlobTester(source)
    return { source, test }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid path glob'
    return { error: message, status: 400, path: pattern }
  }
}

export function fileMatchesPath(
  matcher: PathMatcher,
  oldPath: string | null | undefined,
  newPath: string | null | undefined,
): boolean {
  if (newPath && matcher.test(newPath)) return true
  if (oldPath && matcher.test(oldPath)) return true
  return false
}

export function parseExcludeList(raw: string | string[] | undefined): string[] | InspectScopeError {
  if (raw == null) return []
  const values = (Array.isArray(raw) ? raw : raw.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  for (const value of values) {
    if (value !== LOCKFILE_EXCLUDE) {
      return { error: `unknown exclude: ${value}`, status: 400 }
    }
  }
  return [...new Set(values)]
}

export function isLockfileNoise(path: string): boolean {
  const base = path.split('/').pop() ?? path
  if (base === 'package-lock.json' || base === 'pnpm-lock.yaml') return true
  if (base.endsWith('.lock')) return true
  if (base.endsWith('.min.js')) return true
  return false
}

export function displayPath(oldPath: string | null | undefined, newPath: string | null | undefined): string {
  return newPath ?? oldPath ?? ''
}

export function capPathMatches(
  matches: Array<{ index: number; path: string }>,
): Array<{ index: number; path: string }> {
  return matches.slice(0, PATH_MATCH_CAP)
}

function compileGlobTester(pattern: string): (path: string) => boolean {
  const normalized = pattern.includes('/') ? pattern : `**/${pattern}`
  const parts = normalized.split('/')
  for (const part of parts) {
    if (part !== '**' && part.includes('**')) {
      throw new Error(`invalid path glob: ${pattern}`)
    }
    validateGlobSegment(part, pattern)
  }
  return (path: string) => matchParts(parts, path.split('/'))
}

function matchParts(pat: string[], path: string[]): boolean {
  if (pat.length === 0) return path.length === 0
  if (pat[0] === '**') {
    return matchParts(pat.slice(1), path) || (path.length > 0 && matchParts(pat, path.slice(1)))
  }
  if (path.length === 0) return false
  return globSegment(pat[0], path[0]) && matchParts(pat.slice(1), path.slice(1))
}

function validateGlobSegment(segment: string, pattern: string): void {
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === '[') {
      const close = segment.indexOf(']', i + 1)
      if (close < 0 || close === i + 1) throw new Error(`invalid path glob: ${pattern}`)
      i = close
      continue
    }
    if (segment[i] === '\\') {
      if (segment[i + 1] == null) throw new Error(`invalid path glob: ${pattern}`)
      i++
    }
  }
}

function globSegment(pattern: string, value: string): boolean {
  return globChars([...pattern], [...value])
}

function globChars(pattern: string[], value: string[]): boolean {
  if (pattern.length === 0) return value.length === 0
  const [head, ...rest] = pattern
  if (head === '*') {
    return globChars(rest, value) || (value.length > 0 && globChars(pattern, value.slice(1)))
  }
  if (head === '?') {
    return value.length > 0 && globChars(rest, value.slice(1))
  }
  if (head === '[') {
    const close = rest.indexOf(']')
    if (close < 0 || value.length === 0) return false
    const classBody = rest.slice(0, close)
    const negated = classBody[0] === '!' || classBody[0] === '^'
    const body = negated ? classBody.slice(1) : classBody
    if (classMatches(body, value[0]) === negated) return false
    return globChars(rest.slice(close + 1), value.slice(1))
  }
  if (head === '\\') {
    return rest.length > 0 && value.length > 0 && rest[0] === value[0] && globChars(rest.slice(1), value.slice(1))
  }
  return value.length > 0 && head === value[0] && globChars(rest, value.slice(1))
}

function classMatches(body: string[], value: string): boolean {
  for (let i = 0; i < body.length; ) {
    if (i + 2 < body.length && body[i + 1] === '-') {
      if (body[i] <= value && value <= body[i + 2]) return true
      i += 3
      continue
    }
    if (body[i] === value) return true
    i++
  }
  return false
}
