import { useMemo } from 'react'
import type { PlanComment } from '../../lib/plan-types'
import type { PlanOutlineItem } from '../lib/planOutline'
import { buildPlanReadSegments } from '../lib/planReadSegments'
import { Markdown } from './Markdown'
import { PlanCommentBubble } from './PlanCommentBubble'

interface PlanReadInlineCommentsProps {
  body: string
  outline: PlanOutlineItem[]
  comments: PlanComment[]
  onResolve: (id: string) => void
  onUnresolve: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string, body: string) => void
  onReply: (id: string, body: string) => void
  onEditReply: (commentId: string, replyId: string, body: string) => void
  onDeleteReply: (commentId: string, replyId: string) => void
}

/**
 * Read/Split plan body with comments as **React children** interleaved after
 * each outline section. Avoids DOM injection into react-markdown (which was
 * wiped on every mode switch / re-render).
 */
export function PlanReadInlineComments({
  body,
  outline,
  comments,
  onResolve,
  onUnresolve,
  onDelete,
  onEdit,
  onReply,
  onEditReply,
  onDeleteReply,
}: PlanReadInlineCommentsProps) {
  const lineComments = useMemo(
    () => comments.filter((c) => c.lineNumber > 0),
    [comments],
  )

  const segments = useMemo(
    () => buildPlanReadSegments(body, outline, lineComments),
    [body, outline, lineComments],
  )

  // No headings / empty: single markdown block + trailing comments.
  if (segments.length === 0) {
    const totalLines = Math.max(1, body.replace(/\r\n/g, '\n').split('\n').length)
    return (
      <>
        <div
          className="plan-read-segment"
          data-plan-segment="body"
          data-plan-source-start={1}
          data-plan-source-end={totalLines}
        >
          <Markdown content={body} />
        </div>
        {lineComments.map((c) => (
          <div key={c.id} className="plan-read-comment-host" data-plan-read-comment-host={c.id}>
            <div className="plan-read-comment-slot">
              <PlanCommentBubble
                comment={c}
                onResolve={() => onResolve(c.id)}
                onUnresolve={() => onUnresolve(c.id)}
                onDelete={() => onDelete(c.id)}
                onEdit={(b) => onEdit(c.id, b)}
                onReply={(b) => onReply(c.id, b)}
                onEditReply={(replyId, b) => onEditReply(c.id, replyId, b)}
                onDeleteReply={(replyId) => onDeleteReply(c.id, replyId)}
              />
            </div>
          </div>
        ))}
      </>
    )
  }

  return (
    <>
      {segments.map((seg) => (
        <div
          key={seg.key}
          className="plan-read-segment"
          data-plan-segment={seg.key}
          data-plan-source-start={seg.startLine}
          data-plan-source-end={seg.endLine}
        >
          {seg.markdown.trim().length > 0 && <Markdown content={seg.markdown} />}
          {seg.comments.map((c) => (
            <div
              key={c.id}
              className="plan-read-comment-host"
              data-plan-read-comment-host={c.id}
            >
              <div
                className="plan-read-comment-slot"
                data-plan-line={c.lineNumber}
                data-plan-line-start={
                  c.startLineNumber != null && c.startLineNumber !== c.lineNumber
                    ? c.startLineNumber
                    : undefined
                }
              >
                <PlanCommentBubble
                  comment={c}
                  onResolve={() => onResolve(c.id)}
                  onUnresolve={() => onUnresolve(c.id)}
                  onDelete={() => onDelete(c.id)}
                  onEdit={(b) => onEdit(c.id, b)}
                  onReply={(b) => onReply(c.id, b)}
                  onEditReply={(replyId, b) => onEditReply(c.id, replyId, b)}
                  onDeleteReply={(replyId) => onDeleteReply(c.id, replyId)}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
