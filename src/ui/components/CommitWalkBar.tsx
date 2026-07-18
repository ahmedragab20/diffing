import { ChevronLeft, ChevronRight, GitCommit } from 'lucide-react'
import type { CommitInfo } from '../hooks/useDiff'

/**
 * Step through commits in `diffing show` multi-commit mode.
 * When activeCommitIndex is null, "All commits" (full range patch) is shown.
 */
export function CommitWalkBar({
  commits,
  activeIndex,
  onChange,
}: {
  commits: CommitInfo[]
  /** null = all commits; 0..n-1 = single commit focus */
  activeIndex: number | null
  onChange: (index: number | null) => void
}) {
  if (commits.length < 2) return null

  const total = commits.length
  const atAll = activeIndex === null
  const idx = activeIndex ?? 0
  const current = atAll ? null : commits[idx]

  const goPrev = () => {
    if (atAll) onChange(total - 1)
    else if (idx <= 0) onChange(null)
    else onChange(idx - 1)
  }
  const goNext = () => {
    if (atAll) onChange(0)
    else if (idx >= total - 1) onChange(null)
    else onChange(idx + 1)
  }

  return (
    <div className="commit-walk-bar" role="navigation" aria-label="Walk commits">
      <button
        type="button"
        className="btn btn-sm commit-walk-btn"
        onClick={goPrev}
        aria-label="Previous commit"
        title="Previous commit"
      >
        <ChevronLeft size={14} />
      </button>
      <div className="commit-walk-center">
        <GitCommit size={14} aria-hidden="true" />
        {atAll ? (
          <span className="commit-walk-label">
            All {total} commits
          </span>
        ) : (
          <span className="commit-walk-label" title={current?.subject}>
            <span className="commit-walk-count">
              {idx + 1} / {total}
            </span>
            <code className="commit-walk-sha">{current?.shortSha ?? current?.sha.slice(0, 7)}</code>
            <span className="commit-walk-subject">{current?.subject}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        className="btn btn-sm commit-walk-btn"
        onClick={goNext}
        aria-label="Next commit"
        title="Next commit"
      >
        <ChevronRight size={14} />
      </button>
      {!atAll && (
        <button
          type="button"
          className="btn btn-sm commit-walk-all"
          onClick={() => onChange(null)}
        >
          Show all
        </button>
      )}
    </div>
  )
}
