// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatPlanReview, sectionTitleForLine, extractPlanLines, decisionSummary } from '../lib/plan-format.js'
import type { Plan } from '../lib/plan-types.js'

const PLAN_BODY = `# Title

## Phase 1
Do the first thing

## Phase 2
Do the second thing`

const base: Plan = {
  id: 'p1',
  title: 'My Plan',
  body: PLAN_BODY,
  source: 'claude-code',
  model: 'opus',
  createdAt: 1000,
  updatedAt: 1000,
  version: 1,
  decision: 'pending',
  comments: [],
}

describe('formatPlanReview', () => {
  it('wraps the plan in the plan-review envelope with the verdict and body', () => {
    const out = formatPlanReview({ ...base, decision: 'approved', decidedAt: 2000 })
    expect(out).toContain('<plan-review>')
    expect(out).toContain('</plan-review>')
    expect(out).toContain('<plan id="p1" title="My Plan" version="1" decision="approved" decided-at="1970-01-01T00:00:02.000Z">')
    expect(out).toContain('<decision-summary><![CDATA[The reviewer APPROVED this plan.')
    expect(out).toContain('<plan-body><![CDATA[# Title')
  })

  it('embeds the overall decision comment when present', () => {
    const out = formatPlanReview({ ...base, decision: 'rejected', decisionComment: 'Wrong approach' })
    expect(out).toContain('<decision-comment><![CDATA[Wrong approach]]></decision-comment>')
  })

  it('omits the decision comment when absent', () => {
    // The instructions block mentions the tag name as prose, so assert on the
    // CDATA-bearing element rather than the bare string.
    expect(formatPlanReview(base)).not.toContain('<decision-comment><![CDATA[')
  })

  it('renders a line comment with section, context, and status', () => {
    const out = formatPlanReview({
      ...base,
      comments: [
        {
          id: 'c1',
          lineNumber: 4,
          lineContent: 'Do the first thing',
          sectionTitle: 'Phase 1',
          body: 'Clarify this',
          status: 'open',
          createdAt: 3000,
          replies: [],
        },
      ],
    })
    expect(out).toContain('<comment id="c1" line="4" section="Phase 1" status="open" created-at="1970-01-01T00:00:03.000Z">')
    expect(out).toContain('<context><![CDATA[Do the first thing]]></context>')
    expect(out).toContain('<body><![CDATA[Clarify this]]></body>')
  })

  it('renders a range comment and a whole-plan comment label', () => {
    const out = formatPlanReview({
      ...base,
      comments: [
        { id: 'c1', lineNumber: 7, startLineNumber: 6, lineContent: '## Phase 2\nDo the second thing', body: 'x', status: 'open', createdAt: 3000, replies: [] },
        { id: 'c2', lineNumber: 0, lineContent: '', body: 'whole plan note', status: 'open', createdAt: 4000, replies: [] },
      ],
    })
    expect(out).toContain('line="6-7"')
    expect(out).toContain('line="plan"')
  })

  it('omits the context block for whole-plan comments', () => {
    const out = formatPlanReview({
      ...base,
      comments: [{ id: 'c2', lineNumber: 0, lineContent: '', body: 'note', status: 'open', createdAt: 4000, replies: [] }],
    })
    expect(out).not.toContain('<context><![CDATA[')
  })

  it('renders replies with role and model', () => {
    const out = formatPlanReview({
      ...base,
      comments: [
        {
          id: 'c1',
          lineNumber: 4,
          lineContent: 'Do the first thing',
          body: 'Clarify',
          status: 'open',
          createdAt: 3000,
          replies: [{ id: 'r1', body: 'Done', createdAt: 5000, role: 'agent', model: 'opus' }],
        },
      ],
    })
    expect(out).toContain('<reply id="r1" created-at="1970-01-01T00:00:05.000Z" role="agent" model="opus">')
    expect(out).toContain('<![CDATA[Done]]>')
  })

  it('escapes special characters in attribute values', () => {
    const out = formatPlanReview({ ...base, title: 'A "quoted" & <tagged> plan' })
    expect(out).toContain('title="A &quot;quoted&quot; &amp; &lt;tagged&gt; plan"')
  })
})

describe('decisionSummary', () => {
  it('gives distinct guidance per verdict', () => {
    expect(decisionSummary('approved')).toMatch(/APPROVED/)
    expect(decisionSummary('rejected')).toMatch(/REJECTED/)
    expect(decisionSummary('changes-requested')).toMatch(/REQUESTED CHANGES/)
    expect(decisionSummary('pending')).toMatch(/not been decided/)
  })
})

describe('sectionTitleForLine', () => {
  it('finds the nearest preceding heading', () => {
    expect(sectionTitleForLine(PLAN_BODY, 4)).toBe('Phase 1')
    expect(sectionTitleForLine(PLAN_BODY, 7)).toBe('Phase 2')
    expect(sectionTitleForLine(PLAN_BODY, 1)).toBe('Title')
  })

  it('returns undefined when no heading precedes the line', () => {
    expect(sectionTitleForLine('plain line\nanother', 2)).toBeUndefined()
  })
})

describe('extractPlanLines', () => {
  it('snapshots a single line', () => {
    expect(extractPlanLines(PLAN_BODY, 4, 4)).toBe('Do the first thing')
  })

  it('snapshots an inclusive range', () => {
    expect(extractPlanLines(PLAN_BODY, 6, 7)).toBe('## Phase 2\nDo the second thing')
  })

  it('clamps out-of-range requests', () => {
    expect(extractPlanLines('only line', 1, 99)).toBe('only line')
    expect(extractPlanLines('x', 5, 6)).toBe('')
  })
})
