// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrSubmittedToast } from '../PrSubmittedToast'

describe('PrSubmittedToast', () => {
  it('is controlled by the current submission event and dismisses permanently for that event', () => {
    const dismiss = vi.fn()
    const { rerender } = render(
      <PrSubmittedToast
        result={{ ok: true, reviewId: 5, reviewUrl: 'https://github.test/review/5', authSource: 'gh' }}
        onDismiss={dismiss}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Review submitted to GitHub')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(dismiss).toHaveBeenCalledOnce()

    rerender(<></>)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
