import { ExternalLink, CheckCircle2 } from 'lucide-react'
import type { SubmitPrReviewResult } from '../hooks/usePrSession'

interface PrSubmittedToastProps {
  result: SubmitPrReviewResult
  onDismiss: () => void
}

/**
 * Ephemeral toast shown only for a submission completed in this page lifetime.
 * It is deliberately not derived from persisted session metadata, so reloads
 * and later refreshes never resurrect a dismissed or historical notification.
 */
export function PrSubmittedToast({ result, onDismiss }: PrSubmittedToastProps) {
  return (
    <div className="pr-submitted-toast" role="status">
      <CheckCircle2 size={16} className="pr-submitted-icon" />
      <div className="pr-submitted-text">
        <strong>Review submitted to GitHub.</strong>
        {result.reviewUrl && (
          <>
            {' '}
            <a
              href={result.reviewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open review on GitHub <ExternalLink size={11} />
            </a>
          </>
        )}
        {result.authSource && result.authSource !== 'none' && (
          <span className="pr-submitted-auth">via {result.authSource}</span>
        )}
      </div>
      <button
        className="pr-submitted-dismiss"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
