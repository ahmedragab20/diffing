// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MockupScreenTabs } from '../MockupScreenTabs'
import type { MockupScreen } from '../../../lib/mockup-types'

const screens: MockupScreen[] = [
  { id: 'main', label: 'Main', html: '<p>a</p>' },
  { id: 'checkout', label: 'Checkout', html: '<p>b</p>' },
  { id: 'empty', label: 'Empty', html: '<p>c</p>' },
]

describe('MockupScreenTabs', () => {
  it('renders every screen and marks the active one', () => {
    render(
      <MockupScreenTabs
        screens={screens}
        activeScreenId="checkout"
        openCounts={{ main: 2, checkout: 1 }}
        onSelect={vi.fn()}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Main2',
      'Checkout1',
      'Empty',
    ])
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('shows open counts scoped to the current view only on screens with >0', () => {
    render(
      <MockupScreenTabs
        screens={screens}
        activeScreenId="main"
        openCounts={{ main: 3, checkout: 1 }}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('3 open')).toBeInTheDocument()
    expect(screen.getByLabelText('1 open')).toBeInTheDocument()
    // screens without open comments render no count badge
    expect(screen.queryByLabelText('0 open')).not.toBeInTheDocument()
    expect(screen.getByTitle('Empty — 0 open in this view')).toBeInTheDocument()
  })

  it('calls onSelect with the clicked screen id', () => {
    const onSelect = vi.fn()
    render(
      <MockupScreenTabs
        screens={screens}
        activeScreenId="main"
        openCounts={{}}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getAllByRole('tab')[1])
    expect(onSelect).toHaveBeenCalledWith('checkout')
  })

  it('centers double- and triple-digit counts in the badge without wrapping', () => {
    render(
      <MockupScreenTabs
        screens={screens}
        activeScreenId="main"
        openCounts={{ main: 12, checkout: 123 }}
        onSelect={vi.fn()}
      />,
    )
    const twelve = screen.getByLabelText('12 open')
    const hundredTwentyThree = screen.getByLabelText('123 open')
    expect(twelve.textContent).toBe('12')
    expect(hundredTwentyThree.textContent).toBe('123')
    // Badge keeps the count chip class and renders the full number.
    for (const badge of [twelve, hundredTwentyThree]) {
      expect(badge).toHaveClass('mockup-screen-tab-count')
    }
  })
})
