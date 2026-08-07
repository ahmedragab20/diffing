import { memo } from 'react'
import { GitBranch, Minimize2 } from 'lucide-react'

interface ZenBarProps {
  repoName: string
  branch: string
  fileCount: number
  totalFileCount: number
  additions: number
  deletions: number
  showMode: boolean
  showCommitCount: number
  onExit: () => void
}

/**
 * The only chrome visible in diffs zen mode: the active branch and the diff
 * summary (file count + additions/deletions), plus an exit button. Mirrors the
 * Toolbar's filesLabel/stats logic so the two never disagree about the count.
 */
export const ZenBar = memo(function ZenBar({
  repoName,
  branch,
  fileCount,
  totalFileCount,
  additions,
  deletions,
  showMode,
  showCommitCount,
  onExit,
}: ZenBarProps) {
  const filesLabel = showMode
    ? `${showCommitCount} commit${showCommitCount === 1 ? '' : 's'}`
    : fileCount === totalFileCount
      ? `${fileCount} file${fileCount !== 1 ? 's' : ''}`
      : `${fileCount}/${totalFileCount} files`

  return (
    <header className="zen-bar" role="banner">
      <span className="zen-bar-branch" title={branch || repoName}>
        <GitBranch size={13} aria-hidden="true" />
        <span className="zen-bar-branch-text">{branch || repoName || 'diffing'}</span>
      </span>
      <span className="zen-bar-count" aria-label="Diff summary">
        {filesLabel}
      </span>
      {(additions > 0 || deletions > 0) && (
        <span className="zen-bar-count zen-bar-count-diff" aria-hidden="true">
          {additions > 0 && <span className="stat-additions">+{additions}</span>}
          {deletions > 0 && <span className="stat-deletions">−{deletions}</span>}
        </span>
      )}
      <span className="zen-bar-hint">z or Esc to exit</span>
      <button
        type="button"
        className="zen-bar-exit"
        onClick={onExit}
        title="Exit zen mode (z)"
        aria-label="Exit zen mode"
      >
        <Minimize2 size={13} aria-hidden="true" />
        Exit zen
      </button>
    </header>
  )
})
