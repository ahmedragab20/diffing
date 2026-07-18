/** Parse a free-text / stored extension filter into a normalized list of extensions. */
export function parseExtensionFilter(value: string): string[] {
  if (!value.trim()) return []
  return normalizeExtensions(
    value
      .split(/[,\s]+/)
      .map((part) => part.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean),
  )
}

/** Deduplicate, strip dots, lowercase, and sort for stable identity. */
export function normalizeExtensions(extensions: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of extensions) {
    const e = raw.trim().replace(/^\./, '').toLowerCase()
    if (!e || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  out.sort((a, b) => a.localeCompare(b))
  return out
}

/** True when two extension lists contain the same set (order-insensitive). */
export function sameExtensionSet(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  const na = normalizeExtensions(a)
  const nb = normalizeExtensions(b)
  return na.every((e, i) => e === nb[i])
}

/** Check whether a file path matches an extension filter list. Empty = match all. */
export function matchesExtensionFilter(path: string, extensions: string[]): boolean {
  if (extensions.length === 0) return true
  const slash = path.lastIndexOf('/')
  const base = slash === -1 ? path : path.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  const ext = base.slice(dot + 1).toLowerCase()
  return extensions.includes(ext)
}

/** Build a display string for the current extension filter. */
export function formatExtensionFilter(extensions: string[]): string {
  if (extensions.length === 0) return ''
  return extensions.map((e) => `.${e}`).join(', ')
}

/**
 * Collect unique extensions present in the given file paths, sorted.
 * Paths without a usable extension are ignored.
 */
export function collectExtensions(paths: string[]): string[] {
  const seen = new Set<string>()
  for (const path of paths) {
    const slash = path.lastIndexOf('/')
    const base = slash === -1 ? path : path.slice(slash + 1)
    const dot = base.lastIndexOf('.')
    if (dot <= 0) continue
    const ext = base.slice(dot + 1).toLowerCase()
    if (ext) seen.add(ext)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * When the working set is large enough that remounting FileDiff cards would lag,
 * the extension multi-select requires an explicit Apply instead of live filtering.
 */
export function extensionFilterNeedsApply(
  fileCount: number,
  totalChangedLines = 0,
): boolean {
  return fileCount >= 25 || totalChangedLines >= 1500
}
