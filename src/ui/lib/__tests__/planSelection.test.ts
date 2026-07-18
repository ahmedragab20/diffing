import { describe, it, expect } from 'vitest'
import { mapSelectionToLines } from '../planSelection'

describe('mapSelectionToLines', () => {
  const body = `# Title

Phase one does the thing.

## Details

- item a
- item b
`

  it('maps an exact multi-line selection', () => {
    const sel = mapSelectionToLines(body, 'Phase one does the thing.')
    expect(sel).toEqual({
      text: 'Phase one does the thing.',
      startLine: 3,
      endLine: 3,
    })
  })

  it('returns null for empty / too-short selection', () => {
    expect(mapSelectionToLines(body, 'a')).toBeNull()
    expect(mapSelectionToLines(body, '   ')).toBeNull()
  })

  it('finds list items', () => {
    const sel = mapSelectionToLines(body, '- item b')
    expect(sel?.startLine).toBe(8)
  })
})
