import { useState, useEffect, useCallback } from 'react'
import { GitPullRequest, ExternalLink, CheckCircle2 } from 'lucide-react'
import type { PrSession } from '../../lib/pr-session'

interface PrSubmittedToastProps {
  session: PrSession
}

/**
 * Persistent toast shown above the diff after a successful submit. The user
 * can dismiss it (locally; it will re-appear on refresh since `session.submittedAt`
 * is server-persisted). The "Open review" button links to the just-created
 * review on github.com.
 */
export function PrSubmittedToast({ session }: PrSubmittedToastProps) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Reset dismissal when a new submit lands.
    setDismissed(false)
  }, [session.submittedAt])

  if (dismissed) return null

  return (
    <div className="pr-submitted-toast" role="status">
      <CheckCircle2 size={16} className="pr-submitted-icon" />
      <div className="pr-submitted-text">
        <strong>Review submitted to GitHub.</strong>
        {session.submittedReviewUrl && (
          <>
            {' '}
            <a
              href={session.submittedReviewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open review on GitHub <ExternalLink size={11} />
            </a>
          </>
        )}
        {session.authSource && (
          <span className="pr-submitted-auth">via {session.authSource}</span>
        )}
      </div>
      <button
        className="pr-submitted-dismiss"
        onClick={() => setDismissed(true)}
        title="Dismiss"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
