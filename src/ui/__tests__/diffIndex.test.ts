import { describe, it, expect } from 'vitest'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { DiffLineEntry } from '../hooks/useDiffSearch'
import {
  buildDiffFileSet,
  buildChangedLineKeys,
  classifyNavigation,
  decodeByteRanges,
  highlightRanges,
  fallbackFuzzyScore,
  extractSymbolsFromDiff,
} from '../lib/diffIndex'

const file = (name: string): FileDiffMetadata =>
  ({ name, type: 'change', hunks: [], splitLineCount: 0, unifiedLineCount: 0, isPartial: false, deletionLines: [], additionLines: [] } as unknown as FileDiffMetadata)

const entry = (filePath: string, lineNumber: number, side: 'additions' | 'deletions'): DiffLineEntry => ({
  filePath,
  lineNumber,
  side,
  content: 'x',
})

describe('buildDiffFileSet', () => {
  it('collects every diff file name', () => {
    const set = buildDiffFileSet([file('a.ts'), file('b/c.ts')])
    expect(set.has('a.ts')).toBe(true)
    expect(set.has('b/c.ts')).toBe(true)
    expect(set.size).toBe(2)
  })
})

describe('buildChangedLineKeys', () => {
  it('keys additions only (deletions never appear in the working tree)', () => {
    const keys = buildChangedLineKeys([
      entry('a.ts', 10, 'additions'),
      entry('a.ts', 20, 'deletions'),
      entry('b.ts', 5, 'additions'),
    ])
    expect(keys.has('a.ts:10')).toBe(true)
    expect(keys.has('b.ts:5')).toBe(true)
    expect(keys.has('a.ts:20')).toBe(false)
    expect(keys.size).toBe(2)
  })
})

describe('classifyNavigation', () => {
  const ctx = (over: Partial<Parameters<typeof classifyNavigation>[1]> = {}) => ({
    diffFileSet: new Set(['a.ts']),
    changedKeys: new Set(['a.ts:10']),
    customMode: false,
    staged: false,
    ...over,
  })

  it('file in diff -> scrollFile', () => {
    expect(classifyNavigation({ kind: 'file', path: 'a.ts' }, ctx())).toEqual({ type: 'scrollFile', path: 'a.ts' })
  })

  it('file not in diff -> preview', () => {
    expect(classifyNavigation({ kind: 'file', path: 'z.ts' }, ctx())).toEqual({ type: 'preview', path: 'z.ts' })
  })

  it('changed line in a plain working-tree diff -> scrollLine', () => {
    expect(classifyNavigation({ kind: 'line', path: 'a.ts', line: 10, match: 'foo' }, ctx())).toEqual({
      type: 'scrollLine',
      path: 'a.ts',
      line: 10,
      side: 'additions',
      match: 'foo',
    })
  })

  it('context line in a diff file -> scrollLine', () => {
    expect(classifyNavigation({ kind: 'line', path: 'a.ts', line: 99 }, ctx())).toEqual({
      type: 'scrollLine',
      path: 'a.ts',
      line: 99,
      side: 'additions',
      match: undefined,
    })
  })

  it('changed line and staged -> scrollLine', () => {
    const r = classifyNavigation({ kind: 'line', path: 'a.ts', line: 10 }, ctx({ staged: true }))
    expect(r.type).toBe('scrollLine')
  })

  it('changed line and custom revision mode -> scrollLine', () => {
    const r = classifyNavigation({ kind: 'line', path: 'a.ts', line: 10 }, ctx({ customMode: true }))
    expect(r.type).toBe('scrollLine')
  })

  it('line in a non-diff file -> preview', () => {
    const r = classifyNavigation({ kind: 'line', path: 'z.ts', line: 10 }, ctx())
    expect(r.type).toBe('preview')
  })
})

describe('decodeByteRanges', () => {
  it('passes ASCII byte ranges through unchanged', () => {
    expect(decodeByteRanges('const foo = 1', [[6, 9]])).toEqual([[6, 9]])
  })

  it('maps byte ranges to char ranges for multi-byte content', () => {
    // "café foo": 'é' is 2 bytes, so "foo" starts at byte 6 but char 5.
    const content = 'café foo'
    const byteStart = new TextEncoder().encode('café ').length // 6
    const byteEnd = byteStart + 3
    expect(decodeByteRanges(content, [[byteStart, byteEnd]])).toEqual([[5, 8]])
  })

  it('drops ranges that split a multi-byte character', () => {
    // byte 4 is the middle of 'é' (bytes 3-4) — not a char boundary.
    expect(decodeByteRanges('café', [[4, 6]])).toBeNull()
  })

  it('ignores out-of-bounds and empty ranges', () => {
    expect(decodeByteRanges('abc', [[5, 9]])).toBeNull()
    expect(decodeByteRanges('abc', [])).toBeNull()
  })
})

describe('highlightRanges', () => {
  it('falls back to literal query occurrences when no ranges given', () => {
    expect(highlightRanges('foo bar foo', undefined, 'foo')).toEqual([
      [0, 3],
      [8, 11],
    ])
  })

  it('merges overlapping/adjacent ranges and clamps to bounds', () => {
    expect(highlightRanges('abcdef', [[0, 3], [2, 4], [10, 20]], '')).toEqual([[0, 4]])
  })
})

describe('fallbackFuzzyScore', () => {
  it('matches subsequences and rejects non-subsequences', () => {
    expect(fallbackFuzzyScore('SearchPalette.tsx', 'srchpal')).not.toBeNull()
    expect(fallbackFuzzyScore('abc', 'xyz')).toBeNull()
  })
  it('ranks contiguous matches higher than spread-out ones', () => {
    const contig = fallbackFuzzyScore('foobar', 'foo')!
    const spread = fallbackFuzzyScore('faofo', 'foo')! // subsequence, but spread out
    expect(contig).toBeGreaterThan(spread)
  })
})

describe('extractSymbolsFromDiff', () => {
  it('extracts symbol definitions only from addition lines', () => {
    const entries: DiffLineEntry[] = [
      entry('src/ui/utils.ts', 10, 'additions'),
      {
        filePath: 'src/ui/utils.ts',
        lineNumber: 11,
        side: 'additions',
        content: 'export function myNewFn() {',
      },
      {
        filePath: 'src/ui/utils.ts',
        lineNumber: 12,
        side: 'deletions',
        content: 'export function deletedFn() {',
      },
    ]

    const symbols = extractSymbolsFromDiff(entries)
    expect(symbols.length).toBe(1)
    expect(symbols[0]).toEqual({
      name: 'myNewFn',
      kind: 'function',
      path: 'src/ui/utils.ts',
      fileName: 'utils.ts',
      line: 11,
      content: 'export function myNewFn() {',
      matchRanges: [[16, 23]],
      gitStatus: '',
    })
  })
})

