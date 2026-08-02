// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  mapSelectionToLines,
  measureQuoteInRoot,
  normalizePlanText,
  resolvePlanSelectionLines,
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

describe('measureQuoteInRoot', () => {
  it('returns page rects for text in the plan body and ignores comment hosts', () => {
    document.body.innerHTML = `
      <div class="plan-rendered" id="root">
        <h2>Changes</h2>
        <ol>
          <li>Add a hello endpoint to the server.</li>
          <li>Return message</li>
        </ol>
        <div class="plan-read-comment-host">
          <p>Hi Agent! should not match</p>
        </div>
      </div>
    `
    const root = document.getElementById('root') as HTMLElement
    // jsdom often returns zero client rects — still ensure we don't throw and
    // prefer body text over comment hosts when matching.
    const rects = measureQuoteInRoot(root, 'Add a hello endpoint to the server.')
    // In jsdom getClientRects is empty; function may return []. Smoke: no throw.
    expect(Array.isArray(rects)).toBe(true)

    const agentLeak = measureQuoteInRoot(root, 'Hi Agent! should not match')
    expect(agentLeak).toEqual([])
  })
})

describe('resolvePlanSelectionLines', () => {
  const body = `# Title

## Details

Specific line content here

`

  // Helper: build a range selecting across two text nodes by setStart/setEnd.
  function makeRange(
    startNode: Node,
    startOffset: number,
    endNode: Node,
    endOffset: number,
  ): Range {
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  }

  // Minimal react-markdown-style segment: `#` anchor glyph as a real text node
  // inside the heading, followed by the raw heading/paragraph text.
  function renderSegment(): void {
    document.body.innerHTML = `
      <div class="plan-rendered">
        <div class="plan-read-segment" data-plan-source-start="3" data-plan-source-end="6">
          <h2><a class="md-heading-anchor">#</a>Details</h2>
          <p>Specific line content here</p>
        </div>
      </div>
    `
  }

  it('strips the heading-anchor # glyph and maps onto the paragraph line', () => {
    renderSegment()
    const anchor = document.querySelector('.md-heading-anchor')!
    const para = document.querySelector('.plan-read-segment p')!
    const range = makeRange(anchor.firstChild!, 0, para.firstChild!, para.textContent!.length)
    // Selection brushed the heading, so toString() picks up a leading "#".
    const sel = resolvePlanSelectionLines(body, '#Specific line content here', range)
    expect(sel).toEqual({ text: 'Specific line content here', startLine: 5, endLine: 5 })
  })

  it('maps a clean in-segment selection without touching the heading', () => {
    renderSegment()
    const para = document.querySelector('.plan-read-segment p')!
    const range = makeRange(para.firstChild!, 0, para.firstChild!, para.textContent!.length)
    const sel = resolvePlanSelectionLines(body, 'Specific line content here', range)
    expect(sel).toEqual({ text: 'Specific line content here', startLine: 5, endLine: 5 })
  })

  it('falls back to whole-body matching for selections outside any segment', () => {
    const body = `# Title

Phase one does the thing.

## Details

- item a
- item b
`
    document.body.innerHTML = `<div id="root"><p>Phase one does the thing.</p></div>`
    const p = document.querySelector('#root p')!
    const range = makeRange(p.firstChild!, 0, p.firstChild!, p.textContent!.length)
    const sel = resolvePlanSelectionLines(body, 'Phase one does the thing.', range)
    expect(sel).toEqual({ text: 'Phase one does the thing.', startLine: 3, endLine: 3 })
  })

  it('anchors to the section range when segment text cannot be matched', () => {
    renderSegment()
    const para = document.querySelector('.plan-read-segment p')!
    const range = makeRange(para.firstChild!, 0, para.firstChild!, para.textContent!.length)
    const sel = resolvePlanSelectionLines(body, 'zzzznomatch', range)
    expect(sel).toEqual({ text: 'zzzznomatch', startLine: 3, endLine: 6 })
  })

  it('strips only a leading # and resolves to the heading line', () => {
    const body = `# Title

## Title

Specific line content here

`
    document.body.innerHTML = `
      <div class="plan-rendered">
        <div class="plan-read-segment" data-plan-source-start="3" data-plan-source-end="6">
          <h2><a class="md-heading-anchor">#</a>Title</h2>
          <p>Specific line content here</p>
        </div>
      </div>
    `
    const anchor = document.querySelector('.md-heading-anchor')!
    const para = document.querySelector('.plan-read-segment p')!
    const range = makeRange(anchor.firstChild!, 0, para.firstChild!, para.textContent!.length)
    const sel = resolvePlanSelectionLines(body, '#Title', range)
    expect(sel).toEqual({ text: 'Title', startLine: 3, endLine: 3 })
  })
})
