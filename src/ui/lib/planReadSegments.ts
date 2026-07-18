import type { PlanComment } from '../../lib/plan-types'
import type { PlanOutlineItem } from './planOutline'
import { findOutlineSectionForLine } from './planCommentAnchors'

export interface PlanReadSegment {
  /** Outline heading id, or `preamble` for content before the first heading. */
  key: string
  /** Inclusive 1-based source lines covered by this segment. */
  startLine: number
  endLine: number
  /** Markdown slice for this segment (joined with trailing newline handling). */
  markdown: string
  /** Line-anchored comments whose end line falls in this segment. */
  comments: PlanComment[]
}

/**
 * Split plan source into React-renderable segments (heading → next heading)
 * and attach comments by end-line. Read mode renders each segment as real
 * React children (`Markdown` + bubbles) so mode switches never wipe hosts.
 */
export function buildPlanReadSegments(
  body: string,
  outline: PlanOutlineItem[],
  comments: PlanComment[],
): PlanReadSegment[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const total = Math.max(1, lines.length)
  const lineComments = comments.filter((c) => c.lineNumber > 0)

  // Build [start, end] ranges for preamble + each outline heading.
  type Range = { key: string; startLine: number; endLine: number }
  const ranges: Range[] = []

  if (outline.length === 0) {
    ranges.push({ key: 'preamble', startLine: 1, endLine: total })
  } else {
    if (outline[0]!.line > 1) {
      ranges.push({ key: 'preamble', startLine: 1, endLine: outline[0]!.line - 1 })
    }
    for (let i = 0; i < outline.length; i++) {
      const item = outline[i]!
      const next = outline[i + 1]
      ranges.push({
        key: item.id,
        startLine: item.line,
        endLine: next ? next.line - 1 : total,
      })
    }
  }

  const byKey = new Map<string, PlanComment[]>()
  for (const r of ranges) byKey.set(r.key, [])

  for (const c of lineComments) {
    const end = c.lineNumber
    // Prefer the section that owns the end line (Source slots under the bottom).
    const section = findOutlineSectionForLine(outline, end)
    let key = section?.id ?? 'preamble'
    if (!byKey.has(key)) {
      // Fallback: first range that contains the end line.
      const hit = ranges.find((r) => end >= r.startLine && end <= r.endLine)
      key = hit?.key ?? ranges[ranges.length - 1]!.key
    }
    byKey.get(key)!.push(c)
  }

  for (const list of byKey.values()) {
    list.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1
      const aStart = a.startLineNumber ?? a.lineNumber
      const bStart = b.startLineNumber ?? b.lineNumber
      if (aStart !== bStart) return aStart - bStart
      return a.lineNumber - b.lineNumber
    })
  }

  return ranges.map((r) => {
    const slice = lines.slice(r.startLine - 1, r.endLine).join('\n')
    return {
      key: r.key,
      startLine: r.startLine,
      endLine: r.endLine,
      markdown: slice,
      comments: byKey.get(r.key) ?? [],
    }
  })
}
