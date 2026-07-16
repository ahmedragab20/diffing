// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DiffOverviewBanner } from '../DiffOverviewBanner'
import type { DiffOverview } from '../../../lib/diff-overview'

// Stub lucide-react icons as no-op components so the jsdom env doesn't
// need the SVG engine. The banner imports several — we cover them all.
vi.mock('lucide-react', () => {
  const Stub = () => null
  const proxy: Record<string, unknown> = {}
  for (const k of [
    'ChevronDown', 'ChevronRight', 'FileText', 'GitBranch',
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
})
