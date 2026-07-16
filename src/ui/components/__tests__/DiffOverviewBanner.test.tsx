// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiffOverviewBanner } from '../DiffOverviewBanner'
import type { DiffOverview } from '../../../lib/diff-overview'
import type { CommitInfo } from '../../hooks/useDiff'

// Stub lucide-react icons as no-op components so the jsdom env doesn't
// need the SVG engine. The banner imports several — we cover them all.
vi.mock('lucide-react', () => {
  const Stub = () => null
  const proxy: Record<string, unknown> = {}
  for (const k of [
    'ChevronDown', 'ChevronRight', 'Copy', 'Check', 'FileText', 'GitBranch',
    'GitCommit', 'GitPullRequest', 'Layers',
  ]) proxy[k] = Stub
  return proxy
})

function ov(partial: Partial<DiffOverview>): DiffOverview {
  return {
    kind: 'working-tree',
    headline: 'Working-tree changes on main',
    commitSubjects: [],
    commitCount: 0,
    truncated: 0,
    authors: [],
    ...partial,
  }
}

describe('DiffOverviewBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the headline as an h2', () => {
    render(<DiffOverviewBanner overview={ov({ headline: 'Reviewing 3 commits' })} />)
    const heading = screen.getByRole('heading', { level: 2, name: 'Reviewing 3 commits' })
    expect(heading).toBeInTheDocument()
  })

  it('renders the kind via the data-kind attribute (Phase 2 styling hook)', () => {
    const { container } = render(
      <DiffOverviewBanner overview={ov({ kind: 'pr' })} />,
    )
    const section = container.querySelector('section.diff-overview-banner')
    expect(section).not.toBeNull()
    expect(section!.getAttribute('data-kind')).toBe('pr')
  })

  it('renders the subtitle when present', () => {
    render(
      <DiffOverviewBanner
        overview={ov({ subtitle: '3 files changed · staged included' })}
      />,
    )
    expect(screen.getByText('3 files changed · staged included')).toBeInTheDocument()
  })

  it('omits the subtitle line when subtitle is undefined', () => {
    const { container } = render(
      <DiffOverviewBanner overview={ov({ subtitle: undefined })} />,
    )
    expect(container.querySelector('.diff-overview-banner-subtitle')).toBeNull()
  })

  it('renders for every kind without crashing', () => {
    const kinds: Array<DiffOverview['kind']> = [
      'working-tree', 'staged-only', 'range', 'commit-single', 'commit-series', 'pr',
    ]
    for (const kind of kinds) {
      const { container, unmount } = render(
        <DiffOverviewBanner
          overview={ov({
            kind,
            headline: `Headline for ${kind}`,
            ...(kind === 'range' ? { rangeLabel: 'main..feature' } : {}),
            ...(kind === 'pr' ? { prNumber: 1, prTitle: 't' } : {}),
          })}
        />,
      )
      expect(container.querySelector('section.diff-overview-banner')).not.toBeNull()
      expect(screen.getByRole('heading', { level: 2, name: `Headline for ${kind}` })).toBeInTheDocument()
      unmount()
    }
  })

  describe('details panel', () => {
    it('does not render a details toggle when there are no commit subjects', () => {
      render(<DiffOverviewBanner overview={ov({ commitSubjects: [] })} />)
      expect(screen.queryByRole('button', { name: /show/i })).not.toBeInTheDocument()
    })

    it('renders a collapsed details toggle when there are commit subjects', () => {
      render(
        <DiffOverviewBanner
          overview={ov({
            kind: 'commit-series',
            commitSubjects: ['first', 'second', 'third'],
            commitCount: 3,
          })}
        />,
      )
      const btn = screen.getByRole('button', { name: /show 3 commits/i })
      expect(btn).toHaveAttribute('aria-expanded', 'false')
      expect(btn).toHaveAttribute('aria-controls', 'diff-overview-banner-details')
    })

    it('expands the list and flips aria-expanded when clicked', () => {
      render(
        <DiffOverviewBanner
          overview={ov({
            kind: 'commit-series',
            commitSubjects: ['first', 'second'],
            commitCount: 2,
          })}
        />,
      )
      const btn = screen.getByRole('button', { name: /show 2 commits/i })
      fireEvent.click(btn)
      expect(btn).toHaveAttribute('aria-expanded', 'true')
      // List now visible
      expect(screen.getByRole('list')).toBeInTheDocument()
      expect(screen.getByText('first')).toBeInTheDocument()
      expect(screen.getByText('second')).toBeInTheDocument()
    })

    it('collapses back to hidden when clicked a second time', () => {
      render(
        <DiffOverviewBanner
          overview={ov({
            kind: 'commit-series',
            commitSubjects: ['only'],
            commitCount: 1,
          })}
        />,
      )
      const btn = screen.getByRole('button', { name: /show 1 commit/i })
      fireEvent.click(btn)
      expect(btn).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(btn)
      expect(btn).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
    })

    it('uses singular commit wording for a single subject', () => {
      render(
        <DiffOverviewBanner
          overview={ov({
            kind: 'commit-single',
            commitSubjects: ['only commit'],
            commitCount: 1,
          })}
        />,
      )
      expect(screen.getByRole('button', { name: /show 1 commit$/i })).toBeInTheDocument()
    })
  })

  describe('truncation badge', () => {
    it('does not render a badge when truncated is 0', () => {
      const { container } = render(
        <DiffOverviewBanner overview={ov({ truncated: 0 })} />,
      )
      expect(container.querySelector('.diff-overview-banner-truncated-badge')).toBeNull()
    })

    it('renders a "+N" badge when truncated > 0', () => {
      render(
        <DiffOverviewBanner
          overview={ov({ kind: 'range', truncated: 12, commitCount: 3 })}
        />,
      )
      const badge = screen.getByTitle('12 additional commits not shown')
      expect(badge).toBeInTheDocument()
      expect(badge.textContent).toBe('+12')
    })

    it('uses singular commit wording in the title for one truncated commit', () => {
      render(
        <DiffOverviewBanner
          overview={ov({ kind: 'range', truncated: 1, commitCount: 1 })}
        />,
      )
      expect(screen.getByTitle('1 additional commit not shown')).toBeInTheDocument()
    })
  })

  describe('detailed commit rows (show mode)', () => {
    let clipboardWrite: ReturnType<typeof vi.fn>

    beforeEach(() => {
      clipboardWrite = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: clipboardWrite },
        configurable: true,
        writable: true,
      })
    })

    function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
      return {
        sha: 'a'.repeat(40),
        shortSha: 'aaaaaaa',
        parents: ['b'.repeat(40)],
        subject: 'feat: add a widget',
        body: '',
        authorName: 'Alice',
        authorEmail: 'alice@example.com',
        authorDate: '2026-01-15T10:30:00+00:00',
        committerName: 'Alice',
        committerEmail: 'alice@example.com',
        committerDate: '2026-01-15T10:30:00+00:00',
        patch: 'diff --git ...',
        ...overrides,
      }
    }

    it('renders a detailed commit row when commits are provided', () => {
      render(
        <DiffOverviewBanner
          overview={ov({
            kind: 'commit-series',
            commitSubjects: ['feat: add a widget'],
            commitCount: 1,
          })}
          commits={[makeCommit()]}
        />,
      )
      const btn = screen.getByRole('button', { name: /show 1 commit/i })
      fireEvent.click(btn)
      expect(screen.getByText('aaaaaaa')).toBeInTheDocument()
      expect(screen.getByText('feat: add a widget')).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText(/2026/)).toBeInTheDocument()
    })

    it('copies the full SHA from a detailed commit row', async () => {
      render(
        <DiffOverviewBanner
          overview={ov({
            kind: 'commit-series',
            commitSubjects: ['feat: add a widget'],
            commitCount: 1,
          })}
          commits={[makeCommit()]}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /show 1 commit/i }))
      const sha = 'a'.repeat(40)
      const button = screen.getByRole('button', { name: `Copy full SHA ${sha}` })
      fireEvent.click(button)
      await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(sha))
    })

    it('shows a merge badge for multi-parent commits in the detailed list', () => {
      render(
        <DiffOverviewBanner
          overview={ov({
            kind: 'commit-series',
            commitSubjects: ['Merge branch feature'],
            commitCount: 1,
          })}
          commits={[makeCommit({
            parents: ['b'.repeat(40), 'c'.repeat(40)],
            subject: 'Merge branch feature',
          })]}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /show 1 commit/i }))
      expect(screen.getByText('merge')).toBeInTheDocument()
    })

    it('expands and hides the commit message body in a detailed row', () => {
      const body = 'This is the commit body.\n\nIt has multiple lines.'
      render(
        <DiffOverviewBanner
          overview={ov({
            kind: 'commit-series',
            commitSubjects: ['feat: add a widget'],
            commitCount: 1,
          })}
          commits={[makeCommit({ body })]}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /show 1 commit/i }))
      const toggle = screen.getByRole('button', { name: /show message/i })
      fireEvent.click(toggle)
      const pre = document.querySelector('.diff-overview-banner-commit-body-pre')
      expect(pre).toBeInTheDocument()
      expect(pre?.textContent).toBe(body)
    })
  })
})
