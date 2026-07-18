/**
 * Per-file fingerprints of a unified diff, used to detect "what changed
 * since the last review handoff" without storing full patch text.
 */

/** Stable FNV-1a 32-bit hex hash of a string. */
export function hashString(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Split a multi-file unified diff into path → raw file-diff text.
 * Paths are taken from the `b/` side of `diff --git a/... b/...` headers
 * (or the first path for pure deletions).
 */
export function splitUnifiedDiffByFile(patch: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!patch.trim()) return map

  const lines = patch.split(/\r?\n/)
  let currentPath: string | null = null
  let buf: string[] = []

  const flush = () => {
    if (currentPath != null && buf.length > 0) {
      map.set(currentPath, buf.join('\n'))
    }
    currentPath = null
    buf = []
  }

  for (const line of lines) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (m) {
      flush()
      // Prefer the destination path; for pure deletes both sides may matter
      // but b/ is what the working tree review uses for names.
      currentPath = m[2] === '/dev/null' ? m[1] : m[2]
      buf = [line]
      continue
    }
    if (currentPath != null) buf.push(line)
  }
  flush()
  return map
}

/** path → content fingerprint for every file in the patch. */
export function fingerprintDiffFiles(patch: string): Record<string, string> {
  const parts = splitUnifiedDiffByFile(patch)
  const out: Record<string, string> = {}
  for (const [path, text] of parts) {
    out[path] = hashString(text)
  }
  return out
}

export interface SinceLastDelta {
  /** Files present in both snapshots with different fingerprints. */
  changed: string[]
  /** Files only in the current snapshot. */
  added: string[]
  /** Files only in the previous snapshot. */
  removed: string[]
}

/**
 * Compare two fingerprint maps. Returns sorted path lists.
 */
export function diffSinceLast(
  previous: Record<string, string> | null | undefined,
  current: Record<string, string>,
): SinceLastDelta {
  const prev = previous ?? {}
  const prevKeys = new Set(Object.keys(prev))
  const currKeys = new Set(Object.keys(current))

  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []

  for (const path of currKeys) {
    if (!prevKeys.has(path)) added.push(path)
    else if (prev[path] !== current[path]) changed.push(path)
  }
  for (const path of prevKeys) {
    if (!currKeys.has(path)) removed.push(path)
  }

  changed.sort((a, b) => a.localeCompare(b))
  added.sort((a, b) => a.localeCompare(b))
  removed.sort((a, b) => a.localeCompare(b))
  return { changed, added, removed }
}

/** Union of changed + added — the files a reviewer should re-check. */
export function filesToReviewSinceLast(delta: SinceLastDelta): string[] {
  return [...delta.changed, ...delta.added].sort((a, b) => a.localeCompare(b))
}
