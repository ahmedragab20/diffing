// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MockupLocationChips } from '../MockupLocationChips'
import type { MockupComment } from '../../../lib/mockup-types'

function comment(overrides: Partial<MockupComment>): MockupComment {
  return {
    id: 'c1',
    screenId: 'main',
    kind: 'block',
    selector: 'button.pay',
    body: 'b',
    status: 'open',
    createdAt: 0,
    createdAtMockupVersion: 2,
    replies: [],
    ...overrides,
  }
}

describe('MockupLocationChips', () => {
  it('shows kind+locator, version, and viewport chips', () => {
    render(
      <MockupLocationChips
        comment={comment({ kind: 'section', target: 'hero' })}
      />,
    )
    expect(screen.getByText('section · hero')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText('desktop')).toBeInTheDocument()
  })

  it('legacy comments without a viewport render the desktop chip', () => {
    const legacy = comment({})
    delete (legacy as any).viewport
    render(<MockupLocationChips comment={legacy} />)
    expect(screen.getByText('desktop')).toBeInTheDocument()
  })

  it('block comments use the selector as the locator', () => {
    render(<MockupLocationChips comment={comment({})} />)
    expect(screen.getByText('block · button.pay')).toBeInTheDocument()
  })

  it('point comments use the coordinates as the locator', () => {
    render(
      <MockupLocationChips
        comment={comment({ kind: 'point', x: 72, y: 18 })}
      />,
    )
    expect(screen.getByText('pin · 72%, 18%')).toBeInTheDocument()
  })

  it('compact mode hides the kind+locator chip', () => {
    render(
      <MockupLocationChips
        comment={comment({ kind: 'section', target: 'hero' })}
        compact
      />,
    )
    expect(screen.queryByText('section · hero')).not.toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText('desktop')).toBeInTheDocument()
  })
})
