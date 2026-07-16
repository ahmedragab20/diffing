import { memo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, GitBranch, GitCommit, GitPullRequest, Layers } from 'lucide-react'
import type { DiffOverview, DiffOverviewKind } from '../../lib/diff-overview'

interface DiffOverviewBannerProps {
  overview: DiffOverview
}

/**
 * "What is this diff?" banner. Sits immediately below the toolbar and
 * always renders the kind + headline, plus a secondary meta row for the
 * subtitle, truncation badge, and commit-subject toggle, as well as a
 * collapsible detail panel. The two-row header mirrors CommitBanner so the
 * banner aligns with the file-view diff cards below it.
 *
 * The collapse state is purely local — invariant 6 says the banner must
 * not persist it.
 */
function DiffOverviewBannerImpl({ overview }: DiffOverviewBannerProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const hasDetails = overview.commitSubjects.length > 0
  const hasTruncation = overview.truncated > 0

  const hasMeta = Boolean(overview.subtitle) || hasTruncation || hasDetails

  return (
    <section
      className="diff-overview-banner"
      data-kind={overview.kind}
      aria-label={`Diff overview: ${overview.headline}`}
    >
      <header className="diff-overview-banner-header">
        <div className="diff-overview-banner-line">
          <KindIcon kind={overview.kind} />
          <h2 className="diff-overview-banner-headline">{overview.headline}</h2>
        </div>
        {hasMeta && (
          <div className="diff-overview-banner-meta">
            {overview.subtitle && (
              <span className="diff-overview-banner-subtitle">{overview.subtitle}</span>
            )}
            {hasTruncation && (
              <span
                className="diff-overview-banner-truncated-badge"
                title={`${overview.truncated} additional ${overview.truncated === 1 ? 'commit' : 'commits'} not shown`}
              >
                +{overview.truncated}
              </span>
            )}
            {hasDetails && (
              <button
                type="button"
                className="diff-overview-banner-details-toggle"
                onClick={() => setDetailsOpen((o) => !o)}
                aria-expanded={detailsOpen}
                aria-controls="diff-overview-banner-details"
              >
                {detailsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <FileText size={13} aria-hidden="true" />
                <span>
                  {detailsOpen ? 'Hide' : 'Show'} {overview.commitSubjects.length}{' '}
                  commit{overview.commitSubjects.length === 1 ? '' : 's'}
                </span>
              </button>
            )}
          </div>
        )}
      </header>
      {hasDetails && detailsOpen && (
        <CommitSubjectList
          overview={overview}
          id="diff-overview-banner-details"
        />
      )}
    </section>
  )
}

/** Per-commit subject list rendered when the details panel is expanded. */
function CommitSubjectList({
  overview,
  id,
}: {
  overview: DiffOverview
  id: string
}) {
  return (
    <ul id={id} className="diff-overview-banner-subjects">
      {overview.commitSubjects.map((subject, i) => {
        // Author + dates are surfaced only on the range + commit-* kinds.
        // For a small list (≤20) we show both; otherwise just the subject.
        const showMeta = i === 0 || i === overview.commitSubjects.length - 1
        return (
          <li key={`${i}-${subject}`} className="diff-overview-banner-subject-row">
            <GitCommit size={12} className="diff-overview-banner-subject-icon" aria-hidden="true" />
            <span className="diff-overview-banner-subject-text">{subject}</span>
            {showMeta && overview.fromDate && overview.toDate && (
              <span className="diff-overview-banner-subject-dates">
                {i === 0 ? overview.fromDate : overview.toDate}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Pick a lucide icon per overview kind. Pure visual grouping — never
 *  the only signal of the kind (the headline text always says it too). */
function KindIcon({ kind }: { kind: DiffOverviewKind }) {
  const props = { size: 14, className: 'diff-overview-banner-icon', 'aria-hidden': true } as const
  switch (kind) {
    case 'working-tree':
    case 'staged-only':
      return <Layers {...props} />
    case 'range':
      return <GitBranch {...props} />
    case 'commit-single':
    case 'commit-series':
      return <GitCommit {...props} />
    case 'pr':
      return <GitPullRequest {...props} />
  }
}

/**
 * Memoize with a stable key derived from the overview's identifying fields.
 * The full JSON.stringify of the overview is cheap because it's a small
 * plain object, and it changes only when the underlying diff context
 * changes (branch / range / commits / kind) — never on the file-tree state.
 */
function arePropsEqual(
  prev: DiffOverviewBannerProps,
  next: DiffOverviewBannerProps,
): boolean {
  return JSON.stringify(prev.overview) === JSON.stringify(next.overview)
}

export const DiffOverviewBanner = memo(DiffOverviewBannerImpl, arePropsEqual)
