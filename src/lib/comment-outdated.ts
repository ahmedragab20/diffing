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
