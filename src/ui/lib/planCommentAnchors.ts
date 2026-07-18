import type { PlanComment } from '../../lib/plan-types'
import type { PlanOutlineItem } from './planOutline'

/**
 * Find the outline section that owns a 1-based source line: the last heading
 * at or before that line. Returns null when the line is above every heading
 * (preamble) or the outline is empty.
 */
export function findOutlineSectionForLine(
  outline: PlanOutlineItem[],
  lineNumber: number,
): PlanOutlineItem | null {
  if (!outline.length || lineNumber < 1) return null
  let match: PlanOutlineItem | null = null
  for (const item of outline) {
    if (item.line <= lineNumber) match = item
    else break
  }
  return match
}

/** Anchor key for grouping read-mode inline comments. */
export type PlanReadAnchorKey = string | 'preamble'

/**
 * Group line-anchored plan comments by the rendered heading they should appear
 * under. Comments with `lineNumber === 0` (general) are excluded.
 */
export function bucketCommentsByOutline(
  outline: PlanOutlineItem[],
  comments: PlanComment[],
): Map<PlanReadAnchorKey, PlanComment[]> {
  const buckets = new Map<PlanReadAnchorKey, PlanComment[]>()
  for (const c of comments) {
    if (c.lineNumber <= 0) continue
    const section = findOutlineSectionForLine(outline, c.lineNumber)
    const key: PlanReadAnchorKey = section?.id ?? 'preamble'
    const list = buckets.get(key) ?? []
    list.push(c)
    buckets.set(key, list)
  }
  // Stable order within a section: open first, then by line.
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1
      const aStart = a.startLineNumber ?? a.lineNumber
      const bStart = b.startLineNumber ?? b.lineNumber
      if (aStart !== bStart) return aStart - bStart
      return a.lineNumber - b.lineNumber
    })
  }
  return buckets
}

/** Rail / chip label for a plan comment line range. */
export function planCommentLineLabel(c: Pick<PlanComment, 'lineNumber' | 'startLineNumber'>): string {
  if (c.lineNumber <= 0) return 'General'
  if (c.startLineNumber != null && c.startLineNumber !== c.lineNumber) {
    const lo = Math.min(c.startLineNumber, c.lineNumber)
    const hi = Math.max(c.startLineNumber, c.lineNumber)
    return `L${lo}–L${hi}`
  }
  return `L${c.lineNumber}`
}

function normalizeSearchText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_~#>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Strip markdown ATX heading markers and list prefixes for matching rendered text. */
function stripMdLineChrome(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^[|\s]+/, '')
    .trim()
}

/**
 * Last element in the rendered root that is part of the section that starts at
 * `heading` (everything until the next h1–h6). Returns `heading` when the
 * section has no body blocks yet.
 */
export function lastElementOfSection(heading: Element): Element {
  let last: Element = heading
  let el = heading.nextElementSibling
  while (
    el &&
    !/^H[1-6]$/i.test(el.tagName) &&
    !el.hasAttribute('data-plan-read-comment-host')
  ) {
    last = el
    el = el.nextElementSibling
  }
  return last
}

/**
 * Find the best DOM block in the rendered plan to place a comment *after*,
 * matching Source mode (annotation under the bottom line of the range).
 *
 * Strategy:
 * 1. Match source `lineContent` / extracted lines against block text (prefer
 *    the last non-empty line of the range so multi-line L1–3 lands after the
 *    paragraph, not under the title alone).
 * 2. Fall back to the section heading's last body block when only the heading
 *    matches (or content is empty).
 * 3. `null` → caller inserts at top (preamble).
 */
export function findReadModeAnchorElement(
  root: HTMLElement,
  outline: PlanOutlineItem[],
  comment: Pick<PlanComment, 'lineNumber' | 'startLineNumber' | 'lineContent'>,
  /** Exact source lines for the range (preferred over lineContent snapshot). */
  rangeSourceText?: string,
): Element | null {
  const endLine = comment.lineNumber
  const startLine = comment.startLineNumber ?? endLine
  const raw = (rangeSourceText ?? comment.lineContent ?? '').replace(/\r\n/g, '\n')
  const sourceLines = raw
    .split('\n')
    .map(stripMdLineChrome)
    .filter((l) => l.length > 0)

  const blocks = Array.from(
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,tr'),
  ).filter((el) => !el.closest('[data-plan-read-comment-host]')) as Element[]

  // Prefer matching the bottom of the range first (Source slots under end line).
  const needles = [...sourceLines].reverse()
  for (const line of needles) {
    const n = normalizeSearchText(line)
    if (n.length < 2) continue
    let lastMatch: Element | null = null
    for (const el of blocks) {
      const t = normalizeSearchText(el.textContent ?? '')
      if (!t) continue
      if (t.includes(n) || (n.length >= 8 && n.includes(t) && t.length >= 4)) {
        lastMatch = el
      }
    }
    if (lastMatch) return lastMatch
  }

  // Full-range blob match (handles short lines / soft wrapping).
  const blob = normalizeSearchText(sourceLines.join(' '))
  if (blob.length >= 8) {
    let lastMatch: Element | null = null
    for (const el of blocks) {
      const t = normalizeSearchText(el.textContent ?? '')
      if (t && (t.includes(blob.slice(0, Math.min(40, blob.length))) || blob.includes(t))) {
        lastMatch = el
      }
    }
    if (lastMatch) return lastMatch
  }

  // Section fallback: place after the last content of the section that owns
  // the end line — not immediately after the heading (that put L1–3 above the
  // intro paragraph).
  const section = findOutlineSectionForLine(outline, endLine)
  if (section) {
    let heading: Element | null = null
    try {
      heading = root.querySelector(`#${CSS.escape(section.id)}`)
    } catch {
      heading = root.querySelector(`[id="${section.id}"]`)
    }
    if (heading) {
      // If the range is only the heading line itself, sit under the heading.
      if (startLine === endLine && endLine === section.line) {
        return heading
      }
      // Otherwise sit after the section's current body content so multi-line
      // comments that start at the heading still land below the body they cover.
      return lastElementOfSection(heading)
    }
  }

  // Preamble (above first heading): last top-level block before first heading.
  const firstHeading = root.querySelector('h1,h2,h3,h4,h5,h6')
  if (firstHeading) {
    let last: Element | null = null
    let el = root.firstElementChild
    while (el && el !== firstHeading) {
      if (!el.hasAttribute('data-plan-read-comment-host')) last = el
      el = el.nextElementSibling
    }
    return last
  }

  return root.lastElementChild
}
