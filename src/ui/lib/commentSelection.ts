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

/** Inclusive min/max line numbers valid for adjusting a pending range on one side. */
export interface PendingLineBounds {
  min: number
  max: number
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
 * Force ordered same-side pending shape: bottom = lineNumber, optional start
 * only when multi-line. Cross-side drafts are left as-is (start may exceed end).
 */
export function normalizePendingRange(p: PendingLineComment): PendingLineComment {
  if (p.startSide && p.startSide !== p.side) {
    // Cross-side: keep pierre's anchors; only collapse single-line.
    if (p.startLineNumber == null || p.startLineNumber === p.lineNumber) {
      const { startLineNumber: _s, startSide: _ss, ...rest } = p
      return rest
    }
    return p
  }
  const lo = p.startLineNumber != null
    ? Math.min(p.startLineNumber, p.lineNumber)
    : p.lineNumber
  const hi = p.startLineNumber != null
    ? Math.max(p.startLineNumber, p.lineNumber)
    : p.lineNumber
  if (lo === hi) {
    return { side: p.side, lineNumber: hi }
  }
  return { side: p.side, lineNumber: hi, startLineNumber: lo }
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
    return normalizePendingRange({
      side: endSide,
      lineNumber: hi,
      startLineNumber: lo !== hi ? lo : undefined,
    })
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

/** Side label used in composer chrome: "new" / "old". */
export function pendingSideLabel(p: PendingLineComment): string {
  return p.side === 'deletions' ? 'old' : 'new'
}

/** Human label for the anchored range, e.g. "L12–L15 · new". */
export function pendingLineLabel(p: PendingLineComment): string {
  const sideLabel = pendingSideLabel(p)
  if (p.startLineNumber != null && p.startLineNumber !== p.lineNumber) {
    const lo = Math.min(p.startLineNumber, p.lineNumber)
    const hi = Math.max(p.startLineNumber, p.lineNumber)
    return `L${lo}–L${hi} · ${sideLabel}`
  }
  return `L${p.lineNumber} · ${sideLabel}`
}

/**
 * Ordered start/end for same-side pending (end is always the annotation slot).
 * Cross-side returns raw start/end without reordering by line number alone.
 */
export function pendingOrderedRange(p: PendingLineComment): { start: number; end: number } {
  if (p.startSide && p.startSide !== p.side) {
    return {
      start: p.startLineNumber ?? p.lineNumber,
      end: p.lineNumber,
    }
  }
  const lo = p.startLineNumber != null
    ? Math.min(p.startLineNumber, p.lineNumber)
    : p.lineNumber
  const hi = p.startLineNumber != null
    ? Math.max(p.startLineNumber, p.lineNumber)
    : p.lineNumber
  return { start: lo, end: hi }
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

/**
 * Move the top of the range by `delta` lines (−1 expands upward, +1 shrinks
 * from the top). Clamped so start never exceeds end and stays within bounds.
 * Cross-side drafts are not adjusted (return input).
 */
export function adjustPendingStart(
  p: PendingLineComment,
  delta: number,
  bounds?: PendingLineBounds,
): PendingLineComment {
  if (p.startSide && p.startSide !== p.side) return p
  if (!Number.isFinite(delta) || delta === 0) return normalizePendingRange(p)

  const { start, end } = pendingOrderedRange(p)
  let nextStart = start + delta
  if (bounds) {
    nextStart = Math.max(bounds.min, Math.min(bounds.max, nextStart))
  }
  // Start cannot pass the end (shrink until single line).
  nextStart = Math.min(nextStart, end)
  return normalizePendingRange({ side: p.side, lineNumber: end, startLineNumber: nextStart })
}

/**
 * Move the bottom (annotation slot) by `delta` lines (−1 shrinks from bottom,
 * +1 expands downward). Clamped so end never goes above start and stays in bounds.
 * Cross-side drafts are not adjusted (return input).
 */
export function adjustPendingEnd(
  p: PendingLineComment,
  delta: number,
  bounds?: PendingLineBounds,
): PendingLineComment {
  if (p.startSide && p.startSide !== p.side) return p
  if (!Number.isFinite(delta) || delta === 0) return normalizePendingRange(p)

  const { start, end } = pendingOrderedRange(p)
  let nextEnd = end + delta
  if (bounds) {
    nextEnd = Math.max(bounds.min, Math.min(bounds.max, nextEnd))
  }
  // End cannot pass the start (shrink until single line).
  nextEnd = Math.max(nextEnd, start)
  return normalizePendingRange({ side: p.side, lineNumber: nextEnd, startLineNumber: start })
}

/**
 * Whether the start edge can still move in the given direction (−1 = up/expand,
 * +1 = down/shrink toward end).
 */
export function canAdjustPendingStart(
  p: PendingLineComment,
  delta: -1 | 1,
  bounds?: PendingLineBounds,
): boolean {
  if (p.startSide && p.startSide !== p.side) return false
  const next = adjustPendingStart(p, delta, bounds)
  return next.startLineNumber !== p.startLineNumber || next.lineNumber !== p.lineNumber
}

/**
 * Whether the end edge can still move in the given direction (−1 = up/shrink,
 * +1 = down/expand).
 */
export function canAdjustPendingEnd(
  p: PendingLineComment,
  delta: -1 | 1,
  bounds?: PendingLineBounds,
): boolean {
  if (p.startSide && p.startSide !== p.side) return false
  const next = adjustPendingEnd(p, delta, bounds)
  return next.startLineNumber !== p.startLineNumber || next.lineNumber !== p.lineNumber
}
