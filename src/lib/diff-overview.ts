/**
 * Pure, dependency-free builders for the "What is this diff?" overview banner.
 *
 * The overview is the always-on, deterministic summary that sits below the
 * toolbar and tells the reviewer at a glance what the displayed diffs are for
 * (working-tree changes / staged / range `main..feature` / commit series /
 * PR #N). It is derived *only* from git metadata already in scope — no
 * settings, no heuristics, no AI.
 *
 * This file deliberately has no `node:child_process` / `fs` imports: every
 * builder takes already-fetched inputs and returns a plain `DiffOverview`.
 * That keeps these functions trivially unit-testable and side-effect-free.
 */

export type DiffOverviewKind =
  | 'working-tree'
  | 'staged-only'
  | 'range'
  | 'commit-single'
  | 'commit-series'
  | 'pr'

export interface DiffOverviewCommitRow {
  subject: string
  author?: string
  date?: string
}

export interface DiffOverview {
  kind: DiffOverviewKind
  /** One-line headline for the banner (rendered as the `<h2>`). */
  headline: string
  /** Optional secondary line (range label, counts, etc.). */
  subtitle?: string
  /** Per-commit list (range + commit-* kinds only). */
  commitSubjects: string[]
  /** Total commit count the builder derived; surfaced for truncation logic. */
  commitCount: number
  /** Commits dropped past the cap; matches the underlying `truncated` field. */
  truncated: number
  /** Earliest author date (ISO 8601) across the listed commits, if known. */
  fromDate?: string
  /** Latest author date (ISO 8601) across the listed commits, if known. */
  toDate?: string
  /** De-duplicated list of authors in commit order. */
  authors: string[]
  /** Original revspec text the user typed, e.g. `main..feature`. */
  rangeLabel?: string
  /** PR title (PR kind only). */
  prTitle?: string
  /** PR number (PR kind only). */
  prNumber?: number
}

export interface WorkingTreeInput {
  branch: string
  staged: boolean
  untracked: boolean
  untrackedCount: number
  fileCount: number
}

export interface StagedOnlyInput {
  branch: string
  fileCount: number
}

export interface RangeInput {
  revspecs: string[]
  branch: string
  /**
   * Lightweight commit metadata already fetched by the caller. The banner
   * doesn't render the full per-commit list when there are too many, but the
   * totals + first/last dates always come along.
   */
  commitSeries: {
    subjects: string[]
    authors: string[]
    fromDate?: string
    toDate?: string
    commitCount: number
    truncated: number
  }
}

export interface CommitInput {
  commits: DiffOverviewCommitRow[]
  truncated: number
}

export interface PrInput {
  prNumber: number
  prTitle: string
  prAuthor?: string | null
  additions: number
  deletions: number
}

/**
 * Compose the working-tree banner. Used by the default `git diff` (unstaged +
 * optionally staged + optionally untracked) flow.
 */
export function buildWorkingTreeOverview(input: WorkingTreeInput): DiffOverview {
  const { branch, staged, untracked, untrackedCount, fileCount } = input
  const fileLabel = fileCount === 1 ? 'file' : 'files'
  const onBranch = branch ? ` on ${branch}` : ''
  const headline = `Working-tree changes${onBranch}`

  const parts: string[] = [`${fileCount} ${fileLabel} changed`]
  if (staged) parts.push('staged included')
  if (untracked) {
    const u = untrackedCount === 1 ? '1 untracked file' : `${untrackedCount} untracked files`
    parts.push(u)
  }
  const subtitle = parts.join(' · ')

  return {
    kind: 'working-tree',
    headline,
    subtitle,
    commitSubjects: [],
    commitCount: 0,
    truncated: 0,
    authors: [],
  }
}

/**
 * Staged-only banner: only `--staged` is on, no untracked, no revisions.
 * Shown when the user reviews a clean staging area.
 */
export function buildStagedOnlyOverview(input: StagedOnlyInput): DiffOverview {
  const { branch, fileCount } = input
  const fileLabel = fileCount === 1 ? 'file' : 'files'
  const onBranch = branch ? ` on ${branch}` : ''
  return {
    kind: 'staged-only',
    headline: `Staged changes${onBranch}`,
    subtitle: `${fileCount} ${fileLabel} staged for commit`,
    commitSubjects: [],
    commitCount: 0,
    truncated: 0,
    authors: [],
  }
}

/**
 * Range banner: user-supplied revisions like `main..feature`, `HEAD~3..HEAD`,
 * or multiple SHAs/tags. `revspecs` are joined into the `rangeLabel` verbatim
 * (preserving `..` / `...` form the user typed).
 */
export function buildRangeOverview(input: RangeInput): DiffOverview {
  const { revspecs, branch, commitSeries } = input
  const rangeLabel = revspecs.join(' ')
  const { commitCount, truncated, subjects, authors, fromDate, toDate } =
    summariseCommitSeries(commitSeries)
  const isSingle = commitCount === 1
  const plural = isSingle ? 'commit' : 'commits'
  const onBranch = branch ? ` (current: ${branch})` : ''
  const headline = `Comparing ${rangeLabel}${onBranch}`
  const subtitle = truncated > 0
    ? `${commitCount} of ${commitCount + truncated} ${plural} shown`
    : `${commitCount} ${plural}`
  return {
    kind: 'range',
    headline,
    subtitle,
    commitSubjects: subjects,
    commitCount,
    truncated,
    fromDate,
    toDate,
    authors,
    rangeLabel,
  }
}

/**
 * Commit banner: invoked by `diffing show <rev>` — single SHA or series. The
 * kind branches on `commits.length` so a single-commit review gets a tighter
 * headline than a series.
 */
export function buildCommitOverview(input: CommitInput): DiffOverview {
  const { commits, truncated } = input
  const { commitCount, subjects, authors, fromDate, toDate } =
    summariseCommitRows(commits)
  const isSingle = commitCount === 1
  const kind: DiffOverviewKind = isSingle ? 'commit-single' : 'commit-series'

  let headline: string
  let subtitle: string | undefined
  if (isSingle) {
    headline = subjects[0] ? `Commit: ${subjects[0]}` : 'Single commit'
  } else {
    const plural = 'commits'
    headline = `Reviewing ${commitCount} ${plural}`
    subtitle = truncated > 0
      ? `${commitCount} of ${commitCount + truncated} ${plural} shown`
      : undefined
  }

  return {
    kind,
    headline,
    subtitle,
    commitSubjects: subjects,
    commitCount,
    truncated,
    fromDate,
    toDate,
    authors,
  }
}

/**
 * PR banner: built from fields already in `pr-session.json`. No extra git or
 * GitHub calls — the server's PR-mode branch hands us the headline shape and
 * we keep the field set minimal so the banner never lies about counts.
 */
export function buildPrOverview(input: PrInput): DiffOverview {
  const { prNumber, prTitle, prAuthor, additions, deletions } = input
  const subParts: string[] = []
  if (prAuthor) subParts.push(`by ${prAuthor}`)
  if (additions || deletions) {
    subParts.push(`+${additions} / -${deletions}`)
  }
  return {
    kind: 'pr',
    headline: `PR #${prNumber}: ${prTitle}`,
    subtitle: subParts.length > 0 ? subParts.join(' · ') : undefined,
    commitSubjects: [],
    commitCount: 0,
    truncated: 0,
    authors: prAuthor ? [prAuthor] : [],
    prNumber,
    prTitle,
  }
}

/**
 * Normalise a list of commit rows for the banner. Aggregates author + date
 * ranges and trims subjects past the cap (so the banner never tries to render
 * thousands of rows). The caller is responsible for passing the *visible*
 * slice; `truncated` is preserved as-is.
 */
function summariseCommitRows(
  rows: DiffOverviewCommitRow[],
): {
  commitCount: number
  subjects: string[]
  authors: string[]
  fromDate?: string
  toDate?: string
} {
  return summariseCommitSeries({
    subjects: rows.map((r) => r.subject),
    authors: [],
    commitCount: rows.length,
    truncated: 0,
  }, rows)
}

/**
 * Internal helper used by both the row-list and the pre-aggregated series
 * shape. When the caller already has aggregated metadata, it passes that
 * directly; the rows are only used to recover authors + dates if the caller
 * didn't supply them.
 */
function summariseCommitSeries(
  series: {
    subjects: string[]
    authors: string[]
    fromDate?: string
    toDate?: string
    commitCount: number
    truncated: number
  },
  rows?: DiffOverviewCommitRow[],
): {
  commitCount: number
  subjects: string[]
  authors: string[]
  fromDate?: string
  toDate?: string
  truncated: number
} {
  const subjects = series.subjects.filter((s) => s.length > 0)
  let authors = series.authors
  let fromDate = series.fromDate
  let toDate = series.toDate
  if (rows && (authors.length === 0 || !fromDate || !toDate)) {
    const seen = new Set(authors)
    for (const r of rows) {
      if (r.author && !seen.has(r.author)) {
        seen.add(r.author)
        authors = [...authors, r.author]
      }
      if (r.date) {
        if (!fromDate || r.date < fromDate) fromDate = r.date
        if (!toDate || r.date > toDate) toDate = r.date
      }
    }
  }
  return {
    commitCount: series.commitCount,
    subjects,
    authors,
    fromDate,
    toDate,
    truncated: series.truncated,
  }
}
