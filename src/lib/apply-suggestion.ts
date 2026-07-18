/**
 * Pure helpers for applying ```suggestion fences from review comments to
 * on-disk file contents. Extracted from the server route so the multi-line
 * splice logic is unit-testable.
 */

export interface ApplySuggestionInput {
  /** Full UTF-8 file content as currently on disk. */
  content: string
  /** 1-based end line of the comment range (inclusive). */
  lineNumber: number
  /** 1-based start line when the comment spans a range. */
  startLineNumber?: number
  /** Raw comment body containing a ```suggestion fence. */
  body: string
  /** Only additions-side comments are supported. */
  side: 'deletions' | 'additions'
}

export type ApplySuggestionResult =
  | { ok: true; content: string; replacedLines: number }
  | { ok: false; error: string }

/**
 * Extract the first ```suggestion ... ``` fence body from a comment.
 * Returns null when no fence is present.
 */
export function extractSuggestionBlock(body: string): string | null {
  const match = body.match(/```suggestion\r?\n([\s\S]*?)```/)
  if (!match) return null
  return match[1]
}

/**
 * Apply a suggestion fence to file content.
 *
 * - Single-line comments replace one line.
 * - Multi-line comments (startLineNumber..lineNumber) replace that span with
 *   the suggestion lines (which may be shorter or longer than the span).
 * - Suggestion content is split on any common newline style.
 */
export function applySuggestionToContent(input: ApplySuggestionInput): ApplySuggestionResult {
  if (input.side !== 'additions') {
    return { ok: false, error: 'Suggestions can only be applied to added or modified lines' }
  }

  const suggestion = extractSuggestionBlock(input.body)
  if (suggestion === null) {
    return { ok: false, error: 'No suggestion block found in comment body' }
  }

  // Preserve the file's dominant line ending when re-joining.
  const useCrlf = input.content.includes('\r\n')
  const lines = input.content.split(/\r?\n/)

  const end = input.lineNumber
  const start =
    input.startLineNumber && input.startLineNumber > 0 && input.startLineNumber < end
      ? input.startLineNumber
      : end

  if (start < 1 || end < 1) {
    return { ok: false, error: 'Comment line number out of range' }
  }
  if (end > lines.length) {
    return { ok: false, error: 'Comment line number out of range' }
  }

  const startIdx = start - 1
  const deleteCount = end - start + 1
  // Suggestion may intentionally end with a trailing newline (empty last
  // segment from split) — drop a single trailing empty segment so we don't
  // inject an extra blank line.
  let suggestionLines = suggestion.split(/\r?\n/)
  if (suggestionLines.length > 1 && suggestionLines[suggestionLines.length - 1] === '') {
    suggestionLines = suggestionLines.slice(0, -1)
  }

  const next = [...lines]
  next.splice(startIdx, deleteCount, ...suggestionLines)
  const joined = next.join(useCrlf ? '\r\n' : '\n')
  return { ok: true, content: joined, replacedLines: deleteCount }
}
