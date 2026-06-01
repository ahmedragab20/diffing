import { useState, useEffect, useRef } from 'react'
import { Copy, Check, ChevronDown, ChevronRight, GitCommit, FileText } from 'lucide-react'
import type { CommitInfo } from '../hooks/useDiff'

interface CommitBannerProps {
  commit: CommitInfo
  /** 0-based index; useful for keyboard / aria labelling when stacked. */
  index: number
  /** Total number of banners in the current stack. */
  total: number
}

/**
 * Renders the metadata header for a single commit when diffing is in `show`
 * mode. The banner sits above the regular diff list and reproduces the
 * information a developer would see in `git log --pretty=raw` — subject, short
 * SHA (copyable), author/committer identity and date, and a collapsible
 * message body.
 */
export function CommitBanner({ commit, index, total }: CommitBannerProps) {
  const [copied, setCopied] = useState(false)
  const [bodyOpen, setBodyOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copySha = async () => {
    try {
      await navigator.clipboard.writeText(commit.sha)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be denied (insecure context, missing permission, etc.).
      // Failing silently is fine — the user can still select-and-copy manually.
    }
  }

  const hasBody = commit.body.trim().length > 0
  const hasMultipleParents = commit.parents.length > 1
  const ariaLabel =
    total > 1 ? `Commit ${index + 1} of ${total}: ${commit.subject}` : `Commit: ${commit.subject}`

  return (
    <section className="commit-banner" aria-label={ariaLabel}>
      <header className="commit-banner-header">
        <div className="commit-banner-line">
          <GitCommit size={14} className="commit-banner-icon" aria-hidden="true" />
          <button
            type="button"
            className="commit-banner-sha"
            onClick={copySha}
            title={copied ? 'Copied full SHA' : 'Click to copy full SHA'}
            aria-label={`Copy full SHA ${commit.sha}`}
          >
            <span className="commit-banner-sha-text">{commit.shortSha}</span>
            {copied ? (
              <Check size={12} className="commit-banner-sha-icon" aria-hidden="true" />
            ) : (
              <Copy size={12} className="commit-banner-sha-icon" aria-hidden="true" />
            )}
          </button>
          {hasMultipleParents && (
            <span
              className="commit-banner-merge-badge"
              title={`Merge commit with ${commit.parents.length} parents`}
            >
              merge
            </span>
          )}
          <h2 className="commit-banner-subject">{commit.subject}</h2>
        </div>
        <div className="commit-banner-meta">
          <span className="commit-banner-author">
            <span className="commit-banner-author-name">{commit.authorName}</span>
            <span className="commit-banner-author-email">&lt;{commit.authorEmail}&gt;</span>
          </span>
          <span className="commit-banner-date" title={commit.authorDate}>
            {formatDate(commit.authorDate)}
          </span>
          {commit.committerName !== commit.authorName ||
          commit.committerEmail !== commit.authorEmail ? (
            <span
              className="commit-banner-committer"
              title={`Committed by ${commit.committerName} <${commit.committerEmail}> at ${commit.committerDate}`}
            >
              <span className="commit-banner-committer-label">committed by</span>{' '}
              <span>{commit.committerName}</span>
            </span>
          ) : null}
        </div>
      </header>

      {hasBody && (
        <div className="commit-banner-body">
          <button
            type="button"
            className="commit-banner-body-toggle"
            onClick={() => setBodyOpen((o) => !o)}
            aria-expanded={bodyOpen}
            aria-controls={`commit-banner-body-${commit.shortSha}`}
          >
            {bodyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <FileText size={13} aria-hidden="true" />
            <span>{bodyOpen ? 'Hide message' : 'Show message'}</span>
          </button>
          {bodyOpen && (
            <pre
              id={`commit-banner-body-${commit.shortSha}`}
              className="commit-banner-body-pre"
            >
              {commit.body}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}

function formatDate(iso: string): string {
  // Render in the user's locale + their local timezone (not the commit's
  // original zone) so the UI feels native. The full ISO string is preserved
  // in `title` for inspection.
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
