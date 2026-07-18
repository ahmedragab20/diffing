// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildReviewPayload,
  decisionToEvent,
  expandMultiLineComments,
  parsePrRef,
} from '../github.js'
import type { ReviewComment } from '../types.js'

function c(
  partial: Partial<ReviewComment> & { filePath: string; body: string; lineNumber: number },
): ReviewComment {
  return {
    id: partial.id ?? `c-${partial.lineNumber}`,
    side: partial.side ?? 'additions',
    startLineNumber: partial.startLineNumber,
    lineContent: partial.lineContent ?? '',
    status: partial.status ?? 'open',
    createdAt: partial.createdAt ?? 1000,
    replies: partial.replies ?? [],
    ...partial,
  } as ReviewComment
}

describe('decisionToEvent', () => {
  it('approve → APPROVE', () => {
    expect(decisionToEvent('approve')).toBe('APPROVE')
  })
  it('request-changes → REQUEST_CHANGES', () => {
    expect(decisionToEvent('request-changes')).toBe('REQUEST_CHANGES')
  })
  it('comment → COMMENT', () => {
    expect(decisionToEvent('comment')).toBe('COMMENT')
  })
  it('draft → null (pending review, omit event)', () => {
    expect(decisionToEvent('draft')).toBeNull()
  })
})

describe('expandMultiLineComments', () => {
  it('emits one entry per single-line comment on the RIGHT side', () => {
    const out = expandMultiLineComments([
      c({ filePath: 'a/foo.ts', lineNumber: 10, body: 'hi' }),
    ])
    expect(out).toEqual([
      { path: 'foo.ts', line: 10, side: 'RIGHT', body: 'hi' },
    ])
  })

  it('maps deletions side to LEFT', () => {
    const out = expandMultiLineComments([
      c({ filePath: 'a/foo.ts', lineNumber: 3, side: 'deletions', body: 'gone' }),
    ])
    expect(out).toEqual([
      { path: 'foo.ts', line: 3, side: 'LEFT', body: 'gone' },
    ])
  })

  it('emits a single multi-line comment with start_line/line (no N-part explosion)', () => {
    const out = expandMultiLineComments([
      c({ filePath: 'a/foo.ts', lineNumber: 12, startLineNumber: 10, body: 'range comment' }),
    ])
    expect(out).toEqual([
      {
        path: 'foo.ts',
        line: 12,
        start_line: 10,
        side: 'RIGHT',
        start_side: 'RIGHT',
        body: 'range comment',
      },
    ])
  })

  it('strips b/ prefix from the path', () => {
    const out = expandMultiLineComments([
      c({ filePath: 'b/src/server.ts', lineNumber: 5, body: 'x' }),
    ])
    expect(out[0].path).toBe('src/server.ts')
  })

  it('skips resolved comments', () => {
    const out = expandMultiLineComments([
      c({ filePath: 'a/x.ts', lineNumber: 1, body: 'open', status: 'open' }),
      c({ filePath: 'a/x.ts', lineNumber: 2, body: 'resolved', status: 'resolved' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].line).toBe(1)
  })

  it('skips file-level comments (lineNumber === 0)', () => {
    const out = expandMultiLineComments([
      c({ filePath: 'a/x.ts', lineNumber: 0, body: 'file-level' }),
    ])
    expect(out).toEqual([])
  })
})

describe('buildReviewPayload', () => {
  it('empty review body, no comments → empty comments, COMMENT event', () => {
    const payload = buildReviewPayload({ decision: 'comment' })
    expect(payload).toEqual({ body: undefined, event: 'COMMENT', comments: [] })
  })

  it('draft omits event so GitHub creates a PENDING review', () => {
    const payload = buildReviewPayload({
      decision: 'draft',
      body: 'WIP notes',
      comments: [c({ filePath: 'a/x.ts', lineNumber: 1, body: 'nit' })],
    })
    expect(payload.event).toBeUndefined()
    expect(payload.body).toBe('WIP notes')
    expect(payload.comments).toHaveLength(1)
    expect('event' in payload).toBe(false)
  })

  it('with a body and no comments → COMMENT event with body', () => {
    const payload = buildReviewPayload({ decision: 'comment', body: 'Looks fine overall' })
    expect(payload).toEqual({
      body: 'Looks fine overall',
      event: 'COMMENT',
      comments: [],
    })
  })

  it('approve with comments → APPROVE event', () => {
    const payload = buildReviewPayload({
      decision: 'approve',
      comments: [c({ filePath: 'a/x.ts', lineNumber: 1, body: 'nit' })],
    })
    expect(payload.event).toBe('APPROVE')
    expect(payload.comments).toEqual([
      { path: 'x.ts', line: 1, side: 'RIGHT', body: 'nit' },
    ])
  })

  it('multi-line comment + folds file-level into the review body', () => {
    const payload = buildReviewPayload({
      decision: 'request-changes',
      body: 'Please address the range',
      comments: [
        c({ filePath: 'a/src/x.ts', lineNumber: 5, body: 'single' }),
        c({
          filePath: 'b/src/y.ts',
          lineNumber: 12,
          startLineNumber: 10,
          body: 'range',
        }),
        c({ filePath: 'a/z.ts', lineNumber: 0, body: 'file-level note' }),
      ],
    })
    expect(payload.event).toBe('REQUEST_CHANGES')
    expect(payload.comments).toEqual([
      { path: 'src/x.ts', line: 5, side: 'RIGHT', body: 'single' },
      {
        path: 'src/y.ts',
        line: 12,
        start_line: 10,
        side: 'RIGHT',
        start_side: 'RIGHT',
        body: 'range',
      },
    ])
    expect(payload.body).toContain('Please address the range')
    expect(payload.body).toContain('### File comments')
    expect(payload.body).toContain('z.ts')
    expect(payload.body).toContain('file-level note')
  })

  it('NEVER includes existingComments in the payload (read-only context only)', () => {
    // The payload only reads from `comments`; the read-only `existingComments`
    // array from the PrSession is structurally separate and never reaches the
    // POST. This test enforces that contract at the unit level.
    const payload = buildReviewPayload({
      decision: 'comment',
      comments: [],
      // @ts-expect-error — `existingComments` is on PrSession, not on SubmitInput
      existingComments: [{ id: 1, body: 'should be ignored' }],
    })
    expect(payload.comments).toEqual([])
  })
})

describe('parsePrRef', () => {
  const cwdRepo = { owner: 'acme', repo: 'widget' }

  it('parses a full URL', () => {
    expect(parsePrRef('https://github.com/foo/bar/pull/42', cwdRepo)).toEqual({
      owner: 'foo',
      repo: 'bar',
      pullNumber: 42,
      ref: 'https://github.com/foo/bar/pull/42',
    })
  })

  it('parses owner/repo#N shorthand', () => {
    expect(parsePrRef('foo/bar#42', cwdRepo)).toEqual({
      owner: 'foo',
      repo: 'bar',
      pullNumber: 42,
      ref: 'foo/bar#42',
    })
  })

  it('resolves a bare number against the cwd repo', () => {
    expect(parsePrRef('42', cwdRepo)).toEqual({
      owner: 'acme',
      repo: 'widget',
      pullNumber: 42,
      ref: '42',
    })
  })

  it('throws on a bare number without a cwd repo', () => {
    expect(() => parsePrRef('42')).toThrow(/run from inside the target repo/)
  })

  it('throws on garbage input', () => {
    expect(() => parsePrRef('not-a-pr', cwdRepo)).toThrow(/Unrecognised PR ref/)
  })

  it('trims whitespace', () => {
    expect(parsePrRef('  7  ', cwdRepo)).toEqual({
      owner: 'acme',
      repo: 'widget',
      pullNumber: 7,
      ref: '7',
    })
  })
})
