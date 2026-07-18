// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  pendingFromSelection,
  pendingFromLine,
  pendingLineCount,
  pendingLineLabel,
  selectionSide,
  selectedRangeFromPending,
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
