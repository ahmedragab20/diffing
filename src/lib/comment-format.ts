import type { ReviewComment } from './types.js'

/**
 * Render review comments as the `<code-review-comments>` XML envelope used to
 * hand a review to an AI agent. Shared by the UI clipboard button
 * (`useComments.formatAllComments`), the server's `/api/review/send` handoff,
 * and the `diffing` CLI/MCP so every channel emits byte-identical output.
 */
export function formatComments(comments: ReviewComment[], generalComment?: string): string {
  if (comments.length === 0) return ''

  const grouped = new Map<string, ReviewComment[]>()
  for (const comment of comments) {
    const list = grouped.get(comment.filePath) ?? []
    list.push(comment)
    grouped.set(comment.filePath, list)
  }

  const lines: string[] = []
  lines.push('<code-review-comments>')
  lines.push('  <instructions>')
  lines.push('    You are an AI coding assistant. You are receiving a structured list of code review comments to address in the repository.')
  lines.push('    For each file, review the inline comments and apply the changes requested.')
  lines.push('    - Target lines are specified by the "line" attribute (e.g. line="10" or line="10-15").')
  lines.push('    - "side" indicates whether the comment is on "additions" (added/modified lines) or "deletions" (deleted/old lines).')
  lines.push('    - "status" indicates whether the comment is "open" or "resolved". Only address comments with status="open".')
  lines.push('    - The <code> block contains the specific code context at the reviewed lines, prefixed with "+" or "-".')
  lines.push('    - The <body> tag contains the review feedback or request.')
  lines.push('    - If developers have replied to the comment, their discussion is captured under the <replies> element.')
  lines.push('    - The comment "id" attribute can be used to reference or update the comment via API if available.')
  lines.push('')
  lines.push('    HOW TO REPLY OR ASK FOR CLARIFICATION:')
  lines.push('    If you need to ask for clarification, explain what you did, or reply to any comment:')
  lines.push('')
  lines.push('    Option A: Via the diffing CLI or MCP (Preferred — port-agnostic, no copy-paste)')
  lines.push('      diffing reply <comment-id> --body "Your response" --model "<your-model-name>"')
  lines.push('      diffing resolve <comment-id>')
  lines.push('    (Or the equivalent MCP tools: reply_to_comment, resolve_comment.)')
  lines.push('')
  lines.push('    Option B: Via the local HTTP API (if you know the running port)')
  lines.push('      POST http://localhost:<port>/api/comments/<comment-id>/replies')
  lines.push('      Payload: { "body": "Your response or clarification request here", "model": "<your-model-name>" }')
  lines.push('      PUT  http://localhost:<port>/api/comments/<comment-id>  Payload: { "status": "resolved" }')
  lines.push('')
  lines.push('    Option C: Via Text Response (Offline / Chat Copy-Paste)')
  lines.push('    If you do not have local API access, output your comments/replies inside a structured XML block at the end of your response:')
  lines.push('      <comment-replies>')
  lines.push('        <reply to="<comment-id>" model="<your-model-name>"><![CDATA[Your reply or clarification request here]]></reply>')
  lines.push('      </comment-replies>')
  lines.push('  </instructions>')

  const trimmedGeneral = generalComment?.trim()
  if (trimmedGeneral) {
    lines.push('  <general-comment>')
    lines.push(`    <![CDATA[${trimmedGeneral}]]>`)
    lines.push('  </general-comment>')
  }

  for (const [filePath, fileComments] of grouped) {
    lines.push(`  <file path="${filePath}">`)
    for (const comment of fileComments) {
      const lineAttr = comment.lineNumber === 0
        ? 'file'
        : (comment.startLineNumber && comment.startLineNumber !== comment.lineNumber
          ? `${comment.startLineNumber}-${comment.lineNumber}`
          : `${comment.lineNumber}`)

      const isoDate = new Date(comment.createdAt).toISOString()
      lines.push(`    <comment id="${comment.id}" line="${lineAttr}" side="${comment.side}" status="${comment.status}" created-at="${isoDate}">`)

      if (comment.lineNumber !== 0) {
        const prefix = comment.side === 'additions' ? '+' : '-'
        const isMultiLine = comment.lineContent && comment.lineContent.includes('\n')
        let codeVal = ''
        if (isMultiLine) {
          const formattedCodeLines = comment.lineContent
            .split('\n')
            .map((l) => `${prefix} ${l}`)
            .join('\n')
          codeVal = `\n${formattedCodeLines}\n`
        } else {
          codeVal = `${prefix} ${comment.lineContent}`
        }

        lines.push(`      <code><![CDATA[${codeVal}]]></code>`)
      }
      lines.push(`      <body><![CDATA[${comment.body}]]></body>`)

      if (comment.replies && comment.replies.length > 0) {
        lines.push('      <replies>')
        for (const reply of comment.replies) {
          const replyIsoDate = new Date(reply.createdAt).toISOString()
          const roleAttr = reply.role ? ` role="${reply.role}"` : ' role="agent"'
          const modelAttr = reply.model ? ` model="${reply.model}"` : ''
          lines.push(`        <reply id="${reply.id}" created-at="${replyIsoDate}"${roleAttr}${modelAttr}>`)
          lines.push(`          <![CDATA[${reply.body}]]>`)
          lines.push('        </reply>')
        }
        lines.push('      </replies>')
      }

      lines.push('    </comment>')
    }
    lines.push('  </file>')
  }
  lines.push('</code-review-comments>')

  return lines.join('\n')
}
