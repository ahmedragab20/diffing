// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PrReviewActivity } from '../PrReviewActivity'

const reviews = [
  {
    id: 2,
    author: { login: 'ahmedragab20', avatarUrl: 'https://example.test/avatar.png' },
    body: 'Approved again buddy@',
    state: 'APPROVED',
    submittedAt: '2026-07-18T20:00:00.000Z',
    htmlUrl: 'https://github.test/review/2',
  },
  {
    id: 1,
    author: { login: 'reviewer' },
    body: 'Please address the failing check.',
    state: 'CHANGES_REQUESTED',
    submittedAt: '2026-07-18T19:00:00.000Z',
  },
] as any

describe('PrReviewActivity', () => {
  it('shows the latest overall review comment and verdict', () => {
    render(<PrReviewActivity reviews={reviews} />)
    expect(screen.getByText('Approved again buddy@')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View on GitHub/i })).toHaveAttribute('href', 'https://github.test/review/2')
  })

  it('walks older review submissions without changing the diff', () => {
    render(<PrReviewActivity reviews={reviews} />)
    fireEvent.click(screen.getByRole('button', { name: 'Older review' }))
    expect(screen.getByText('Please address the failing check.')).toBeInTheDocument()
    expect(screen.getByText('Changes requested')).toBeInTheDocument()
  })
})
