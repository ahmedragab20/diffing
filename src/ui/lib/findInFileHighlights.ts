import { findElementInElOrShadow } from '../utils'
import type { DiffLineEntry } from '../hooks/useDiffSearch'

/**
 * Persistent "find in file" match highlighting.
 *
 * Diff rows live inside the @pierre/diffs shadow DOM, so the app's global
 * stylesheet cannot reach them. Instead of inline styles we toggle semantic
 * classes on the row elements (`.find-hit` / `.find-hit-current` /
 * `.find-hit-text`) that are styled by the CSS injected into the shadow root
 * via the component's `unsafeCSS` (see `buildUnsafeCSS` in FileDiffCard).
 *
 * Matching mirrors the navigation model in `scrollToLine`:
 *   1. Prefer an exact `data-line` + `data-line-type` match (additions →
 *      `addition`/`change-addition`, deletions → `deletion`/`change-deletion`).
 *   2. Fall back to a `data-line`-only match for rows that actually contain
 *      the query text (unchanged context rows carry `data-line-type="context"`
 *      and are emitted once with new-file numbering).
 *
 * `syncFindHighlights` is idempotent and cheap enough to run on an interval:
 * diff rows lazy-mount as the card scrolls into view, so the caller re-syncs
 * until the search session closes. Rows that stop matching (query narrowed,
 * index moved) are un-highlighted in the same pass.
 */

export const FIND_HIT_CLASS = 'find-hit'
export const FIND_HIT_CURRENT_CLASS = 'find-hit-current'
export const FIND_HIT_TEXT_CLASS = 'find-hit-text'

/** `data-line-type` values that represent the additions / deletions side. */
const SIDE_TYPES: Record<'additions' | 'deletions', readonly string[]> = {
  additions: ['addition', 'change-addition'],
  deletions: ['deletion', 'change-deletion'],
}

export function getFileCardElement(filePath: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.getElementById(`file-${filePath}`)
}

function clearRow(row: HTMLElement) {
  const hadHit =
    row.classList.contains(FIND_HIT_CLASS) || row.classList.contains(FIND_HIT_CURRENT_CLASS)
  if (!hadHit) return
  row.classList.remove(FIND_HIT_CURRENT_CLASS, FIND_HIT_CLASS)
  row.querySelectorAll(`.${FIND_HIT_TEXT_CLASS}`).forEach((span) => {
    span.classList.remove(FIND_HIT_TEXT_CLASS)
  })
}

/** Remove every find-in-file highlight currently applied inside a card. */
export function clearFindHighlights(cardEl: HTMLElement): void {
  const rows = findElementInElOrShadow(
    cardEl,
    `[data-line].${FIND_HIT_CLASS}, [data-line].${FIND_HIT_CURRENT_CLASS}`,
  )
  for (const row of rows) clearRow(row)
}

/** Apply gold background to the token spans inside a row that contain the query. */
function highlightTextInRow(row: HTMLElement, query: string) {
  for (const el of row.querySelectorAll('span, code')) {
    if (el.textContent?.toLowerCase().includes(query)) {
      el.classList.add(FIND_HIT_TEXT_CLASS)
    }
  }
}

/**
 * Reconcile the highlights of one card against the current search state.
 * Idempotent: rows already in the right state are untouched, so calling this
 * on an interval only costs a classList no-op for unchanged rows.
 */
export function syncFindHighlights(
  cardEl: HTMLElement,
  hits: DiffLineEntry[],
  currentIndex: number,
  query: string,
): void {
  const q = query.trim().toLowerCase()
  if (!q || hits.length === 0) {
    clearFindHighlights(cardEl)
    return
  }

  // line number → indices into `hits` (a hit is per line, never repeated).
  const hitsByLine = new Map<number, number[]>()
  for (let i = 0; i < hits.length; i++) {
    const list = hitsByLine.get(hits[i].lineNumber)
    if (list) list.push(i)
    else hitsByLine.set(hits[i].lineNumber, [i])
  }

  const rows = findElementInElOrShadow(cardEl, '[data-line]')
  for (const row of rows) {
    const line = parseInt(row.getAttribute('data-line') ?? '', 10)
    const candidates = Number.isFinite(line) ? hitsByLine.get(line) : undefined
    if (!candidates) {
      clearRow(row)
      continue
    }

    const rowType = row.getAttribute('data-line-type') ?? ''
    const sideMatched = candidates.some((i) => SIDE_TYPES[hits[i].side].includes(rowType))
    const textMatched =
      !sideMatched &&
      candidates.some((i) => row.textContent?.toLowerCase().includes(hits[i].content.toLowerCase()))
    if (!sideMatched && !textMatched) {
      clearRow(row)
      continue
    }

    const isCurrent = candidates.includes(currentIndex)
    const wasHighlighted =
      row.classList.contains(FIND_HIT_CLASS) || row.classList.contains(FIND_HIT_CURRENT_CLASS)
    if (isCurrent) {
      row.classList.add(FIND_HIT_CURRENT_CLASS)
      row.classList.remove(FIND_HIT_CLASS)
    } else {
      row.classList.add(FIND_HIT_CLASS)
      row.classList.remove(FIND_HIT_CURRENT_CLASS)
    }
    // Only scan token spans for rows that were not highlighted before, so the
    // recurring interval tick does not re-walk every row's children.
    if (!wasHighlighted) highlightTextInRow(row, q)
  }
}
