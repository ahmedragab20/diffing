import { ChevronLeft, ChevronRight, GitCommit } from 'lucide-react'
import type { CommitInfo } from '../hooks/useDiff'

/**
 * Step through the multi-commit walk ring: null = all commits, then
 * 0..n-1 for single-commit focus. Matches the bar's prev/next buttons
 * and the `[` / `]` keyboard shortcuts.
 */
export function stepCommitWalk(
  activeIndex: number | null,
  total: number,
  direction: 'next' | 'prev',
): number | null {
  if (total < 2) return activeIndex
  const atAll = activeIndex === null
  const idx = activeIndex ?? 0
  if (direction === 'next') {
    if (atAll) return 0
    if (idx >= total - 1) return null
    return idx + 1
  }
  if (atAll) return total - 1
  if (idx <= 0) return null
  return idx - 1
}

/**
 * Step through commits in `diffing show` multi-commit mode.
 * When activeCommitIndex is null, "All commits" (full range patch) is shown.
 *
 * Layout keeps the next/prev chevrons in fixed slots: "Show all" always
 * reserves width (hidden when already on the all-commits view) so a quick
 * second click on next never lands on "Show all" after the first step.
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

  const goPrev = () => onChange(stepCommitWalk(activeIndex, total, 'prev'))
  const goNext = () => onChange(stepCommitWalk(activeIndex, total, 'next'))

  return (
    <div className="commit-walk-bar" role="navigation" aria-label="Walk commits">
      <button
        type="button"
        className="btn btn-sm commit-walk-btn"
        onClick={goPrev}
        aria-label="Previous commit"
        title="Previous commit ([)"
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
      <div className="commit-walk-trailing">
        <button
          type="button"
          className="btn btn-sm commit-walk-all"
          onClick={() => onChange(null)}
          disabled={atAll}
          title={atAll ? undefined : 'Show all commits'}
          aria-label="Show all commits"
        >
          Show all
        </button>
        <button
          type="button"
          className="btn btn-sm commit-walk-btn"
          onClick={goNext}
          aria-label="Next commit"
          title="Next commit (])"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
