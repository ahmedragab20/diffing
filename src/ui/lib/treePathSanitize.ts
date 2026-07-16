/**
 * Pure helpers that sanitize a list of file paths before they're handed to
 * `@pierre/trees`. The library throws `Path collides with an existing entry`
 * when two paths describe the same filesystem entry (a directory AND a file
 * with the same terminal segment) or when exact duplicates repeat. This module
 * deduplicates, normalizes, and resolves those collisions deterministically
 * so the tree sidebar never crashes the review UI.
 *
 * The collision rule mirrors the underlying filesystem: a path is a directory
 * iff some other path's terminal segment equals it AND has a descendant
 * (i.e. the path appears as a parent prefix of another entry). A standalone
 * file that has the same name as a directory of the same depth cannot exist
 * on disk, so we drop the standalone file.
 *
 * All path comparisons are byte-exact (`===`). We do NOT case-fold, NFKC-
 * normalize, or trim trailing slashes — every diff path here came from
 * git/working-tree output, and case-sensitive equality is the contract
 * `@pierre/trees` itself uses when building its internal model. Normalizing
 * here would mask legitimate distinctions and could create new collisions.
 */

export interface SanitizeResult {
  paths: string[]
  dropped: string[]
}

/**
 * Normalize, deduplicate, and resolve collisions in a raw list of file paths.
 *
 * Algorithm (deterministic, in order):
 *   Pass 1 — drop empty / whitespace-only entries; strip a single leading
 *            `./` segment so `./a/b` and `a/b` are treated as the same path.
 *   Pass 2 — drop exact-equal duplicates (first occurrence wins). After this
 *            pass, every path is unique and non-empty.
 *   Pass 3 — resolve file↔directory collisions. Build a set of every
 *            ancestor prefix of every path; this is the set of directories
 *            that must exist to host the remaining entries. A path that
 *            appears in that set IS a directory; if it also appears in the
 *            `paths` list as a standalone entry (i.e. someone claims a file
 *            lives at a path that is also a directory), drop the standalone
 *            file. Order is preserved for the surviving paths.
 *
 * Pass 3 is order-independent: the set of dropped entries is determined
 * purely by the set of surviving paths, so feeding `[a/b, a/b/c]` or
 * `[a/b/c, a/b]` produces the same result.
 */
export function sanitizePaths(rawPaths: readonly string[]): SanitizeResult {
  // Pass 1: drop empties + strip leading "./"
  const cleaned: string[] = []
  for (const raw of rawPaths) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const normalized = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
    if (normalized.length === 0) continue
    cleaned.push(normalized)
  }

  // Pass 2: dedupe exact-equal paths (first occurrence wins)
  const seen = new Set<string>()
  const unique: string[] = []
  for (const path of cleaned) {
    if (seen.has(path)) continue
    seen.add(path)
    unique.push(path)
  }

  // Pass 3: resolve file↔directory collisions.
  // First, build the set of every directory that must exist (every ancestor
  // prefix of every surviving path).
  const directorySet = new Set<string>()
  for (const path of unique) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      directorySet.add(parts.slice(0, i).join('/'))
    }
  }

  // Then walk the unique list and drop any standalone file whose path is
  // also a directory of the same name (i.e. the path itself appears in
  // `directorySet`). We do this AFTER the directory set is built so the
  // determination is order-independent.
  const finalPaths: string[] = []
  const dropped: string[] = []
  for (const path of unique) {
    if (directorySet.has(path)) {
      dropped.push(path)
    } else {
      finalPaths.push(path)
    }
  }

  return { paths: finalPaths, dropped }
}

/**
 * Build the default-expanded ancestor prefixes for the given path list. Used
 * by `<FileTree>` to tell `@pierre/trees` which directories to expand
 * initially so deeply-nested files are visible without manual interaction.
 *
 * Runs the same sanitization pipeline first so the returned set never
 * contains a path that would itself collide — the tree must never be asked
 * to expand a "directory" that was dropped as a colliding file.
 */
export function buildExpandedPaths(paths: string[]): string[] {
  const { paths: cleanPaths } = sanitizePaths(paths)
  const set = new Set<string>()
  for (const path of cleanPaths) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      set.add(parts.slice(0, i).join('/'))
    }
  }
  return Array.from(set)
}
