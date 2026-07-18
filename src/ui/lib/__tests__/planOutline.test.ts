import { describe, it, expect } from 'vitest'
import { buildPlanOutline } from '../planOutline'

describe('buildPlanOutline', () => {
  it('extracts ATX headings with stable ids', () => {
    const body = `# Title

intro

## Phase 1

### Detail

## Phase 2
`
    expect(buildPlanOutline(body)).toEqual([
      { level: 1, text: 'Title', id: 'title', line: 1 },
      { level: 2, text: 'Phase 1', id: 'phase-1', line: 5 },
      { level: 3, text: 'Detail', id: 'detail', line: 7 },
      { level: 2, text: 'Phase 2', id: 'phase-2', line: 9 },
    ])
  })

  it('dedupes colliding slugs', () => {
    const items = buildPlanOutline('# Foo\n\n# Foo\n')
    expect(items.map((i) => i.id)).toEqual(['foo', 'foo-2'])
  })

  it('returns empty for body without headings', () => {
    expect(buildPlanOutline('just prose\n')).toEqual([])
  })
})
