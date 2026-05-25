import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../../lib/types'

const COMMENTS_KEY = ['comments']

async function fetchComments(): Promise<ReviewComment[]> {
  const res = await fetch('/api/comments')
  return res.json()
}

export function useComments() {
  const queryClient = useQueryClient()
  const { data: comments = [] } = useQuery({ queryKey: COMMENTS_KEY, queryFn: fetchComments, refetchInterval: 3000 })

  const addMutation = useMutation({
    mutationFn: async (params: { filePath: string; side: 'deletions' | 'additions'; lineNumber: number; startLineNumber?: number; lineContent: string; body: string }) => {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (comment) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) => [...prev, comment])
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/comments/${id}`, { method: 'DELETE' })
      return id
    },
    onSuccess: (id) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) => prev.filter((c) => c.id !== id))
    },
  })

  const editMutation = useMutation({
    mutationFn: async ({ id, body, status }: { id: string; body?: string; status?: ReviewComment['status'] }) => {
      const res = await fetch(`/api/comments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, status }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const addReplyMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const res = await fetch(`/api/comments/${id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, role: 'user' }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const removeReplyMutation = useMutation({
    mutationFn: async ({ commentId, replyId }: { commentId: string; replyId: string }) => {
      const res = await fetch(`/api/comments/${commentId}/replies/${replyId}`, { method: 'DELETE' })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const editReplyMutation = useMutation({
    mutationFn: async ({ commentId, replyId, body }: { commentId: string; replyId: string; body: string }) => {
      const res = await fetch(`/api/comments/${commentId}/replies/${replyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      return res.json() as Promise<ReviewComment>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ReviewComment[]>(COMMENTS_KEY, (prev = []) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const applySuggestionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/comments/${id}/apply-suggestion`, {
        method: 'POST',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to apply suggestion')
      }
      return res.json() as Promise<{ ok: boolean }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMMENTS_KEY })
    },
  })

  const addComment = useCallback(
    (filePath: string, side: 'deletions' | 'additions', lineNumber: number, lineContent: string, body: string, startLineNumber?: number) => {
      addMutation.mutate({ filePath, side, lineNumber, startLineNumber, lineContent, body })
    },
    [addMutation.mutate],
  )

  const removeComment = useCallback(
    (id: string) => {
      removeMutation.mutate(id)
    },
    [removeMutation.mutate],
  )

  const editComment = useCallback(
    (id: string, body: string) => {
      editMutation.mutate({ id, body })
    },
    [editMutation.mutate],
  )

  const resolveComment = useCallback(
    (id: string) => {
      editMutation.mutate({ id, status: 'resolved' })
    },
    [editMutation.mutate],
  )

  const unresolveComment = useCallback(
    (id: string) => {
      editMutation.mutate({ id, status: 'open' })
    },
    [editMutation.mutate],
  )

  const addReply = useCallback(
    (id: string, body: string) => {
      addReplyMutation.mutate({ id, body })
    },
    [addReplyMutation.mutate],
  )

  const removeReply = useCallback(
    (commentId: string, replyId: string) => {
      removeReplyMutation.mutate({ commentId, replyId })
    },
    [removeReplyMutation.mutate],
  )

  const editReply = useCallback(
    (commentId: string, replyId: string, body: string) => {
      editReplyMutation.mutate({ commentId, replyId, body })
    },
    [editReplyMutation.mutate],
  )

  const applySuggestion = useCallback(
    async (id: string) => {
      await applySuggestionMutation.mutateAsync(id)
    },
    [applySuggestionMutation.mutateAsync],
  )

  const formatAllComments = useCallback((): string => {
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
    lines.push('    Option A: Via API (Preferred if the diffit server is running locally)')
    lines.push('    Send a POST request to add a reply:')
    lines.push('      POST http://localhost:<port>/api/comments/<comment-id>/replies')
    lines.push('      Payload: { "body": "Your response or clarification request here", "model": "<your-model-name>" }')
    lines.push('    To mark a comment as resolved:')
    lines.push('      PUT http://localhost:<port>/api/comments/<comment-id>')
    lines.push('      Payload: { "status": "resolved" }')
    lines.push('')
    lines.push('    Option B: Via Text Response (Offline / Chat Copy-Paste)')
    lines.push('    If you do not have local API access, output your comments/replies inside a structured XML block at the end of your response:')
    lines.push('      <comment-replies>')
    lines.push('        <reply to="<comment-id>" model="<your-model-name>"><![CDATA[Your reply or clarification request here]]></reply>')
    lines.push('      </comment-replies>')
    lines.push('  </instructions>')

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
  }, [comments])

  const getAnnotationsForFile = useCallback(
    (filePath: string): DiffLineAnnotation<ReviewComment>[] => {
      return comments
        .filter((c) => c.filePath === filePath)
        .map((c) => ({
          side: c.side,
          lineNumber: c.lineNumber,
          metadata: c,
        }))
    },
    [comments],
  )

  const copyAllComments = useCallback(async () => {
    const text = formatAllComments()
    await navigator.clipboard.writeText(text)
  }, [formatAllComments])

  return {
    comments,
    addComment,
    removeComment,
    editComment,
    resolveComment,
    unresolveComment,
    addReply,
    removeReply,
    editReply,
    applySuggestion,
    getAnnotationsForFile,
    formatAllComments,
    copyAllComments,
  }
}
