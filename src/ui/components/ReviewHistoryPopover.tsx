import { useQuery } from '@tanstack/react-query'
import { History, FileCode2 } from 'lucide-react'
import { Popover } from '../primitives/Popover'
import { timeAgo } from '../utils'

interface ReviewRoundSummary {
  round: number
  sentAt: number
  openCount: number
  decision?: 'approved' | 'changes-requested' | 'rejected' | 'comment-only'
  mode?: 'standard' | 'comment-only'
  filePaths: string[]
}

/**
 * Timeline of past "Send to agent" handoffs. Backed by GET /api/review/history
 * (in-process; resets when the server restarts).
 */
export function ReviewHistoryPopover({
  lastRound,
}: {
  lastRound: number | null
}) {
  const { data: rounds = [], isFetching, refetch } = useQuery<ReviewRoundSummary[]>({
    queryKey: ['review-history'],
    queryFn: async () => {
      const res = await fetch('/api/review/history')
      if (!res.ok) return []
      const json = (await res.json()) as { rounds?: ReviewRoundSummary[] }
      return json.rounds ?? []
    },
    enabled: false,
  })

  if (!lastRound || lastRound < 1) return null

  return (
    <Popover
      side="bottom"
      align="start"
      ariaLabel="Review history"
      className="review-history-popup"
      onOpenChange={(open) => {
        if (open) void refetch()
      }}
      trigger={
        <button
          type="button"
          className="toolbar-last-send toolbar-last-send-btn"
          title="Review history — past handoff rounds"
          aria-label="Open review history"
        >
          <History size={12} aria-hidden="true" />
          <span className="toolbar-last-send-dot" aria-hidden="true" />
          Round {lastRound}
        </button>
      }
    >
      <div className="review-history-header">
        <History size={14} />
        <strong>Review history</strong>
        {isFetching && <span className="review-history-loading">Loading…</span>}
      </div>
      {rounds.length === 0 ? (
        <p className="review-history-empty">No handoffs recorded yet (history is in-memory).</p>
      ) : (
        <ul className="review-history-list">
          {rounds.map((r) => (
            <li key={r.round} className="review-history-item">
              <div className="review-history-item-top">
                <span className="review-history-round">Round {r.round}</span>
                {r.decision && (
                  <span className="review-history-decision" data-decision={r.decision}>
                    {r.decision}
                  </span>
                )}
                {r.mode && r.mode !== 'standard' && (
                  <span className="review-history-mode">{r.mode}</span>
                )}
                <span className="review-history-time" title={new Date(r.sentAt).toLocaleString()}>
                  {timeAgo(r.sentAt)}
                </span>
              </div>
              <div className="review-history-item-meta">
                {r.openCount} open · {r.filePaths.length} file{r.filePaths.length === 1 ? '' : 's'}
              </div>
              {r.filePaths.length > 0 && (
                <div className="review-history-files">
                  {r.filePaths.slice(0, 6).map((p) => (
                    <span key={p} className="review-history-file" title={p}>
                      <FileCode2 size={10} />
                      {p.split('/').pop()}
                    </span>
                  ))}
                  {r.filePaths.length > 6 && (
                    <span className="review-history-file-more">+{r.filePaths.length - 6}</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Popover>
  )
}
