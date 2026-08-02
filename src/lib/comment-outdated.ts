import type { ReviewComment } from './types.js'

/**
 * Badge-only outdated detection: a comment is outdated when its captured
 * line snapshot no longer appears in the current file text (or unified patch
 * for that file). No auto-remap — just a flag for the UI.
 */

/** Strip leading +/- / space markers from a diff-style line snapshot. */
export function stripDiffMarkers(lineContent: string): string {
  return lineContent
    .split('\n')
    .map((l) => l.replace(/^[+\- ]/, ''))
    .join('\n')
    .trimEnd()
}

/**
 * Build a per-file haystack from a whole-repo unified patch by slicing the
 * single file's section and reconstructing its *current* content:
 *   - keep `+` (added) and ` ` (context) lines with the marker stripped;
 *   - drop `-` (removed) lines, hunk headers (`@@`), file headers
 *     (`diff --git`, `index`, `---`, `+++`, mode/rename lines), and the
 *     `\ No newline at end of file` marker.
 *
 * This is the haystack {@link isCommentOutdated} expects: the file's live
 * text WITHOUT diff markers. Feeding the raw patch directly (the previous
 * approach) left `+`/`-` markers on every line, so any *multi-line* comment
 * snapshot — after stripping its own markers — could never substring-match
 * (each line after the first in the haystack still began with `+`). That
 * false-positived freshly added comments as "outdated" the instant they
 * were created. Scoping per file also stops a snapshot from accidentally
 * matching another file's content elsewhere in the repo patch.
 *
 * Returns `undefined` when the file is not in the patch (caller leaves the
 * comment's `outdated` flag untouched) and `''` for binary / deleted files.
 */
export function fileContentFromPatch(
  patch: string,
  filePath: string,
): string | undefined {
  if (!patch || !filePath) return undefined
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  // Locate this file's section. Match `diff --git a/<p> b/<p>` and also the
  // `--- a/<p>` / `+++ b/<p>` pair so renamed files (b/<p>) still resolve.
  let startIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('diff --git ')) continue
    // `diff --git a/<old> b/<new>` — match the new (b/) path.
    const m = /^diff --git a\/.* b\/(.+)$/.exec(line)
    if (m && m[1] === filePath) {
      startIdx = i
      break
    }
    // Fallback: also accept the literal path in either position for safety.
    if (line.includes(` b/${filePath}`)) {
      startIdx = i
      break
    }
  }
  if (startIdx === -1) return undefined

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('diff --git ')) {
      endIdx = i
      break
    }
  }

  const out: string[] = []
  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i]
    // Skip file-meta headers and hunk headers.
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to') ||
      line.startsWith('copy from') ||
      line.startsWith('copy to') ||
      line.startsWith('Binary files') ||
      line.startsWith('GIT binary patch') ||
      line.startsWith('@@')
    ) {
      continue
    }
    // "No newline" reflector line — drop.
    if (line.startsWith('\\ No newline')) continue
    if (line === '') {
      // Blank line inside a patch is real content (context with empty body).
      out.push('')
      continue
    }
    const ch = line[0]
    if (ch === '+') {
      out.push(line.slice(1))
    } else if (ch === ' ') {
      out.push(line.slice(1))
    } else if (ch === '-') {
      // Removed: not part of the current file content — drop.
      continue
    } else {
      // Any other content line (rare): keep verbatim.
      out.push(line)
    }
  }
  return out.join('\n')
}

/**
 * Return true when the comment's anchored code is no longer present in
 * `haystack` (file content or file-specific patch chunk).
 *
 * File-level comments (`lineNumber === 0`) and empty snapshots are never outdated.
 */
export function isCommentOutdated(comment: ReviewComment, haystack: string | null | undefined): boolean {
  if (comment.lineNumber === 0) return false
  const snapshot = stripDiffMarkers(comment.lineContent ?? '')
  if (!snapshot) return false
  if (haystack == null || haystack === '') return false
  // Normalize both sides to LF so CRLF files don't false-positive.
  const needle = snapshot.replace(/\r\n/g, '\n')
  const hay = haystack.replace(/\r\n/g, '\n')
  return !hay.includes(needle)
}

/**
 * Annotate a list of comments with `outdated` using a map of filePath → content.
 * Comments whose files are missing from the map are left unchanged.
 */
export function markOutdatedComments(
  comments: ReviewComment[],
  fileContents: Map<string, string>,
): ReviewComment[] {
  return comments.map((c) => {
    const content = fileContents.get(c.filePath)
    if (content === undefined) return c
    const outdated = isCommentOutdated(c, content)
    if (c.outdated === outdated) return c
    return { ...c, outdated }
  })
}
