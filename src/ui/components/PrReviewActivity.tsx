import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, MessageCircle, XCircle } from 'lucide-react'
import type { PrExistingReview } from '../../lib/pr-session'
import { timeAgo } from '../utils'
import { Markdown } from './Markdown'

const REVIEW_STATE = {
  APPROVED: { label: 'approved these changes', short: 'Approved', icon: CheckCircle2 },
  CHANGES_REQUESTED: { label: 'requested changes', short: 'Changes requested', icon: XCircle },
  COMMENTED: { label: 'left a review comment', short: 'Commented', icon: MessageCircle },
  PENDING: { label: 'started a pending review', short: 'Pending', icon: Clock3 },
  DISMISSED: { label: 'had a review dismissed', short: 'Dismissed', icon: XCircle },
} as const

/** Walk submitted GitHub reviews without mixing review-level notes into line threads or PR alerts. */
export function PrReviewActivity({ reviews }: { reviews: PrExistingReview[] }) {
  const [activeId, setActiveId] = useState<number | null>(reviews[0]?.id ?? null)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    setActiveId(reviews[0]?.id ?? null)
  }, [reviews[0]?.id])

  useEffect(() => {
    setFailedAvatarUrl(null)
  }, [activeId])

  if (reviews.length === 0) return null
  const activeIndex = Math.max(0, reviews.findIndex((review) => review.id === activeId))
  const review = reviews[activeIndex] ?? reviews[0]
  const state = REVIEW_STATE[review.state]
  const StateIcon = state.icon
  const submittedAt = review.submittedAt ? new Date(review.submittedAt).getTime() : null

  return (
    <section className="pr-review-activity" aria-label="GitHub review activity">
      <header className="pr-review-activity-head">
        <div className="pr-review-activity-identity">
          {review.author?.avatarUrl && failedAvatarUrl !== review.author.avatarUrl ? (
            <img
              src={`/api/gh/avatar?url=${encodeURIComponent(review.author.avatarUrl)}`}
              alt=""
              className="pr-review-activity-avatar"
              referrerPolicy="no-referrer"
              onError={() => setFailedAvatarUrl(review.author?.avatarUrl ?? null)}
            />
          ) : (
            <span className="pr-review-activity-avatar is-fallback" aria-hidden="true"><StateIcon size={14} /></span>
          )}
          <StateIcon className="pr-review-activity-state-icon" data-state={review.state} size={16} aria-hidden="true" />
          <span>
            <strong>@{review.author?.login ?? 'unknown'}</strong> {state.label}
          </span>
          {submittedAt != null && (
            <time dateTime={review.submittedAt!} title={new Date(submittedAt).toLocaleString()}>
              {timeAgo(submittedAt)}
            </time>
          )}
          <span className="pr-review-activity-verdict" data-state={review.state}>{state.short}</span>
        </div>

        <nav className="pr-review-activity-nav" aria-label="Walk GitHub reviews">
          <button
            type="button"
            className="btn btn-sm commit-walk-btn"
            disabled={activeIndex === 0}
            onClick={() => setActiveId(reviews[activeIndex - 1]?.id ?? review.id)}
            aria-label="Newer review"
            title="Newer review"
          >
            <ChevronLeft size={14} />
          </button>
          <span>{activeIndex + 1} / {reviews.length}</span>
          <button
            type="button"
            className="btn btn-sm commit-walk-btn"
            disabled={activeIndex >= reviews.length - 1}
            onClick={() => setActiveId(reviews[activeIndex + 1]?.id ?? review.id)}
            aria-label="Older review"
            title="Older review"
          >
            <ChevronRight size={14} />
          </button>
          {review.htmlUrl && (
            <a className="pr-review-activity-link" href={review.htmlUrl} target="_blank" rel="noreferrer">
              View on GitHub <ExternalLink size={11} />
            </a>
          )}
        </nav>
      </header>

      {review.body.trim() ? (
        <Markdown content={review.body} className="pr-review-activity-body markdown-body" />
      ) : (
        <p className="pr-review-activity-empty">No overall comment was submitted with this review.</p>
      )}
    </section>
  )
}
