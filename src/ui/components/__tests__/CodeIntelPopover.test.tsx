// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeIntelPopover } from '../CodeIntelPopover'
import type { CodeIntelTarget, HoverState } from '../../hooks/useCodeIntel'

vi.mock('../Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

function target(anchor: HTMLElement): CodeIntelTarget {
  return {
    path: 'src/a.ts',
    side: 'additions',
    line: 7,
    character: 2,
    tokenText: 'foo',
    anchor,
  }
}

describe('CodeIntelPopover', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('shows a pending tooltip at the anchor after its delay without scrolling', async () => {
    const anchor = document.createElement('span')
    anchor.getBoundingClientRect = vi.fn(() => ({
      top: 100,
      bottom: 120,
      left: 50,
      right: 80,
      width: 30,
      height: 20,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    }))
    document.body.append(anchor)
    const hover: HoverState = { target: target(anchor), status: 'pending', markdown: null }

    render(<CodeIntelPopover hover={hover} onHold={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('tooltip')).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
      await Promise.resolve()
    })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Starting language server…')
    expect(tooltip).toHaveStyle({ top: '126px', left: '50px', visibility: 'visible' })
  })

  it('shows a readable reason when hover is unavailable', () => {
    const anchor = document.createElement('span')
    document.body.append(anchor)
    const hover: HoverState = {
      target: target(anchor),
      status: 'unavailable',
      markdown: null,
      reason: 'unsupported-language',
    }

    render(<CodeIntelPopover hover={hover} onHold={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByRole('tooltip')).toHaveTextContent('unsupported-language')
  })
})
