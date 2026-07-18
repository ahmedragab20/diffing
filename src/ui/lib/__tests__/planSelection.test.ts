import { describe, it, expect } from 'vitest'
import {
  mapSelectionToLines,
  normalizePlanText,
  selectionIntersectsRoot,
} from '../planSelection'

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

  it('returns null for empty selection', () => {
    expect(mapSelectionToLines(body, '   ')).toBeNull()
  })

  it('allows single-character selections', () => {
    const sel = mapSelectionToLines(body, 'a')
    expect(sel).not.toBeNull()
    expect(sel!.startLine).toBeGreaterThanOrEqual(1)
  })

  it('finds list items even without the markdown bullet', () => {
    // Rendered list text is often "item b" without the leading "- ".
    const sel = mapSelectionToLines(body, 'item b')
    expect(sel?.startLine).toBe(8)
  })

  it('matches collapsed whitespace from rendered markdown', () => {
    const sel = mapSelectionToLines(body, 'Phase   one   does   the   thing.')
    expect(sel?.startLine).toBe(3)
  })

  it('normalizes nbsp from HTML selection', () => {
    expect(normalizePlanText('foo\u00a0bar')).toBe('foo bar')
    const sel = mapSelectionToLines(body, 'Phase\u00a0one does the thing.')
    expect(sel?.startLine).toBe(3)
  })
})

describe('selectionIntersectsRoot', () => {
  it('is true when common ancestor is inside root', () => {
    document.body.innerHTML = `<div id="root"><p id="p">hello world</p></div>`
    const root = document.getElementById('root')!
    const p = document.getElementById('p')!
    const range = document.createRange()
    range.selectNodeContents(p)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    expect(selectionIntersectsRoot(sel, root)).toBe(true)
  })

  it('is true when selection starts outside and ends inside (any direction)', () => {
    document.body.innerHTML = `
      <p id="out">outside</p>
      <div id="root"><p id="in">inside text</p></div>
    `
    const root = document.getElementById('root')!
    const out = document.getElementById('out')!
    const inn = document.getElementById('in')!
    const range = document.createRange()
    // Start in "outside", end in "inside" — simulates drag into the plan.
    range.setStart(out.firstChild!, 0)
    range.setEnd(inn.firstChild!, 6)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    expect(selectionIntersectsRoot(sel, root)).toBe(true)
  })
})
