/**
 * Map a free-text selection from the rendered plan view back onto source
 * line numbers so we can open a line-anchored comment form.
 */

import { extractPlanLines } from '../../lib/plan-format'

export interface PlanTextSelection {
  text: string
  startLine: number
  endLine: number
}

/** Document-absolute rect for float-composer highlight overlays. */
export interface PlanPageRect {
  top: number
  left: number
  width: number
  height: number
}

/** Normalize selection / body text for resilient matching. */
export function normalizePlanText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ') // nbsp from rendered HTML
    .replace(/\u200b/g, '') // zero-width space
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/**
 * True when the current selection intersects the plan rendered root,
 * regardless of drag direction (LTR / RTL / outside→inside).
 */
export function selectionIntersectsRoot(sel: Selection, root: HTMLElement): boolean {
  if (!sel.rangeCount) return false
  try {
    const range = sel.getRangeAt(0)
    if (root.contains(range.commonAncestorContainer)) return true
    if (sel.anchorNode && root.contains(sel.anchorNode)) return true
    if (sel.focusNode && root.contains(sel.focusNode)) return true

    // Partial overlap: selection started outside and ended inside (or reverse).
    const rootRange = document.createRange()
    rootRange.selectNodeContents(root)
    // Ranges intersect if startA < endB && startB < endA
    return (
      range.compareBoundaryPoints(Range.START_TO_END, rootRange) < 0 &&
      range.compareBoundaryPoints(Range.END_TO_START, rootRange) > 0
    )
  } catch {
    return false
  }
}

/**
 * Prefer the selection range clipped to the rendered root so rects/text stay
 * inside the plan pane even when the user dragged past its edges.
 */
export function selectionRangeInRoot(sel: Selection, root: HTMLElement): Range | null {
  if (!sel.rangeCount) return null
  try {
    const range = sel.getRangeAt(0).cloneRange()
    if (root.contains(range.commonAncestorContainer)) return range

    const rootRange = document.createRange()
    rootRange.selectNodeContents(root)

    // Clip start to root if it began outside.
    if (!root.contains(range.startContainer)) {
      range.setStart(rootRange.startContainer, rootRange.startOffset)
    }
    // Clip end to root if it ended outside.
    if (!root.contains(range.endContainer)) {
      range.setEnd(rootRange.endContainer, rootRange.endOffset)
    }
    if (range.collapsed) return null
    if (!root.contains(range.commonAncestorContainer) && !selectionIntersectsRoot(sel, root)) {
      return null
    }
    return range
  } catch {
    return null
  }
}

function lineNumberAtIndex(body: string, index: number): number {
  if (index <= 0) return 1
  return body.slice(0, index).split('\n').length
}

/**
 * Find the selected snippet in `body` and return 1-based line range.
 * Tries exact match, whitespace-normalized match, and prefix/suffix soft finds
 * so rendered markdown (collapsed spaces, list bullets) still maps.
 */
export function mapSelectionToLines(body: string, selectedText: string): PlanTextSelection | null {
  const text = normalizePlanText(selectedText)
  // Allow single-character selections (e.g. a code token).
  if (!text) return null

  const normalizedBody = body.replace(/\r\n/g, '\n')

  // 1) Exact match
  let idx = normalizedBody.indexOf(text)
  if (idx !== -1) {
    const startLine = lineNumberAtIndex(normalizedBody, idx)
    const endLine = startLine + text.split('\n').length - 1
    return { text, startLine, endLine }
  }

  // 2) Whitespace-collapsed match (rendered MD collapses runs / newlines)
  const softNeedle = text.replace(/\s+/g, ' ').trim()
  if (softNeedle) {
    const softBody = normalizedBody.replace(/\s+/g, ' ')
    const softIdx = softBody.indexOf(softNeedle)
    if (softIdx !== -1) {
      // Map soft index → original by walking both streams.
      const origIdx = mapSoftIndexToOriginal(normalizedBody, softIdx)
      if (origIdx !== -1) {
        const startLine = lineNumberAtIndex(normalizedBody, origIdx)
        // Approximate end by soft length → line span from exact text line count.
        const endLine = startLine + Math.max(0, text.split('\n').length - 1)
        return { text, startLine, endLine: Math.min(endLine, normalizedBody.split('\n').length) }
      }
    }
  }

  // 3) Match first significant line of the selection against body lines
  //    (handles list items where the user selected "item b" but source is "- item b").
  const firstLine = text.split('\n').find((l) => l.trim())?.trim() ?? ''
  if (firstLine.length >= 1) {
    const bodyLines = normalizedBody.split('\n')
    for (let i = 0; i < bodyLines.length; i++) {
      const bl = bodyLines[i]
      const stripped = bl.replace(/^\s*([-*+]|\d+\.)\s+/, '').trim()
      if (
        bl.includes(firstLine) ||
        stripped.includes(firstLine) ||
        firstLine.includes(stripped) && stripped.length >= 2
      ) {
        const lineCount = text.split('\n').filter((l) => l.trim()).length || 1
        const startLine = i + 1
        const endLine = Math.min(bodyLines.length, startLine + lineCount - 1)
        return { text, startLine, endLine }
      }
    }
  }

  // 4) Last resort: unique substring of first 24 non-space chars
  const compact = softNeedle.replace(/\s+/g, '')
  if (compact.length >= 3) {
    const needle = softNeedle.slice(0, Math.min(32, softNeedle.length))
    const re = new RegExp(
      needle
        .split('')
        .map((ch) => (/[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch))
        .join('\\s*'),
      'i',
    )
    const m = re.exec(normalizedBody)
    if (m && m.index != null) {
      const startLine = lineNumberAtIndex(normalizedBody, m.index)
      return { text, startLine, endLine: startLine }
    }
  }

  return null
}

/**
 * The rendered plan wraps each outline section in a `.plan-read-segment` carrying
 * `data-plan-source-start` / `data-plan-source-end` (1-based inclusive source
 * line range of that section's markdown). Find the segment owning a selection
 * node so we can scope line resolution instead of searching the whole body.
 */
function planSegmentForNode(node: Node | null): HTMLElement | null {
  if (!node) return null
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as HTMLElement).closest('.plan-read-segment') as HTMLElement | null
  }
  const parent = node.parentElement
  return parent ? (parent.closest('.plan-read-segment') as HTMLElement | null) : null
}

function lineAttr(el: HTMLElement | null, attr: 'planSourceStart' | 'planSourceEnd'): number | null {
  if (!el) return null
  const raw = (el.dataset as DOMStringMap)[attr]
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 1 ? n : null
}

/**
 * Resolve a rendered-DOM selection onto plan source line numbers robustly.
 *
 * Pure whole-body text matching (the old approach) silently collapsed to
 * `startLine:1` whenever the selected text didn't substring-match the source.
 * The two main failure modes were:
 *  1. The rendered heading injects a `#` anchor glyph (`.md-heading-anchor`) as
 *     a real text node before the heading content; selections that brush a
 *     heading end up prefixed with `#`, which never matches body text.
 *  2. Rendered-vs-source whitespace/structure differences fall through every
 *     fuzzy stage of {@link mapSelectionToLines} and return null.
 *
 * This resolver (a) strips the stray anchor `#`, (b) scopes matching to the
 * containing `.plan-read-segment`'s source slice (far fewer collisions, and
 * offsets map cleanly back to body line numbers), and (c) falls back to the
 * section's own source range — the section heading at worst — instead of the
 * document's top-level `# Title`. Whole-body matching is only the last resort
 * for selections outside any segment (e.g. select-all on the root).
 */
export function resolvePlanSelectionLines(
  body: string,
  selectedText: string,
  range: Range,
): PlanTextSelection | null {
  const raw = normalizePlanText(selectedText)
  if (!raw) return null

  // The "#" heading-anchor glyph is UI chrome, not plan source. A selection that
  // touches a heading picks it up as a leading "#"; strip it for matching and
  // for the saved quote so the user never sees the anchor as their highlight.
  const stripped = raw.replace(/^#\s*/, '')
  const candidates: string[] = []
  if (stripped && stripped !== raw) candidates.push(stripped)
  candidates.push(raw)

  const startSeg = planSegmentForNode(range.startContainer)
  const endSeg = range.collapsed ? startSeg : planSegmentForNode(range.endContainer)
  const segStart = lineAttr(startSeg, 'planSourceStart')
  const segEnd = lineAttr(endSeg, 'planSourceEnd')

  if (segStart != null && segEnd != null) {
    const slice = extractPlanLines(body, segStart, segEnd)
    for (const needle of candidates) {
      const local = mapSelectionToLines(slice, needle)
      if (local) {
        return {
          text: needle,
          startLine: segStart + local.startLine - 1,
          endLine: segStart + local.endLine - 1,
        }
      }
    }
    // Could not pinpoint within the section — anchor to the section's own range
    // (its heading line), never the document's `# Title`.
    return { text: candidates[0] ?? raw, startLine: segStart, endLine: Math.max(segStart, segEnd) }
  }

  // No segment metadata available (legacy render path / selection spans root).
  for (const needle of candidates) {
    const m = mapSelectionToLines(body, needle)
    if (m) return m
  }
  return null
}

/** Map an index in whitespace-collapsed text back into the original body. */
function mapSoftIndexToOriginal(original: string, softIndex: number): number {
  let soft = 0
  let i = 0
  let inSpace = false
  // Mirror softBody construction: replace(/\s+/g, ' ')
  // leading/trailing of full soft body aren't trimmed here — softBody was from
  // full normalizedBody without trim, only runs collapsed.
  while (i < original.length && soft < softIndex) {
    const ch = original[i]
    if (/\s/.test(ch)) {
      if (!inSpace) {
        soft += 1 // one space in soft body
        inSpace = true
      }
      i += 1
    } else {
      inSpace = false
      soft += 1
      i += 1
    }
  }
  // Skip remaining spaces so we land on content.
  while (i < original.length && /\s/.test(original[i])) i += 1
  return i < original.length ? i : -1
}

/**
 * Elements that must not contribute text when rematching float-composer
 * highlights (comment cards, chrome, etc.).
 */
function isHighlightExcluded(el: Element | null): boolean {
  if (!el) return true
  return !!el.closest(
    [
      '.plan-read-comment-host',
      '.plan-float-highlights',
      '.plan-float-highlight',
      '.plan-selection-comment',
      '.plan-selection-popup',
      '.comment-bubble-canvas',
      '.comment-collapsed-bar',
      '.plan-toc',
      'button',
      'textarea',
      'input',
    ].join(','),
  )
}

function clientRectsToPageRects(range: Range): PlanPageRect[] {
  const sx = window.scrollX
  const sy = window.scrollY
  return Array.from(range.getClientRects())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      top: r.top + sy,
      left: r.left + sx,
      width: r.width,
      height: r.height,
    }))
}

/**
 * Re-find `quote` inside the rendered plan root and return document-space
 * highlight rects. Used after layout shifts (e.g. deleting an inline comment)
 * so float-composer overlays stay glued to the text.
 */
export function measureQuoteInRoot(root: HTMLElement, quote: string): PlanPageRect[] {
  const needle = quote.trim()
  if (!needle || needle.length < 2) return []

  const textNodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (isHighlightExcluded(parent)) return NodeFilter.FILTER_REJECT
      return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  let n: Node | null
  while ((n = walker.nextNode())) textNodes.push(n as Text)
  if (textNodes.length === 0) return []

  // Concatenate with absolute offsets for multi-node ranges.
  let haystack = ''
  const spans: { node: Text; start: number; end: number }[] = []
  for (const node of textNodes) {
    const t = node.textContent || ''
    spans.push({ node, start: haystack.length, end: haystack.length + t.length })
    haystack += t
  }

  const candidates = [
    needle,
    ...needle
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 3),
  ]

  let matchStart = -1
  let matchEnd = -1
  for (const c of candidates) {
    const idx = haystack.indexOf(c)
    if (idx >= 0) {
      matchStart = idx
      matchEnd = idx + c.length
      break
    }
  }

  if (matchStart < 0) {
    // Whitespace-collapsed fallback for soft HTML wrapping differences.
    const softHay = haystack.replace(/\s+/g, ' ')
    const softNeedle = needle.replace(/\s+/g, ' ')
    const si = softHay.indexOf(softNeedle)
    if (si < 0) return []
    // Approximate: expand first matching raw line of the needle.
    const first = needle.split('\n').map((l) => l.trim()).find((l) => l.length >= 3)
    if (!first) return []
    const fi = haystack.indexOf(first)
    if (fi < 0) return []
    matchStart = fi
    matchEnd = fi + first.length
  }

  const startSpan = spans.find((s) => matchStart >= s.start && matchStart < s.end)
  const endSpan = spans.find((s) => matchEnd > s.start && matchEnd <= s.end) ??
    spans.find((s) => matchEnd > s.start && matchEnd - 1 < s.end)
  if (!startSpan || !endSpan) return []

  try {
    const range = document.createRange()
    range.setStart(startSpan.node, matchStart - startSpan.start)
    range.setEnd(endSpan.node, Math.min(endSpan.node.textContent!.length, matchEnd - endSpan.start))
    return clientRectsToPageRects(range)
  } catch {
    return []
  }
}
