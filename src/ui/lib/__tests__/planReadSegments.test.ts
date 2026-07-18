// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildPlanReadSegments } from '../planReadSegments.js'
import { buildPlanOutline } from '../planOutline.js'
import type { PlanComment } from '../../../lib/plan-types.js'

function c(partial: Partial<PlanComment> & { id: string; lineNumber: number }): PlanComment {
  return {
    id: partial.id,
    lineNumber: partial.lineNumber,
    startLineNumber: partial.startLineNumber,
    body: partial.body ?? 'x',
    status: partial.status ?? 'open',
    createdAt: 1,
    createdAtPlanVersion: 1,
    replies: [],
    lineContent: partial.lineContent ?? '',
    sectionTitle: partial.sectionTitle,
  }
}

const body = `# Test Plan – Dumb Test

Just verifying the plan review loop works.

## Changes

1. Add a hello endpoint
2. Return json
3. Nothing else

## Risks

None.
`

describe('buildPlanReadSegments', () => {
  it('splits by outline headings and attaches comments by end line', () => {
    const outline = buildPlanOutline(body)
    const segments = buildPlanReadSegments(body, outline, [
      c({ id: 'a', lineNumber: 3, startLineNumber: 1, body: 'hi hi' }),
      c({ id: 'b', lineNumber: 6, body: 'hi agent' }),
    ])

    expect(segments.map((s) => s.key)).toEqual(
      outline.map((o) => o.id),
    )

    const titleSeg = segments.find((s) => s.markdown.includes('Just verifying'))
    expect(titleSeg?.comments.map((x) => x.id)).toEqual(['a'])

    const changesSeg = segments.find((s) => s.key.includes('changes') || s.markdown.includes('hello endpoint'))
    expect(changesSeg?.comments.map((x) => x.id)).toEqual(['b'])
  })

  it('handles body with no headings', () => {
    const segments = buildPlanReadSegments('plain text\nonly', [], [
      c({ id: 'z', lineNumber: 1 }),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0]!.key).toBe('preamble')
    expect(segments[0]!.comments).toHaveLength(1)
  })
})
