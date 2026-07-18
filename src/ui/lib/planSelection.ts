/**
 * Map a free-text selection from the rendered plan view back onto source
 * line numbers so we can open a line-anchored comment form.
 */

export interface PlanTextSelection {
  text: string
  startLine: number
  endLine: number
}

/**
 * Find the selected snippet in `body` and return 1-based line range.
 * Prefers the first exact match; falls back to a whitespace-normalized search.
 */
export function mapSelectionToLines(body: string, selectedText: string): PlanTextSelection | null {
  const text = selectedText.replace(/\r\n/g, '\n').trim()
  if (!text || text.length < 2) return null

  const normalizedBody = body.replace(/\r\n/g, '\n')
  let idx = normalizedBody.indexOf(text)
  let matched = text

  if (idx === -1) {
    // Collapse internal whitespace for a softer match (rendered MD collapses runs).
    const softNeedle = text.replace(/\s+/g, ' ').trim()
    const softBody = normalizedBody.replace(/\s+/g, ' ')
    const softIdx = softBody.indexOf(softNeedle)
    if (softIdx === -1) return null
    // Map soft index back approximately by counting non-ws chars — best-effort:
    // re-find by taking a distinctive 40-char prefix of the original selection.
    const prefix = softNeedle.slice(0, Math.min(40, softNeedle.length))
    const re = new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    const m = re.exec(normalizedBody)
    if (!m || m.index == null) return null
    idx = m.index
    matched = normalizedBody.slice(idx, idx + text.length)
    // Expand to line ends for multi-line soft matches
    const endProbe = normalizedBody.indexOf('\n', idx + Math.min(matched.length, softNeedle.length))
    matched = normalizedBody.slice(idx, endProbe === -1 ? idx + softNeedle.length : endProbe)
  }

  const before = normalizedBody.slice(0, idx)
  const startLine = before.split('\n').length
  const span = matched.includes('\n') ? matched : text
  const endLine = startLine + span.split('\n').length - 1
  return { text: span.trimEnd(), startLine, endLine }
}
