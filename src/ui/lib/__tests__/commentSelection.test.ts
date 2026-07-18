// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  pendingFromSelection,
  pendingFromLine,
  pendingLineCount,
  pendingLineLabel,
  pendingOrderedRange,
  pendingSideLabel,
  selectionSide,
  selectedRangeFromPending,
  normalizePendingRange,
  adjustPendingStart,
  adjustPendingEnd,
  canAdjustPendingStart,
  canAdjustPendingEnd,
} from '../commentSelection.js'

describe('selectionSide', () => {
  it('prefers endSide, then side, then additions', () => {
    expect(selectionSide({ start: 1, end: 2, side: 'deletions', endSide: 'additions' })).toBe(
      'additions',
    )
    expect(selectionSide({ start: 1, end: 2, side: 'deletions' })).toBe('deletions')
    expect(selectionSide({ start: 1, end: 2 })).toBe('additions')
  })
})

describe('pendingFromSelection', () => {
  it('anchors same-side multi-line under the bottom line with ordered start', () => {
    expect(pendingFromSelection({ start: 10, end: 14, side: 'additions' })).toEqual({
      side: 'additions',
      lineNumber: 14,
      startLineNumber: 10,
    })
  })

  it('normalizes reverse (upward) selection so start ≤ end', () => {
    expect(pendingFromSelection({ start: 20, end: 12, side: 'deletions' })).toEqual({
      side: 'deletions',
      lineNumber: 20,
      startLineNumber: 12,
    })
  })

  it('does NOT default deletions to additions when endSide is omitted', () => {
    // Regression: endSide || 'additions' put the form on the wrong side and
    // often at the end of the file when no matching slot existed.
    expect(pendingFromSelection({ start: 5, end: 5, side: 'deletions' })).toEqual({
      side: 'deletions',
      lineNumber: 5,
    })
  })

  it('omits startLineNumber for a single line', () => {
    expect(pendingFromSelection({ start: 3, end: 3, side: 'additions' }).startLineNumber).toBeUndefined()
  })

  it('preserves cross-side anchors on the end side', () => {
    expect(
      pendingFromSelection({ start: 4, end: 9, side: 'deletions', endSide: 'additions' }),
    ).toEqual({
      side: 'additions',
      lineNumber: 9,
      startLineNumber: 4,
      startSide: 'deletions',
    })
  })
})

describe('pendingFromLine / labels', () => {
  it('builds a single-line pending from gutter click', () => {
    expect(pendingFromLine('additions', 7)).toEqual({ side: 'additions', lineNumber: 7 })
  })

  it('counts and labels multi-line ranges', () => {
    const p = pendingFromSelection({ start: 2, end: 5, side: 'additions' })
    expect(pendingLineCount(p)).toBe(4)
    expect(pendingLineLabel(p)).toBe('L2–L5 · new')
    expect(pendingSideLabel(p)).toBe('new')
    expect(pendingLineLabel(pendingFromLine('deletions', 1))).toBe('L1 · old')
  })

  it('round-trips to a SelectedLineRange for highlight sync', () => {
    const p = pendingFromSelection({ start: 8, end: 11, side: 'deletions' })
    expect(selectedRangeFromPending(p)).toEqual({
      start: 8,
      end: 11,
      side: 'deletions',
    })
  })
})

describe('normalizePendingRange', () => {
  it('orders inverted start/end and drops start when single line', () => {
    expect(
      normalizePendingRange({ side: 'additions', lineNumber: 3, startLineNumber: 10 }),
    ).toEqual({ side: 'additions', lineNumber: 10, startLineNumber: 3 })
    expect(
      normalizePendingRange({ side: 'additions', lineNumber: 5, startLineNumber: 5 }),
    ).toEqual({ side: 'additions', lineNumber: 5 })
  })
})

describe('adjustPendingStart / adjustPendingEnd', () => {
  const base = pendingFromSelection({ start: 10, end: 14, side: 'additions' })
  const bounds = { min: 1, max: 20 }

  it('expands start upward and shrinks toward end', () => {
    expect(adjustPendingStart(base, -1, bounds)).toEqual({
      side: 'additions',
      lineNumber: 14,
      startLineNumber: 9,
    })
    expect(adjustPendingStart(base, 1, bounds)).toEqual({
      side: 'additions',
      lineNumber: 14,
      startLineNumber: 11,
    })
  })

  it('cannot move start past end (collapses to single line)', () => {
    let p = base
    for (let i = 0; i < 10; i++) p = adjustPendingStart(p, 1, bounds)
    expect(p).toEqual({ side: 'additions', lineNumber: 14 })
    expect(pendingLineCount(p)).toBe(1)
  })

  it('expands end downward and shrinks toward start', () => {
    expect(adjustPendingEnd(base, 1, bounds)).toEqual({
      side: 'additions',
      lineNumber: 15,
      startLineNumber: 10,
    })
    expect(adjustPendingEnd(base, -1, bounds)).toEqual({
      side: 'additions',
      lineNumber: 13,
      startLineNumber: 10,
    })
  })

  it('clamps to bounds', () => {
    expect(adjustPendingStart(base, -100, bounds).startLineNumber).toBe(1)
    expect(adjustPendingEnd(base, 100, bounds).lineNumber).toBe(20)
  })

  it('canAdjust* reflects whether a step would change the range', () => {
    expect(canAdjustPendingStart(base, -1, bounds)).toBe(true)
    expect(canAdjustPendingEnd(base, 1, bounds)).toBe(true)
    const atMin = adjustPendingStart(base, -100, bounds)
    expect(canAdjustPendingStart(atMin, -1, bounds)).toBe(false)
    const single = pendingFromLine('additions', 5)
    expect(canAdjustPendingStart(single, 1, bounds)).toBe(false)
    expect(canAdjustPendingEnd(single, -1, bounds)).toBe(false)
    expect(canAdjustPendingEnd(single, 1, bounds)).toBe(true)
  })

  it('does not adjust cross-side drafts', () => {
    const cross = pendingFromSelection({
      start: 4,
      end: 9,
      side: 'deletions',
      endSide: 'additions',
    })
    expect(adjustPendingStart(cross, -1, bounds)).toEqual(cross)
    expect(canAdjustPendingStart(cross, -1, bounds)).toBe(false)
  })

  it('pendingOrderedRange returns inclusive start/end', () => {
    expect(pendingOrderedRange(base)).toEqual({ start: 10, end: 14 })
    expect(pendingOrderedRange(pendingFromLine('additions', 3))).toEqual({ start: 3, end: 3 })
  })
})
