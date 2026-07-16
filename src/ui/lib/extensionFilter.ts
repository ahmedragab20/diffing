/** Parse a free-text extension filter into a normalized list of extensions. */
export function parseExtensionFilter(value: string): string[] {
  if (!value.trim()) return []
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean)
}

/** Check whether a file path matches an extension filter list. */
export function matchesExtensionFilter(path: string, extensions: string[]): boolean {
  if (extensions.length === 0) return true
  const dot = path.lastIndexOf('.')
  if (dot === -1 || dot === path.lastIndexOf('/')) return false
  const ext = path.slice(dot + 1).toLowerCase()
  return extensions.includes(ext)
}

/** Build a display string for the current extension filter. */
export function formatExtensionFilter(extensions: string[]): string {
  if (extensions.length === 0) return ''
  return extensions.map((e) => `.${e}`).join(', ')
}
