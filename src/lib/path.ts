import { resolve, isAbsolute, relative } from 'node:path'

function decodeAndNormalize(p: string): string {
  // Decode URL-encoded characters (e.g. %2e -> ., %2f -> /, %5c -> \)
  let decoded = p
  try {
    decoded = decodeURIComponent(p)
  } catch {
    // invalid encoding, use as-is
  }
  // Normalize backslashes to forward slashes
  return decoded.replace(/\\/g, '/')
}

export function toSafeRelativePath(filePath: string, baseDir: string): string | null {
  const normalized = decodeAndNormalize(filePath)
  if (normalized.includes('..') || normalized.includes('\0')) {
    return null
  }
  const resolved = resolve(baseDir, normalized)
  const resolvedBase = resolve(baseDir)
  const isSafe = resolved.startsWith(resolvedBase + '/') || resolved === resolvedBase
  if (!isSafe) {
    return null
  }
  return relative(resolvedBase, resolved)
}

export function isSafePath(relativePath: string, baseDir: string): boolean {
  return toSafeRelativePath(relativePath, baseDir) !== null
}
