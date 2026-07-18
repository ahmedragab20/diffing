/**
 * Map a free-text selection from the rendered plan view back onto source
 * line numbers so we can open a line-anchored comment form.
 */

export interface PlanTextSelection {
  text: string
  startLine: number
  endLine: number
}

/** Normalize selection / body text for resilient matching. */
export function normalizePlanText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ') // nbsp from rendered HTML
    .replace(/\u200b/g, '') // zero-width space
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/**
 * True when the current selection intersects the plan rendered root,
 * regardless of drag direction (LTR / RTL / outside→inside).
 */
export function selectionIntersectsRoot(sel: Selection, root: HTMLElement): boolean {
  if (!sel.rangeCount) return false
  try {
    const range = sel.getRangeAt(0)
    if (root.contains(range.commonAncestorContainer)) return true
    if (sel.anchorNode && root.contains(sel.anchorNode)) return true
    if (sel.focusNode && root.contains(sel.focusNode)) return true

    // Partial overlap: selection started outside and ended inside (or reverse).
    const rootRange = document.createRange()
    rootRange.selectNodeContents(root)
    // Ranges intersect if startA < endB && startB < endA
    return (
      range.compareBoundaryPoints(Range.START_TO_END, rootRange) < 0 &&
      range.compareBoundaryPoints(Range.END_TO_START, rootRange) > 0
    )
  } catch {
    return false
  }
}

/**
 * Prefer the selection range clipped to the rendered root so rects/text stay
 * inside the plan pane even when the user dragged past its edges.
 */
export function selectionRangeInRoot(sel: Selection, root: HTMLElement): Range | null {
  if (!sel.rangeCount) return null
  try {
    const range = sel.getRangeAt(0).cloneRange()
    if (root.contains(range.commonAncestorContainer)) return range

    const rootRange = document.createRange()
    rootRange.selectNodeContents(root)

    // Clip start to root if it began outside.
    if (!root.contains(range.startContainer)) {
      range.setStart(rootRange.startContainer, rootRange.startOffset)
    }
    // Clip end to root if it ended outside.
    if (!root.contains(range.endContainer)) {
      range.setEnd(rootRange.endContainer, rootRange.endOffset)
    }
    if (range.collapsed) return null
    if (!root.contains(range.commonAncestorContainer) && !selectionIntersectsRoot(sel, root)) {
      return null
    }
    return range
  } catch {
    return null
  }
}

function lineNumberAtIndex(body: string, index: number): number {
  if (index <= 0) return 1
  return body.slice(0, index).split('\n').length
}

/**
 * Find the selected snippet in `body` and return 1-based line range.
 * Tries exact match, whitespace-normalized match, and prefix/suffix soft finds
 * so rendered markdown (collapsed spaces, list bullets) still maps.
 */
export function mapSelectionToLines(body: string, selectedText: string): PlanTextSelection | null {
  const text = normalizePlanText(selectedText)
  // Allow single-character selections (e.g. a code token).
  if (!text) return null

  const normalizedBody = body.replace(/\r\n/g, '\n')

  // 1) Exact match
  let idx = normalizedBody.indexOf(text)
  if (idx !== -1) {
    const startLine = lineNumberAtIndex(normalizedBody, idx)
    const endLine = startLine + text.split('\n').length - 1
    return { text, startLine, endLine }
  }

  // 2) Whitespace-collapsed match (rendered MD collapses runs / newlines)
  const softNeedle = text.replace(/\s+/g, ' ').trim()
  if (softNeedle) {
    const softBody = normalizedBody.replace(/\s+/g, ' ')
    const softIdx = softBody.indexOf(softNeedle)
    if (softIdx !== -1) {
      // Map soft index → original by walking both streams.
      const origIdx = mapSoftIndexToOriginal(normalizedBody, softIdx)
      if (origIdx !== -1) {
        const startLine = lineNumberAtIndex(normalizedBody, origIdx)
        // Approximate end by soft length → line span from exact text line count.
        const endLine = startLine + Math.max(0, text.split('\n').length - 1)
        return { text, startLine, endLine: Math.min(endLine, normalizedBody.split('\n').length) }
      }
    }
  }

  // 3) Match first significant line of the selection against body lines
  //    (handles list items where the user selected "item b" but source is "- item b").
  const firstLine = text.split('\n').find((l) => l.trim())?.trim() ?? ''
  if (firstLine.length >= 1) {
    const bodyLines = normalizedBody.split('\n')
    for (let i = 0; i < bodyLines.length; i++) {
      const bl = bodyLines[i]
      const stripped = bl.replace(/^\s*([-*+]|\d+\.)\s+/, '').trim()
      if (
        bl.includes(firstLine) ||
        stripped.includes(firstLine) ||
        firstLine.includes(stripped) && stripped.length >= 2
      ) {
        const lineCount = text.split('\n').filter((l) => l.trim()).length || 1
        const startLine = i + 1
        const endLine = Math.min(bodyLines.length, startLine + lineCount - 1)
        return { text, startLine, endLine }
      }
    }
  }

  // 4) Last resort: unique substring of first 24 non-space chars
  const compact = softNeedle.replace(/\s+/g, '')
  if (compact.length >= 3) {
    const needle = softNeedle.slice(0, Math.min(32, softNeedle.length))
    const re = new RegExp(
      needle
        .split('')
        .map((ch) => (/[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch))
        .join('\\s*'),
      'i',
    )
    const m = re.exec(normalizedBody)
    if (m && m.index != null) {
      const startLine = lineNumberAtIndex(normalizedBody, m.index)
      return { text, startLine, endLine: startLine }
    }
  }

  return null
}

/** Map an index in whitespace-collapsed text back into the original body. */
function mapSoftIndexToOriginal(original: string, softIndex: number): number {
  let soft = 0
  let i = 0
  let inSpace = false
  // Mirror softBody construction: replace(/\s+/g, ' ')
  // leading/trailing of full soft body aren't trimmed here — softBody was from
  // full normalizedBody without trim, only runs collapsed.
  while (i < original.length && soft < softIndex) {
    const ch = original[i]
    if (/\s/.test(ch)) {
      if (!inSpace) {
        soft += 1 // one space in soft body
        inSpace = true
      }
      i += 1
    } else {
      inSpace = false
      soft += 1
      i += 1
    }
  }
  // Skip remaining spaces so we land on content.
  while (i < original.length && /\s/.test(original[i])) i += 1
  return i < original.length ? i : -1
}
