// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  isCommentOutdated,
  markOutdatedComments,
  stripDiffMarkers,
} from '../lib/comment-outdated.js'
import type { ReviewComment } from '../lib/types.js'

function c(partial: Partial<ReviewComment> & { lineContent: string; lineNumber?: number }): ReviewComment {
  return {
    id: '1',
    filePath: 'a.ts',
    side: 'additions',
    lineNumber: partial.lineNumber ?? 1,
    lineContent: partial.lineContent,
    body: 'x',
    status: 'open',
    createdAt: 1,
    replies: [],
    ...partial,
  }
}

describe('stripDiffMarkers', () => {
  it('strips leading +/- markers', () => {
    expect(stripDiffMarkers('+const x = 1\n-const y = 2')).toBe('const x = 1\nconst y = 2')
  })
})

describe('isCommentOutdated', () => {
  it('is false when snapshot is still in the file', () => {
    expect(isCommentOutdated(c({ lineContent: '+foo()' }), 'bar\nfoo()\nbaz')).toBe(false)
  })

  it('is true when snapshot is gone', () => {
    expect(isCommentOutdated(c({ lineContent: '+foo()' }), 'bar\nbaz')).toBe(true)
  })

  it('never flags file-level comments', () => {
    expect(isCommentOutdated(c({ lineContent: 'x', lineNumber: 0 }), 'nope')).toBe(false)
  })

  it('is false when haystack is missing', () => {
    expect(isCommentOutdated(c({ lineContent: '+foo()' }), null)).toBe(false)
  })
})

describe('markOutdatedComments', () => {
  it('sets outdated flags from the file map', () => {
    const comments = [
      c({ id: 'a', filePath: 'a.ts', lineContent: '+keep' }),
      c({ id: 'b', filePath: 'b.ts', lineContent: '+gone' }),
    ]
    const map = new Map([
      ['a.ts', 'keep\n'],
      ['b.ts', 'other\n'],
    ])
    const out = markOutdatedComments(comments, map)
    expect(out[0].outdated).toBe(false)
    expect(out[1].outdated).toBe(true)
  })
})
