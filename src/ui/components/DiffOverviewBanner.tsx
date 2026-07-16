import { memo, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check, FileText, GitBranch, GitCommit, GitPullRequest, Layers } from 'lucide-react'
import type { DiffOverview, DiffOverviewKind } from '../../lib/diff-overview'
import type { CommitInfo } from '../hooks/useDiff'

interface DiffOverviewBannerProps {
  overview: DiffOverview
  /**
   * Full commit metadata for `diffing show` mode. When supplied, the banner's
   * detail panel renders each commit with SHA, author, date and message body
   * instead of a bare subject list, so a single overview banner can replace
   * the stacked per-commit banners.
   */
  commits?: CommitInfo[]
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
function DiffOverviewBannerImpl({ overview, commits }: DiffOverviewBannerProps) {
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
        <CommitDetailList
          overview={overview}
          commits={commits}
          id="diff-overview-banner-details"
        />
      )}
    </section>
  )
}

/** Per-commit detail list rendered when the details panel is expanded. */
function CommitDetailList({
  overview,
  commits,
  id,
}: {
  overview: DiffOverview
  commits?: CommitInfo[]
  id: string
}) {
  if (commits && commits.length > 0) {
    return (
      <ul id={id} className="diff-overview-banner-subjects">
        {commits.map((commit, i) => (
          <CommitDetailRow key={commit.sha} commit={commit} index={i} total={commits.length} />
        ))}
        {overview.truncated > 0 && (
          <li className="diff-overview-banner-truncated" role="status">
            + {overview.truncated} more commit{overview.truncated === 1 ? '' : 's'} not shown
          </li>
        )}
      </ul>
    )
  }

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

function CommitDetailRow({
  commit,
  index,
  total,
}: {
  commit: CommitInfo
  index: number
  total: number
}) {
  const [copied, setCopied] = useState(false)
  const [bodyOpen, setBodyOpen] = useState(false)

  const copySha = async () => {
    try {
      await navigator.clipboard.writeText(commit.sha)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be denied; fail silently.
    }
  }

  const hasBody = commit.body.trim().length > 0
  const hasMultipleParents = commit.parents.length > 1
  const ariaLabel =
    total > 1 ? `Commit ${index + 1} of ${total}: ${commit.subject}` : `Commit: ${commit.subject}`

  return (
    <li className="diff-overview-banner-commit-row" aria-label={ariaLabel}>
      <div className="diff-overview-banner-commit-line">
        <GitCommit size={12} className="diff-overview-banner-subject-icon" aria-hidden="true" />
        <button
          type="button"
          className="diff-overview-banner-commit-sha"
          onClick={copySha}
          title={copied ? 'Copied full SHA' : 'Click to copy full SHA'}
          aria-label={`Copy full SHA ${commit.sha}`}
        >
          <span>{commit.shortSha}</span>
          {copied ? (
            <Check size={12} aria-hidden="true" />
          ) : (
            <Copy size={12} aria-hidden="true" />
          )}
        </button>
        {hasMultipleParents && (
          <span
            className="diff-overview-banner-merge-badge"
            title={`Merge commit with ${commit.parents.length} parents`}
          >
            merge
          </span>
        )}
        <span className="diff-overview-banner-commit-subject">{commit.subject}</span>
      </div>
      <div className="diff-overview-banner-commit-meta">
        <span className="diff-overview-banner-commit-author">
          <span className="diff-overview-banner-commit-author-name">{commit.authorName}</span>
          <span className="diff-overview-banner-commit-author-email">&lt;{commit.authorEmail}&gt;</span>
        </span>
        <span className="diff-overview-banner-commit-date" title={commit.authorDate}>
          {formatDate(commit.authorDate)}
        </span>
        {commit.committerName !== commit.authorName ||
        commit.committerEmail !== commit.authorEmail ? (
          <span
            className="diff-overview-banner-commit-committer"
            title={`Committed by ${commit.committerName} <${commit.committerEmail}> at ${commit.committerDate}`}
          >
            <span className="diff-overview-banner-commit-committer-label">committed by</span>{' '}
            <span>{commit.committerName}</span>
          </span>
        ) : null}
      </div>
      {hasBody && (
        <div className="diff-overview-banner-commit-body">
          <button
            type="button"
            className="diff-overview-banner-commit-body-toggle"
            onClick={() => setBodyOpen((o) => !o)}
            aria-expanded={bodyOpen}
            aria-controls={`diff-overview-commit-body-${commit.shortSha}`}
          >
            {bodyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <FileText size={13} aria-hidden="true" />
            <span>{bodyOpen ? 'Hide message' : 'Show message'}</span>
          </button>
          {bodyOpen && (
            <pre
              id={`diff-overview-commit-body-${commit.shortSha}`}
              className="diff-overview-banner-commit-body-pre"
            >
              {commit.body}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
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
  return (
    JSON.stringify(prev.overview) === JSON.stringify(next.overview) &&
    JSON.stringify(prev.commits) === JSON.stringify(next.commits)
  )
}

export const DiffOverviewBanner = memo(DiffOverviewBannerImpl, arePropsEqual)
