import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs'

/**
 * Pending inline comment draft anchored to a diff line (or range).
 * `lineNumber` is always the bottom of the selection (where pierre slots the form).
 * `startLineNumber` is set only when the range spans more than one line.
 */
export interface PendingLineComment {
  side: AnnotationSide
  lineNumber: number
  startLineNumber?: number
  /** Side of the selection start when it differs from the end (rare cross-side drag). */
  startSide?: AnnotationSide
}

/**
 * Resolve the side pierre reports for a selection.
 * Same-side selections omit `endSide` and only set `side` — never default
 * those to "additions" or annotations land on the wrong side (and often
 * fall through to the end of the file when no matching slot exists).
 */
export function selectionSide(range: SelectedLineRange): AnnotationSide {
  return range.endSide ?? range.side ?? 'additions'
}

export function selectionStartSide(range: SelectedLineRange): AnnotationSide {
  return range.side ?? range.endSide ?? 'additions'
}

/**
 * Normalize a pierre SelectedLineRange into a pending comment anchor.
 * - Same side: order lines so start ≤ end; anchor form under the bottom line.
 * - Cross side: keep pierre's start/end and endSide for anchoring.
 */
export function pendingFromSelection(range: SelectedLineRange): PendingLineComment {
  const startSide = selectionStartSide(range)
  const endSide = selectionSide(range)

  if (startSide === endSide) {
    const lo = Math.min(range.start, range.end)
    const hi = Math.max(range.start, range.end)
    return {
      side: endSide,
      lineNumber: hi,
      startLineNumber: lo !== hi ? lo : undefined,
    }
  }

  // Cross-side drag: anchor on the end of the gesture (pierre's endSide/end).
  return {
    side: endSide,
    lineNumber: range.end,
    startLineNumber: range.start !== range.end ? range.start : undefined,
    startSide,
  }
}

export function pendingFromLine(
  side: AnnotationSide,
  lineNumber: number,
): PendingLineComment {
  return { side, lineNumber }
}

/** Inclusive line count for a pending range (same-side only). */
export function pendingLineCount(p: PendingLineComment): number {
  if (p.startLineNumber == null || p.startLineNumber === p.lineNumber) return 1
  return Math.abs(p.lineNumber - p.startLineNumber) + 1
}

/** Human label for the anchored range, e.g. "L12–L15 · additions". */
export function pendingLineLabel(p: PendingLineComment): string {
  const sideLabel = p.side === 'deletions' ? 'old' : 'new'
  if (p.startLineNumber != null && p.startLineNumber !== p.lineNumber) {
    const lo = Math.min(p.startLineNumber, p.lineNumber)
    const hi = Math.max(p.startLineNumber, p.lineNumber)
    return `L${lo}–L${hi} · ${sideLabel}`
  }
  return `L${p.lineNumber} · ${sideLabel}`
}

/**
 * Build a SelectedLineRange that matches how pierre highlights lines for a
 * pending draft (keeps selection paint in sync with the open form).
 */
export function selectedRangeFromPending(p: PendingLineComment): SelectedLineRange {
  if (p.startLineNumber != null && p.startLineNumber !== p.lineNumber) {
    return {
      start: p.startLineNumber,
      end: p.lineNumber,
      side: p.startSide ?? p.side,
      ...(p.startSide && p.startSide !== p.side ? { endSide: p.side } : {}),
    }
  }
  return { start: p.lineNumber, end: p.lineNumber, side: p.side }
}
