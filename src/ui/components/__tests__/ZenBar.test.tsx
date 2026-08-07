// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Stub the two lucide icons ZenBar references so jsdom doesn't need the SVG engine.
vi.mock('lucide-react', () => ({
  GitBranch: () => <svg data-testid="lucide-git-branch" />,
  Minimize2: () => <svg data-testid="lucide-minimize" />,
}))

// ── Imports (after mocks) ──
import { ZenBar } from '../ZenBar'

function renderBar(overrides: Partial<React.ComponentProps<typeof ZenBar>> = {}) {
  return render(
    <ZenBar
      repoName="my-repo"
      branch="main"
      fileCount={3}
      totalFileCount={3}
      additions={0}
      deletions={0}
      showMode={false}
      showCommitCount={0}
      onExit={vi.fn()}
      {...overrides}
    />,
  )
}

describe('ZenBar', () => {
  it('shows the branch and a plain file count when every file is viewed', () => {
    renderBar()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('3 files')).toBeInTheDocument()
  })

  it('shows an x/y files label when only part of the diff has been viewed', () => {
    renderBar({ fileCount: 2, totalFileCount: 5 })
    expect(screen.getByText('2/5 files')).toBeInTheDocument()
  })

  it('shows the commit count when the multi-commit walk bar is active', () => {
    renderBar({ showMode: true, showCommitCount: 4 })
    expect(screen.getByText('4 commits')).toBeInTheDocument()
  })

  it('fires onExit when the exit button is clicked', async () => {
    const onExit = vi.fn()
    renderBar({ onExit })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Exit zen mode' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('falls back to the repo name when the branch is unknown', () => {
    renderBar({ branch: '' })
    expect(screen.getByText('my-repo')).toBeInTheDocument()
  })

  it('shows the additions/deletions stats chip when the diff has both', () => {
    renderBar({ additions: 12, deletions: 3 })
    expect(screen.getByText('+12')).toBeInTheDocument()
    // The minus sign is U+2212 (−), not ASCII hyphen.
    expect(screen.getByText('−3')).toBeInTheDocument()
    const chip = screen.getByText('+12').closest('.zen-bar-count-diff')
    expect(chip).not.toBeNull()
    expect(chip?.querySelector('.stat-additions')?.textContent).toBe('+12')
    expect(chip?.querySelector('.stat-deletions')?.textContent).toBe('−3')
  })

  it('shows only the additions side when deletions are zero', () => {
    renderBar({ additions: 5, deletions: 0 })
    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.queryByText(/^−/)).not.toBeInTheDocument()
  })

  it('shows only the deletions side when additions are zero', () => {
    renderBar({ additions: 0, deletions: 7 })
    expect(screen.getByText('−7')).toBeInTheDocument()
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('omits the stats chip when there are no additions or deletions', () => {
    renderBar({ additions: 0, deletions: 0 })
    expect(screen.queryByText('+0')).not.toBeInTheDocument()
    expect(screen.queryByText('−0')).not.toBeInTheDocument()
    expect(document.querySelector('.zen-bar-count-diff')).toBeNull()
  })
})
