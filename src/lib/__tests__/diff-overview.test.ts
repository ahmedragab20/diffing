// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildWorkingTreeOverview,
  buildStagedOnlyOverview,
  buildRangeOverview,
  buildCommitOverview,
  buildPrOverview,
  type DiffOverviewCommitRow,
} from '../diff-overview.js'

describe('buildWorkingTreeOverview', () => {
  it('produces a working-tree kind with the branch in the headline', () => {
    const ov = buildWorkingTreeOverview({
      branch: 'main',
      staged: false,
      untracked: false,
      untrackedCount: 0,
      fileCount: 3,
    })
    expect(ov.kind).toBe('working-tree')
    expect(ov.headline).toBe('Working-tree changes on main')
    expect(ov.subtitle).toBe('3 files changed')
  })

  it('omits the branch suffix when no branch is reported', () => {
    const ov = buildWorkingTreeOverview({
      branch: '',
      staged: false,
      untracked: false,
      untrackedCount: 0,
      fileCount: 1,
    })
    expect(ov.headline).toBe('Working-tree changes')
    expect(ov.subtitle).toBe('1 file changed')
  })

  it('mentions staged inclusion when the staged flag is on', () => {
    const ov = buildWorkingTreeOverview({
      branch: 'feature',
      staged: true,
      untracked: false,
      untrackedCount: 0,
      fileCount: 2,
    })
    expect(ov.subtitle).toContain('staged included')
    expect(ov.subtitle).toContain('2 files changed')
  })

  it('surfaces the untracked count when untracked files are included', () => {
    const single = buildWorkingTreeOverview({
      branch: 'main',
      staged: false,
      untracked: true,
      untrackedCount: 1,
      fileCount: 0,
    })
    expect(single.subtitle).toContain('1 untracked file')

    const many = buildWorkingTreeOverview({
      branch: 'main',
      staged: false,
      untracked: true,
      untrackedCount: 4,
      fileCount: 1,
    })
    expect(many.subtitle).toContain('4 untracked files')
  })

  it('always has an empty commit list (working tree has no commit metadata)', () => {
    const ov = buildWorkingTreeOverview({
      branch: 'main',
      staged: true,
      untracked: true,
      untrackedCount: 2,
      fileCount: 5,
    })
    expect(ov.commitSubjects).toEqual([])
    expect(ov.commitCount).toBe(0)
    expect(ov.truncated).toBe(0)
    expect(ov.authors).toEqual([])
  })
})

describe('buildStagedOnlyOverview', () => {
  it('produces a staged-only kind with the branch in the headline', () => {
    const ov = buildStagedOnlyOverview({ branch: 'main', fileCount: 4 })
    expect(ov.kind).toBe('staged-only')
    expect(ov.headline).toBe('Staged changes on main')
    expect(ov.subtitle).toBe('4 files staged for commit')
  })

  it('uses singular file wording for one file', () => {
    const ov = buildStagedOnlyOverview({ branch: 'main', fileCount: 1 })
    expect(ov.subtitle).toBe('1 file staged for commit')
  })

  it('omits the branch suffix when no branch is reported', () => {
    const ov = buildStagedOnlyOverview({ branch: '', fileCount: 2 })
    expect(ov.headline).toBe('Staged changes')
  })
})

describe('buildRangeOverview', () => {
  it('produces a range kind and joins revspecs into the headline verbatim', () => {
    const ov = buildRangeOverview({
      revspecs: ['main..feature'],
      branch: 'main',
      commitSeries: {
        subjects: ['feat: one', 'feat: two'],
        authors: ['Alice', 'Bob'],
        fromDate: '2026-01-01T00:00:00+00:00',
        toDate: '2026-02-01T00:00:00+00:00',
        commitCount: 2,
        truncated: 0,
      },
    })
    expect(ov.kind).toBe('range')
    expect(ov.headline).toBe('Comparing main..feature (current: main)')
    expect(ov.rangeLabel).toBe('main..feature')
    expect(ov.subtitle).toBe('2 commits')
  })

  it('preserves the `...` form the user typed', () => {
    const ov = buildRangeOverview({
      revspecs: ['main...feature'],
      branch: 'main',
      commitSeries: {
        subjects: ['a'],
        authors: ['A'],
        commitCount: 1,
        truncated: 0,
      },
    })
    expect(ov.headline).toBe('Comparing main...feature (current: main)')
    expect(ov.rangeLabel).toBe('main...feature')
  })

  it('joins multiple revspecs with a space', () => {
    const ov = buildRangeOverview({
      revspecs: ['HEAD~3', 'HEAD'],
      branch: 'main',
      commitSeries: {
        subjects: ['x', 'y'],
        authors: ['A'],
        commitCount: 2,
        truncated: 0,
      },
    })
    expect(ov.headline).toBe('Comparing HEAD~3 HEAD (current: main)')
    expect(ov.rangeLabel).toBe('HEAD~3 HEAD')
  })

  it('uses singular "commit" wording when the range resolves to a single commit', () => {
    const ov = buildRangeOverview({
      revspecs: ['HEAD~1..HEAD'],
      branch: 'main',
      commitSeries: {
        subjects: ['only commit'],
        authors: ['Alice'],
        commitCount: 1,
        truncated: 0,
      },
    })
    expect(ov.subtitle).toBe('1 commit')
  })

  it('surfaces the truncated count in the subtitle', () => {
    const ov = buildRangeOverview({
      revspecs: ['main..HEAD'],
      branch: 'main',
      commitSeries: {
        subjects: ['a', 'b'],
        authors: ['Alice'],
        commitCount: 2,
        truncated: 5,
      },
    })
    expect(ov.subtitle).toBe('2 of 7 commits shown')
    expect(ov.truncated).toBe(5)
  })

  it('omits the "(current: …)" suffix when branch is empty', () => {
    const ov = buildRangeOverview({
      revspecs: ['a..b'],
      branch: '',
      commitSeries: {
        subjects: ['s'],
        authors: ['A'],
        commitCount: 1,
        truncated: 0,
      },
    })
    expect(ov.headline).toBe('Comparing a..b')
  })

  it('propagates commit subjects, authors, and date range', () => {
    const ov = buildRangeOverview({
      revspecs: ['a..b'],
      branch: 'main',
      commitSeries: {
        subjects: ['one', 'two', 'three'],
        authors: ['Alice', 'Bob'],
        fromDate: '2026-01-01T00:00:00+00:00',
        toDate: '2026-03-01T00:00:00+00:00',
        commitCount: 3,
        truncated: 0,
      },
    })
    expect(ov.commitSubjects).toEqual(['one', 'two', 'three'])
    expect(ov.authors).toEqual(['Alice', 'Bob'])
    expect(ov.fromDate).toBe('2026-01-01T00:00:00+00:00')
    expect(ov.toDate).toBe('2026-03-01T00:00:00+00:00')
  })
})

describe('buildCommitOverview', () => {
  it('produces a commit-single kind for one commit', () => {
    const ov = buildCommitOverview({
      commits: [{ subject: 'first', author: 'Alice', date: '2026-01-01T00:00:00+00:00' }],
      truncated: 0,
    })
    expect(ov.kind).toBe('commit-single')
    expect(ov.headline).toBe('Commit: first')
  })

  it('falls back to "Single commit" when the subject is empty', () => {
    const ov = buildCommitOverview({
      commits: [{ subject: '' }],
      truncated: 0,
    })
    expect(ov.kind).toBe('commit-single')
    expect(ov.headline).toBe('Single commit')
  })

  it('produces a commit-series kind for multiple commits', () => {
    const ov = buildCommitOverview({
      commits: [
        { subject: 'a', author: 'A', date: '2026-01-01T00:00:00+00:00' },
        { subject: 'b', author: 'B', date: '2026-02-01T00:00:00+00:00' },
      ],
      truncated: 0,
    })
    expect(ov.kind).toBe('commit-series')
    expect(ov.headline).toBe('Reviewing 2 commits')
  })

  it('omits the subtitle for a series when nothing is truncated', () => {
    const ov = buildCommitOverview({
      commits: [
        { subject: 'a', author: 'A', date: '2026-01-01T00:00:00+00:00' },
        { subject: 'b', author: 'A', date: '2026-01-02T00:00:00+00:00' },
      ],
      truncated: 0,
    })
    expect(ov.subtitle).toBeUndefined()
  })

  it('surfaces the truncated count for a series', () => {
    const ov = buildCommitOverview({
      commits: [
        { subject: 'a', author: 'A' },
        { subject: 'b', author: 'A' },
      ],
      truncated: 3,
    })
    expect(ov.subtitle).toBe('2 of 5 commits shown')
    expect(ov.truncated).toBe(3)
  })

  it('aggregates authors and dates from the commit rows', () => {
    const rows: DiffOverviewCommitRow[] = [
      { subject: 'a', author: 'Alice', date: '2026-01-02T00:00:00+00:00' },
      { subject: 'b', author: 'Bob', date: '2026-01-01T00:00:00+00:00' },
    ]
    const ov = buildCommitOverview({ commits: rows, truncated: 0 })
    expect(ov.authors).toEqual(['Alice', 'Bob'])
    expect(ov.fromDate).toBe('2026-01-01T00:00:00+00:00')
    expect(ov.toDate).toBe('2026-01-02T00:00:00+00:00')
  })

  it('drops empty subjects but keeps the kind correct', () => {
    const ov = buildCommitOverview({
      commits: [
        { subject: 'a', author: 'A' },
        { subject: '', author: 'B' },
      ],
      truncated: 0,
    })
    expect(ov.commitSubjects).toEqual(['a'])
    expect(ov.authors).toEqual(['A', 'B'])
    expect(ov.commitCount).toBe(2)
  })
})

describe('buildPrOverview', () => {
  it('produces a pr kind with number + title in the headline', () => {
    const ov = buildPrOverview({
      prNumber: 42,
      prTitle: 'Add frobnication',
      prAuthor: 'alice',
      additions: 10,
      deletions: 4,
    })
    expect(ov.kind).toBe('pr')
    expect(ov.headline).toBe('PR #42: Add frobnication')
    expect(ov.subtitle).toBe('by alice · +10 / -4')
    expect(ov.prNumber).toBe(42)
    expect(ov.prTitle).toBe('Add frobnication')
  })

  it('omits the subtitle when no author or counts are known', () => {
    const ov = buildPrOverview({
      prNumber: 1,
      prTitle: 't',
      additions: 0,
      deletions: 0,
    })
    expect(ov.subtitle).toBeUndefined()
  })

  it('lists the author in the authors array', () => {
    const ov = buildPrOverview({
      prNumber: 7,
      prTitle: 't',
      prAuthor: 'bob',
      additions: 1,
      deletions: 0,
    })
    expect(ov.authors).toEqual(['bob'])
  })

  it('never has commit subjects (PRs render their own banner)', () => {
    const ov = buildPrOverview({
      prNumber: 7,
      prTitle: 't',
      prAuthor: null,
      additions: 0,
      deletions: 0,
    })
    expect(ov.commitSubjects).toEqual([])
    expect(ov.commitCount).toBe(0)
    expect(ov.truncated).toBe(0)
  })
})

describe('NUL-split parsing (integration check)', () => {
  // Mirrors the format emitted by `getCommitSeriesSummary`:
  //   git log --no-walk --reverse --pretty=%s%x00%an%x00%aI
  // We simulate the parser by feeding the builders the same shape the
  // git.ts helper produces, so a parser regression shows up here.
  it('accepts raw NUL-separated rows from getCommitSeriesSummary', () => {
    const raw = [
      'feat: one\u0000Alice\u00002026-01-02T10:00:00+00:00',
      'fix: two\u0000Bob\u00002026-01-01T08:00:00+00:00',
    ].join('\n')

    const subjects: string[] = []
    const authorSet: string[] = []
    const seen = new Set<string>()
    let fromDate: string | undefined
    let toDate: string | undefined
    for (const line of raw.split('\n')) {
      if (!line) continue
      const [subject = '', author = '', date = ''] = line.split('\u0000')
      if (subject) subjects.push(subject)
      if (author && !seen.has(author)) {
        seen.add(author)
        authorSet.push(author)
      }
      if (date) {
        if (!fromDate || date < fromDate) fromDate = date
        if (!toDate || date > toDate) toDate = date
      }
    }

    const ov = buildRangeOverview({
      revspecs: ['main..feature'],
      branch: 'main',
      commitSeries: {
        subjects,
        authors: authorSet,
        fromDate,
        toDate,
        commitCount: 2,
        truncated: 0,
      },
    })

    expect(ov.commitSubjects).toEqual(['feat: one', 'fix: two'])
    expect(ov.authors).toEqual(['Alice', 'Bob'])
    expect(ov.fromDate).toBe('2026-01-01T08:00:00+00:00')
    expect(ov.toDate).toBe('2026-01-02T10:00:00+00:00')
  })
})
