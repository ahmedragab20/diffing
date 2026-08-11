// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { DiffLineEntry } from '../../hooks/useDiffSearch'
import {
  clearFindHighlights,
  FIND_HIT_CLASS,
  FIND_HIT_CURRENT_CLASS,
  FIND_HIT_TEXT_CLASS,
  syncFindHighlights,
} from '../findInFileHighlights'

interface FakeRow {
  line: number
  type: string | null
  text: string
}

/** Build a card shaped like a pierre diff card (light DOM rows by default). */
function makeCard(rows: FakeRow[]) {
  const card = document.createElement('div')
  card.id = 'file-src/a.ts'
  document.body.appendChild(card)
  for (const r of rows) {
    const row = document.createElement('div')
    row.setAttribute('data-line', String(r.line))
    if (r.type) row.setAttribute('data-line-type', r.type)
    const span = document.createElement('span')
    span.textContent = r.text
    row.appendChild(span)
    card.appendChild(row)
  }
  return card
}

const hit = (lineNumber: number, side: 'additions' | 'deletions', content: string): DiffLineEntry => ({
  filePath: 'src/a.ts',
  lineNumber,
  side,
  content,
})

/** Every highlighted row (either the hit or the current match marker). */
const highlightedRows = (card: HTMLElement) =>
  Array.from(card.querySelectorAll(`[data-line].${FIND_HIT_CLASS}, [data-line].${FIND_HIT_CURRENT_CLASS}`))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('syncFindHighlights', () => {
  it('highlights exact addition rows, with the current match distinguished', () => {
    const card = makeCard([
      { line: 1, type: 'addition', text: 'const foo = 1' },
      { line: 2, type: 'addition', text: 'const bar = 2' },
    ])
    // index 1 → line 1 is a plain hit, line 2 is the current match.
    const hits = [hit(1, 'additions', 'const foo = 1'), hit(2, 'additions', 'const bar = 2')]

    syncFindHighlights(card, hits, 1, 'o')

    const rows = card.querySelectorAll('[data-line]')
    expect(rows[0].classList.contains(FIND_HIT_CLASS)).toBe(true)
    expect(rows[0].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(false)
    expect(rows[1].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(true)
    expect(highlightedRows(card)).toHaveLength(2)
    // Both rows got their containing token span highlighted.
    const span = rows[1].querySelector('span')
    expect(span!.classList.contains(FIND_HIT_TEXT_CLASS)).toBe(true)
  })

  it('marks the current match with the current class (and only it)', () => {
    const card = makeCard([
      { line: 1, type: 'deletion', text: 'let FOO = 3' },
      { line: 2, type: 'addition', text: 'const bar = 2' },
    ])
    const hits = [hit(1, 'deletions', 'let FOO = 3'), hit(2, 'additions', 'const bar = 2')]

    syncFindHighlights(card, hits, 1, 'o')

    const rows = card.querySelectorAll('[data-line]')
    expect(rows[0].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(false)
    expect(rows[1].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(true)
  })

  it('matches split-mode change-deletion / change-addition row types', () => {
    const card = makeCard([
      { line: 7, type: 'change-deletion', text: 'old line' },
      { line: 7, type: 'change-addition', text: 'new line' },
      { line: 8, type: 'change-addition', text: 'const added = 8' },
    ])
    // index 1 → the deletion row is a plain hit, the addition row is current.
    const hits = [hit(7, 'deletions', 'old line'), hit(8, 'additions', 'const added = 8')]

    syncFindHighlights(card, hits, 1, 'line')

    const rows = card.querySelectorAll('[data-line]')
    expect(rows[0].classList.contains(FIND_HIT_CLASS)).toBe(true)
    expect(rows[0].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(false)
    // The new-side row at the same number does not contain the deletion hit.
    expect(rows[1].classList.contains(FIND_HIT_CLASS)).toBe(false)
    expect(rows[2].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(true)
  })

  it('falls back to line-number + content for context rows', () => {
    const card = makeCard([
      { line: 5, type: 'context', text: 'unchanged description here' },
      { line: 6, type: 'context', text: 'also mentions description' },
    ])
    const hits = [hit(5, 'additions', 'unchanged description here')]

    syncFindHighlights(card, hits, 0, 'description')

    const rows = card.querySelectorAll('[data-line]')
    expect(rows[0].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(true)
    // Same query text but a different line number — not a hit, no highlight.
    expect(rows[1].classList.contains(FIND_HIT_CLASS)).toBe(false)
    expect(rows[1].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(false)
  })

  it('narrowing the query clears stale highlights in the same pass', () => {
    const card = makeCard([
      { line: 1, type: 'addition', text: 'const foo = 1' },
      { line: 2, type: 'addition', text: 'const foobar = 2' },
    ])
    const broad = [hit(1, 'additions', 'const foo = 1'), hit(2, 'additions', 'const foobar = 2')]
    syncFindHighlights(card, broad, 0, 'foo')
    expect(highlightedRows(card)).toHaveLength(2)

    const narrow = [hit(2, 'additions', 'const foobar = 2')]
    syncFindHighlights(card, narrow, 0, 'foobar')

    const rows = card.querySelectorAll('[data-line]')
    expect(rows[0].classList.contains(FIND_HIT_CLASS)).toBe(false)
    expect(rows[0].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(false)
    expect(rows[1].classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(true)
    expect(highlightedRows(card)).toHaveLength(1)
  })

  it('clears everything for an empty query or no hits', () => {
    const card = makeCard([{ line: 1, type: 'addition', text: 'const foo = 1' }])
    syncFindHighlights(card, [hit(1, 'additions', 'const foo = 1')], 0, 'foo')
    expect(highlightedRows(card)).toHaveLength(1)

    syncFindHighlights(card, [hit(1, 'additions', 'const foo = 1')], 0, '   ')
    expect(highlightedRows(card)).toHaveLength(0)

    syncFindHighlights(card, [hit(1, 'additions', 'const foo = 1')], 0, 'foo')
    expect(highlightedRows(card)).toHaveLength(1)

    syncFindHighlights(card, [], 0, 'foo')
    expect(highlightedRows(card)).toHaveLength(0)
  })

  it('reaches rows inside shadow roots (the pierre component)', () => {
    const card = makeCard([])
    const host = document.createElement('div')
    card.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const row = document.createElement('div')
    row.setAttribute('data-line', '10')
    row.setAttribute('data-line-type', 'addition')
    const span = document.createElement('span')
    span.textContent = 'const found = 10'
    row.appendChild(span)
    shadow.appendChild(row)

    syncFindHighlights(card, [hit(10, 'additions', 'const found = 10')], 0, 'found')

    expect(row.classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(true)
    expect(span.classList.contains(FIND_HIT_TEXT_CLASS)).toBe(true)

    clearFindHighlights(card)
    expect(row.classList.contains(FIND_HIT_CURRENT_CLASS)).toBe(false)
    expect(span.classList.contains(FIND_HIT_TEXT_CLASS)).toBe(false)
  })
})
