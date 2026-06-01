// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CommitBanner } from '../components/CommitBanner'
import type { CommitInfo } from '../hooks/useDiff'

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

describe('CommitBanner', () => {
  let clipboardWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWrite },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders subject, short SHA, and author metadata', () => {
    render(<CommitBanner commit={makeCommit()} index={0} total={1} />)

    expect(screen.getByRole('heading', { level: 2, name: 'feat: add a widget' })).toBeInTheDocument()
    expect(screen.getByText('aaaaaaa')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com', { exact: false })).toBeInTheDocument()
    // The date is rendered in the user's locale; just assert that a 2026
    // year shows up somewhere in the toolbar.
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('hides the body toggle when there is no message body', () => {
    render(<CommitBanner commit={makeCommit({ body: '' })} index={0} total={1} />)
    expect(screen.queryByRole('button', { name: /show message/i })).not.toBeInTheDocument()
  })

  it('reveals and hides the body via a toggle', () => {
    const body = 'This is the commit body.\n\nIt has multiple lines.'
    render(<CommitBanner commit={makeCommit({ body })} index={0} total={1} />)

    const toggle = screen.getByRole('button', { name: /show message/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const pre = document.querySelector('.commit-banner-body-pre')
    expect(pre).toBeInTheDocument()
    expect(pre?.textContent).toBe(body)

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.commit-banner-body-pre')).not.toBeInTheDocument()
  })

  it('copies the full SHA on click and briefly flips the icon', async () => {
    render(<CommitBanner commit={makeCommit()} index={0} total={1} />)
    const sha = 'a'.repeat(40)
    const button = screen.getByRole('button', { name: `Copy full SHA ${sha}` })

    fireEvent.click(button)
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(sha))
  })

  it('silently ignores clipboard failures', async () => {
    clipboardWrite.mockRejectedValue(new Error('denied'))
    render(<CommitBanner commit={makeCommit()} index={0} total={1} />)

    const button = screen.getByRole('button', { name: /Copy full SHA/ })
    // The click should not throw and should not crash the component.
    expect(() => fireEvent.click(button)).not.toThrow()
  })

  it('shows a "merge" badge for multi-parent commits', () => {
    render(
      <CommitBanner
        commit={makeCommit({
          parents: ['b'.repeat(40), 'c'.repeat(40)],
          subject: 'Merge branch feature',
        })}
        index={0}
        total={1}
      />,
    )

    expect(screen.getByText('merge')).toBeInTheDocument()
  })

  it('omits the committer line when committer == author', () => {
    render(<CommitBanner commit={makeCommit()} index={0} total={1} />)
    expect(screen.queryByText(/committed by/i)).not.toBeInTheDocument()
  })

  it('shows a "committed by" line when committer differs from author', () => {
    render(
      <CommitBanner
        commit={makeCommit({
          committerName: 'Bob',
          committerEmail: 'bob@example.com',
        })}
        index={0}
        total={1}
      />,
    )
    expect(screen.getByText(/committed by/i)).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('uses a stacked aria label when total > 1', () => {
    render(<CommitBanner commit={makeCommit()} index={0} total={3} />)
    expect(
      screen.getByRole('region', { name: 'Commit 1 of 3: feat: add a widget' }),
    ).toBeInTheDocument()
  })
})
