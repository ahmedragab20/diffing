import type { ReviewComment, ReviewDecision, ReviewMode } from './types.js'
import { reviewDecisionSummary } from './comment-format.js'

/**
 * Export a review as human-readable Markdown (clipboard / download / CLI).
 * Mirrors the structure of {@link formatComments} (grouped by file) but as MD.
 */
export function formatCommentsMarkdown(
  comments: ReviewComment[],
  generalComment?: string,
  decision?: ReviewDecision,
  mode?: ReviewMode,
): string {
  const trimmedGeneral = generalComment?.trim()
  if (comments.length === 0 && !decision && !trimmedGeneral) return ''

  const grouped = new Map<string, ReviewComment[]>()
  for (const comment of comments) {
    const list = grouped.get(comment.filePath) ?? []
    list.push(comment)
    grouped.set(comment.filePath, list)
  }
  // Stable alphabetical file order for readable exports
  const files = [...grouped.keys()].sort((a, b) => a.localeCompare(b))

  const lines: string[] = []
  lines.push('# Code review')
  lines.push('')

  if (decision) {
    lines.push(`**Verdict:** \`${decision}\`${mode && mode !== 'standard' ? ` · mode \`${mode}\`` : ''}`)
    lines.push('')
    lines.push(reviewDecisionSummary(decision))
    lines.push('')
  }

  if (trimmedGeneral) {
    lines.push('## Overall note')
    lines.push('')
    lines.push(trimmedGeneral)
    lines.push('')
  }

  if (files.length === 0) {
    lines.push('_No inline comments._')
    lines.push('')
    return lines.join('\n')
  }

  for (const filePath of files) {
    const fileComments = grouped.get(filePath)!
    lines.push(`## \`${filePath}\``)
    lines.push('')
    for (const c of fileComments) {
      const line =
        c.lineNumber === 0
          ? 'file'
          : c.startLineNumber && c.startLineNumber !== c.lineNumber
            ? `L${c.startLineNumber}–${c.lineNumber}`
            : `L${c.lineNumber}`
      const status = c.status === 'resolved' ? 'resolved' : 'open'
      lines.push(`### ${line} · ${c.side} · ${status}`)
      lines.push('')
      if (c.lineNumber !== 0 && c.lineContent) {
        const prefix = c.side === 'additions' ? '+' : '-'
        const code = c.lineContent
          .split('\n')
          .map((l) => `${prefix} ${l}`)
          .join('\n')
        lines.push('```diff')
        lines.push(code)
        lines.push('```')
        lines.push('')
      }
      lines.push(c.body)
      lines.push('')
      if (c.replies?.length) {
        for (const r of c.replies) {
          const who = r.role === 'agent' ? `agent${r.model ? ` (${r.model})` : ''}` : 'reviewer'
          lines.push(`> **${who}:** ${r.body.replace(/\n/g, '\n> ')}`)
          lines.push('')
        }
      }
    }
  }

  return lines.join('\n').trimEnd() + '\n'
}
