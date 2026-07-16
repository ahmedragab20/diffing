// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatCommentsMarkdown } from '../lib/review-export.js'
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

describe('formatCommentsMarkdown', () => {
  it('returns empty string when no comments, no decision, and no general note', () => {
    expect(formatCommentsMarkdown([], undefined, undefined, undefined)).toBe('')
    expect(formatCommentsMarkdown([], '   ', undefined, undefined)).toBe('')
  })

  it('renders a verdict block when a decision is provided (even with no comments)', () => {
    const out = formatCommentsMarkdown([], undefined, 'approved', undefined)
    expect(out).toMatch(/\*\*Verdict:\*\* `approved`/)
  })

  it('hides the mode suffix when mode is standard', () => {
    const out = formatCommentsMarkdown([base], undefined, 'approved', 'standard')
    expect(out).not.toContain('mode `standard`')
  })

  it('shows mode suffix when comment-only', () => {
    const out = formatCommentsMarkdown([base], undefined, 'approved', 'comment-only')
    expect(out).toMatch(/· mode `comment-only`/)
  })

  it('renders the overall note under "## Overall note"', () => {
    const out = formatCommentsMarkdown([], 'Spotted a regression here', 'changes-requested', undefined)
    expect(out).toContain('## Overall note')
    expect(out).toContain('Spotted a regression here')
  })

  it('escapes only text outside of the diff fence (markdown is plain)', () => {
    const out = formatCommentsMarkdown([base], undefined, undefined, undefined)
    expect(out).toContain('## `src/index.ts`')
    expect(out).toContain('### L10 · additions · open')
    expect(out).toContain('```diff')
    expect(out).toContain('+ const x = 1')
    expect(out).toContain('```')
    expect(out).toContain('Consider renaming')
  })

  it('uses "file" for whole-file comments (lineNumber 0)', () => {
    const whole: ReviewComment = {
      ...base,
      id: 'c2',
      lineNumber: 0,
      lineContent: '',
    }
    const out = formatCommentsMarkdown([whole], undefined, undefined, undefined)
    expect(out).toContain('### file · additions · open')
    expect(out).not.toContain('```diff')
  })

  it('marks resolved comments with their status', () => {
    const resolved: ReviewComment = { ...base, id: 'c3', status: 'resolved' }
    const out = formatCommentsMarkdown([resolved], undefined, undefined, undefined)
    expect(out).toContain('### L10 · additions · resolved')
  })

  it('orders files alphabetically so exports are stable', () => {
    const a: ReviewComment = { ...base, id: 'cA', filePath: 'src/z.ts' }
    const b: ReviewComment = { ...base, id: 'cB', filePath: 'src/a.ts' }
    const out = formatCommentsMarkdown([a, b], undefined, undefined, undefined)
    const firstIdx = out.indexOf('## `src/a.ts`')
    const secondIdx = out.indexOf('## `src/z.ts`')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(secondIdx).toBeGreaterThan(firstIdx)
  })

  it('renders multi-line spans as a single diff block with prefix on each line', () => {
    const c: ReviewComment = {
      ...base,
      id: 'm1',
      startLineNumber: 10,
      lineNumber: 12,
      lineContent: 'a\nb\nc',
    }
    const out = formatCommentsMarkdown([c], undefined, undefined, undefined)
    expect(out).toContain('### L10–12 · additions · open')
    expect(out).toContain('+ a\n+ b\n+ c')
  })

  it('uses "-" prefix for deletions side', () => {
    const c: ReviewComment = {
      ...base,
      id: 'd1',
      side: 'deletions',
      lineContent: 'return null',
    }
    const out = formatCommentsMarkdown([c], undefined, undefined, undefined)
    expect(out).toContain('- return null')
  })

  it('renders agent replies with role and optional model', () => {
    const c: ReviewComment = {
      ...base,
      id: 'r1',
      replies: [
        { id: 'rep1', body: 'Looks good.', createdAt: 2000, role: 'agent', model: 'gpt-mini' },
        { id: 'rep2', body: 'Updated to `bar()`', createdAt: 2100, role: 'user' },
      ],
    }
    const out = formatCommentsMarkdown([c], undefined, undefined, undefined)
    expect(out).toContain('> **agent (gpt-mini):** Looks good.')
    expect(out).toContain('> **reviewer:** Updated to `bar()`')
  })

  it('renders "_No inline comments._" when only the verdict/note exist', () => {
    const out = formatCommentsMarkdown([], 'LGTM', 'comment-only', undefined)
    expect(out).toContain('_No inline comments._')
  })

  it('still renders when a comment body is blank (the writer renders the literal)', () => {
    const blank: ReviewComment = { ...base, body: '   ', replies: [] }
    const out = formatCommentsMarkdown([blank], undefined, undefined, undefined)
    expect(out).toContain('## `src/index.ts`')
  })
})
