// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatComments } from '../lib/comment-format.js'
import type { ReviewComment } from '../lib/types.js'

const base: ReviewComment = {
  id: 'c1',
  filePath: 'src/index.ts',
  side: 'additions',
  lineNumber: 10,
  lineContent: 'const x = 1',
  body: 'Consider renaming',
  status: 'open',
  createdAt: 1000,
  replies: [],
}

describe('formatComments', () => {
  it('returns an empty string for no comments', () => {
    expect(formatComments([])).toBe('')
  })

  it('wraps comments in the code-review-comments envelope', () => {
    const out = formatComments([base])
    expect(out).toContain('<code-review-comments>')
    expect(out).toContain('</code-review-comments>')
    expect(out).toContain('<file path="src/index.ts">')
    expect(out).toContain('<comment id="c1" line="10" side="additions" status="open" created-at="1970-01-01T00:00:01.000Z">')
    // no severity attr when omitted
    expect(out).toContain('<code><![CDATA[+ const x = 1]]></code>')
    expect(out).toContain('<body><![CDATA[Consider renaming]]></body>')
  })

  it('embeds an overall comment in a <general-comment> block when provided', () => {
    const out = formatComments([base], 'Prioritise the security fixes first')
    expect(out).toContain('<general-comment>')
    expect(out).toContain('<![CDATA[Prioritise the security fixes first]]>')
    expect(out).toContain('</general-comment>')
  })

  it('omits the <general-comment> block for blank or absent overall comments', () => {
    expect(formatComments([base])).not.toContain('<general-comment>')
    expect(formatComments([base], '   ')).not.toContain('<general-comment>')
  })

  it('uses line="file" for file-level comments and omits the code block', () => {
    const out = formatComments([{ ...base, lineNumber: 0 }])
    expect(out).toContain('line="file"')
    expect(out).not.toContain('<code><![CDATA[')
  })

  it('emits severity attribute when set (skips none)', () => {
    const out = formatComments([{ ...base, severity: 'blocking' }])
    expect(out).toContain('severity="blocking"')
    // Instructions mention the vocabulary; the <comment> tag itself must not
    // carry severity when unset / none.
    const noneOut = formatComments([{ ...base, severity: 'none' }])
    expect(noneOut).not.toMatch(/<comment[^>]*\sseverity=/)
    const bareOut = formatComments([base])
    expect(bareOut).not.toMatch(/<comment[^>]*\sseverity=/)
  })

  it('renders a line range when startLineNumber differs', () => {
    const out = formatComments([{ ...base, startLineNumber: 8, lineNumber: 10 }])
    expect(out).toContain('line="8-10"')
  })

  it('prefixes multi-line deletions content with "-"', () => {
    const out = formatComments([
      { ...base, side: 'deletions', lineContent: 'a()\nb()' },
    ])
    expect(out).toContain('- a()\n- b()')
  })

  it('stamps the root element with a decision and emits a decision summary', () => {
    const out = formatComments([base], undefined, 'changes-requested')
    expect(out).toContain('<code-review-comments decision="changes-requested">')
    expect(out).toContain('<decision-summary><![CDATA[')
    expect(out).toContain('REQUESTED EDITS')
  })

  it('omits the decision attribute and summary when no verdict is given', () => {
    const out = formatComments([base])
    expect(out).toContain('<code-review-comments>')
    expect(out).not.toContain('decision=')
    expect(out).not.toContain('<decision-summary>')
  })

  it('emits the envelope for a verdict with zero inline comments', () => {
    const out = formatComments([], undefined, 'approved')
    expect(out).toContain('<code-review-comments decision="approved">')
    expect(out).toContain('<decision-summary><![CDATA[')
    expect(out).not.toContain('<file ')
  })

  it('emits the envelope for an overall comment with no inline comments or verdict', () => {
    const out = formatComments([], 'Ship it once CI is green')
    expect(out).toContain('<code-review-comments>')
    expect(out).toContain('<![CDATA[Ship it once CI is green]]>')
    expect(out).not.toContain('<file ')
  })

  it('still returns an empty string with no comments, verdict, or overall note', () => {
    expect(formatComments([])).toBe('')
    expect(formatComments([], '   ')).toBe('')
  })

  it('renders replies with and without a model', () => {
    const out = formatComments([
      {
        ...base,
        replies: [
          { id: 'r1', body: 'Done', createdAt: 3000, role: 'agent', model: 'claude' },
          { id: 'r2', body: 'Thanks', createdAt: 4000, role: 'user' },
        ],
      },
    ])
    expect(out).toContain('<reply id="r1" created-at="1970-01-01T00:00:03.000Z" role="agent" model="claude">')
    expect(out).toContain('<reply id="r2" created-at="1970-01-01T00:00:04.000Z" role="user">')
    expect(out).toContain('<![CDATA[Done]]>')
  })

  it('orders file paths alphabetically so the XML is stable across clients', () => {
    const a: ReviewComment = { ...base, id: 'cA', filePath: 'src/z.ts' }
    const b: ReviewComment = { ...base, id: 'cB', filePath: 'src/a.ts' }
    const out = formatComments([a, b])
    const aIdx = out.indexOf('<file path="src/a.ts">')
    const zIdx = out.indexOf('<file path="src/z.ts">')
    expect(aIdx).toBeGreaterThan(-1)
    expect(zIdx).toBeGreaterThan(aIdx)
  })

  it('groups multiple comments under the same file even when added out of order', () => {
    const a1: ReviewComment = { ...base, id: 'cA1', filePath: 'src/index.ts', lineNumber: 5 }
    const a2: ReviewComment = { ...base, id: 'cA2', filePath: 'src/index.ts', lineNumber: 15 }
    const out = formatComments([a2, a1])
    const section = out.substring(
      out.indexOf('<file path="src/index.ts">'),
      out.indexOf('</file>'),
    )
    expect(section.indexOf('id="cA2"')).toBeLessThan(section.indexOf('id="cA1"'))
  })
})
