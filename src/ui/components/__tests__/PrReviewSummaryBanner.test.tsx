// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../PrChecksPopover', () => ({
  PrChecksPopover: () => <button type="button">2/2 passed</button>,
}))

import { PrReviewSummaryBanner } from '../PrReviewSummaryBanner'

const session = {
  pullNumber: 42,
  title: 'Unify the review experience',
  author: { login: 'octocat' },
  changedFiles: 3,
  additions: 21,
  deletions: 8,
  headSha: 'abcdef123456',
} as any

describe('PrReviewSummaryBanner', () => {
  it('groups PR context outside the action toolbar', () => {
    render(<PrReviewSummaryBanner session={session} draftCount={1} />)

    expect(screen.getByRole('region', { name: /pull request #42/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Unify the review experience' })).toBeInTheDocument()
    expect(screen.getByText('@octocat')).toBeInTheDocument()
    expect(screen.getByText('3 files')).toBeInTheDocument()
    expect(screen.getByLabelText('21 additions and 8 deletions')).toHaveTextContent('+21−8')
    expect(screen.getByText('1 draft')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2/2 passed' })).toBeInTheDocument()
  })

  it('omits an empty draft badge', () => {
    render(<PrReviewSummaryBanner session={session} draftCount={0} />)
    expect(screen.queryByText(/draft/)).not.toBeInTheDocument()
  })
})
