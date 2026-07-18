// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatComments } from '../comment-format.js'
import type { ReviewComment } from '../types.js'

function c(
  partial: Partial<ReviewComment> & { filePath: string; body: string; lineNumber: number },
): ReviewComment {
  return {
    id: partial.id ?? `c-${partial.lineNumber}`,
    filePath: partial.filePath,
    side: partial.side ?? 'additions',
    lineNumber: partial.lineNumber,
    startLineNumber: partial.startLineNumber,
    lineContent: partial.lineContent ?? '',
    body: partial.body,
    status: partial.status ?? 'open',
    createdAt: partial.createdAt ?? 1,
    replies: partial.replies ?? [],
    severity: partial.severity,
  }
}

describe('formatComments multi-line ranges', () => {
  it('emits inclusive line="A-B" and multi-line code CDATA with side prefixes', () => {
    const xml = formatComments([
      c({
        filePath: 'src/a.ts',
        lineNumber: 12,
        startLineNumber: 10,
        lineContent: 'const a = 1\nconst b = 2\nconst c = 3',
        body: 'Please extract this block',
      }),
    ])

    expect(xml).toContain('line="10-12"')
    expect(xml).toContain('side="additions"')
    expect(xml).toMatch(/<code><!\[CDATA\[\n\+ const a = 1\n\+ const b = 2\n\+ const c = 3\n\]\]><\/code>/)
    expect(xml).toContain('Please extract this block')
    expect(xml).toContain('When line="A-B", the range is INCLUSIVE')
  })

  it('emits single-line form without start when no startLineNumber', () => {
    const xml = formatComments([
      c({
        filePath: 'src/b.ts',
        lineNumber: 5,
        lineContent: 'foo()',
        body: 'nit',
        side: 'deletions',
      }),
    ])
    expect(xml).toContain('line="5"')
    expect(xml).not.toContain('line="5-5"')
    expect(xml).toContain('<code><![CDATA[- foo()]]></code>')
  })

  it('emits severity on diff comments and omits severity="none" on the comment element', () => {
    const withSev = formatComments([
      c({
        filePath: 'src/a.ts',
        lineNumber: 10,
        lineContent: 'x',
        body: 'Must fix',
        severity: 'blocking',
      }),
    ])
    expect(withSev).toMatch(/<comment[^>]* severity="blocking"/)
    expect(withSev).toContain('Optional severity="blocking|nit|question|praise"')

    const none = formatComments([
      c({
        filePath: 'src/a.ts',
        lineNumber: 10,
        lineContent: 'x',
        body: 'plain',
        severity: 'none',
      }),
    ])
    // Instructions may mention severity; the comment tag must not carry severity="none".
    expect(none).not.toMatch(/<comment[^>]*severity="none"/)
    expect(none).toMatch(/status="open" created-at=/)

    const missing = formatComments([
      c({
        filePath: 'src/a.ts',
        lineNumber: 10,
        lineContent: 'x',
        body: 'plain',
      }),
    ])
    expect(missing).not.toMatch(/<comment[^>]* severity=/)
  })
})
