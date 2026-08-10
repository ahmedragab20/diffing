// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { FileDiffMetadata, Hunk } from '@pierre/diffs'
import { buildFileSearchCorpus, buildFileSearchEntries } from '../useDiffSearch'

/** Full-Hunk builder: fills every required Hunk field, overridable per fixture. */
function hunk(overrides: Partial<Hunk>): Hunk {
  return {
    collapsedBefore: 0,
    additionStart: 0,
    additionCount: 0,
    additionLines: 0,
    additionLineIndex: 0,
    deletionStart: 0,
    deletionCount: 0,
    deletionLines: 0,
    deletionLineIndex: 0,
    hunkContent: [],
    splitLineStart: 0,
    splitLineCount: 0,
    unifiedLineStart: 0,
    unifiedLineCount: 0,
    noEOFCRDeletions: false,
    noEOFCRAdditions: false,
    ...overrides,
  }
}

function file(name: string, hunks: Hunk[], additionLines: string[], deletionLines: string[]): FileDiffMetadata {
  return {
    name,
    type: 'change',
    hunks,
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines,
    additionLines,
  } as unknown as FileDiffMetadata
}

/** File "src/a.ts" — hunk at additionStart=100 / deletionStart=50. */
function fileA(): FileDiffMetadata {
  const additionLines = Array.from({ length: 20 }, (_, i) => `placeholder-a-${i}`)
  const deletionLines = Array.from({ length: 20 }, (_, i) => `placeholder-d-${i}`)
  additionLines[10] = 'ctx-before'
  additionLines[11] = 'added-line'
  additionLines[12] = 'ctx-after'
  additionLines[13] = '   '
  deletionLines[5] = 'removed-line'
  deletionLines[6] = ''

  return file(
    'src/a.ts',
    [
      hunk({
        additionStart: 100,
        deletionStart: 50,
        additionLineIndex: 10,
        deletionLineIndex: 5,
        hunkContent: [
          { type: 'context', lines: 1, additionLineIndex: 10, deletionLineIndex: 5 },
          {
            type: 'change',
            additions: 1,
            additionLineIndex: 11,
            deletions: 1,
            deletionLineIndex: 5,
          },
          { type: 'context', lines: 1, additionLineIndex: 12, deletionLineIndex: 6 },
          {
            type: 'change',
            additions: 1,
            additionLineIndex: 13,
            deletions: 1,
            deletionLineIndex: 6,
          },
        ],
      }),
    ],
    additionLines,
    deletionLines,
  )
}

/** File "src/b.ts" — hunk at additionStart=200 / deletionStart=150. */
function fileB(): FileDiffMetadata {
  const additionLines = Array.from({ length: 30 }, (_, i) => `placeholder-b-${i}`)
  const deletionLines = Array.from({ length: 30 }, (_, i) => `placeholder-db-${i}`)
  additionLines[20] = 'ctx'
  additionLines[21] = 'added'
  deletionLines[15] = 'removed'

  return file(
    'src/b.ts',
    [
      hunk({
        additionStart: 200,
        deletionStart: 150,
        additionLineIndex: 20,
        deletionLineIndex: 15,
        hunkContent: [
          { type: 'context', lines: 1, additionLineIndex: 20, deletionLineIndex: 15 },
          {
            type: 'change',
            additions: 1,
            additionLineIndex: 21,
            deletions: 1,
            deletionLineIndex: 15,
          },
        ],
      }),
    ],
    additionLines,
    deletionLines,
  )
}

describe('buildFileSearchEntries', () => {
  it('includes context + changed lines with exact lineNumbers and sides, in order', () => {
    expect(buildFileSearchEntries(fileA())).toEqual([
      { filePath: 'src/a.ts', lineNumber: 100, side: 'additions', content: 'ctx-before' },
      { filePath: 'src/a.ts', lineNumber: 101, side: 'additions', content: 'added-line' },
      { filePath: 'src/a.ts', lineNumber: 50, side: 'deletions', content: 'removed-line' },
      { filePath: 'src/a.ts', lineNumber: 102, side: 'additions', content: 'ctx-after' },
    ])
  })

  it('emits context lines once on the additions side with new-file numbering', () => {
    const contextEntries = buildFileSearchEntries(fileA()).filter((e) => e.content.startsWith('ctx-'))
    expect(contextEntries).toEqual([
      { filePath: 'src/a.ts', lineNumber: 100, side: 'additions', content: 'ctx-before' },
      { filePath: 'src/a.ts', lineNumber: 102, side: 'additions', content: 'ctx-after' },
    ])
  })

  it('skips blank and whitespace-only lines', () => {
    const entries = buildFileSearchEntries(fileA())
    expect(entries.some((e) => e.content === '   ' || e.content === '')).toBe(false)
    // The whitespace-only change segment (4) contributes nothing: only the 4
    // non-blank lines from segments 1-3 survive.
    expect(entries).toHaveLength(4)
  })
})

describe('buildFileSearchCorpus', () => {
  it('concatenates file entries in order with each filePath equal to the file name', () => {
    const corpus = buildFileSearchCorpus([fileA(), fileB()])

    expect(corpus).toEqual([
      // File "src/a.ts" entries
      { filePath: 'src/a.ts', lineNumber: 100, side: 'additions', content: 'ctx-before' },
      { filePath: 'src/a.ts', lineNumber: 101, side: 'additions', content: 'added-line' },
      { filePath: 'src/a.ts', lineNumber: 50, side: 'deletions', content: 'removed-line' },
      { filePath: 'src/a.ts', lineNumber: 102, side: 'additions', content: 'ctx-after' },
      // File "src/b.ts" entries
      { filePath: 'src/b.ts', lineNumber: 200, side: 'additions', content: 'ctx' },
      { filePath: 'src/b.ts', lineNumber: 201, side: 'additions', content: 'added' },
      { filePath: 'src/b.ts', lineNumber: 150, side: 'deletions', content: 'removed' },
    ])

    const fileAEntries = buildFileSearchEntries(fileA())
    const fileBEntries = buildFileSearchEntries(fileB())
    expect(corpus.slice(0, fileAEntries.length)).toEqual(fileAEntries)
    expect(corpus.slice(fileAEntries.length)).toEqual(fileBEntries)
    expect(corpus.every((e) => e.filePath === (e.filePath === 'src/a.ts' ? 'src/a.ts' : 'src/b.ts'))).toBe(true)
  })
})
