// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../useHaptics', () => ({
  fireFeedback: vi.fn(),
  playSound: vi.fn(),
}))

import { usePlanReviewKeymaps } from '../usePlanReviewKeymaps'

function makeActions() {
  return {
    onNavigatePlan: vi.fn(),
    onToggleViewMode: vi.fn(),
    onToggleZenMode: vi.fn(),
    onToggleCommentsRail: vi.fn(),
    onToggleOutline: vi.fn(),
    onCycleTabSize: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleLineWrap: vi.fn(),
    onToggleLineNumbers: vi.fn(),
    onOpenTheme: vi.fn(),
    onOpenShortcuts: vi.fn(),
  }
}

function Harness({ actions }: { actions: ReturnType<typeof makeActions> }) {
  usePlanReviewKeymaps(actions)
  return null
}

describe('plan review keymaps', () => {
  beforeEach(() => {
    vi.stubGlobal('scrollBy', vi.fn())
    vi.stubGlobal('scrollTo', vi.fn())
  })

  it('toggles the comments rail on bare c', () => {
    const actions = makeActions()
    render(<Harness actions={actions} />)

    fireEvent.keyDown(window, { key: 'c' })

    expect(actions.onToggleCommentsRail).toHaveBeenCalledOnce()
  })

  it('does not steal ⌘C / Ctrl+C for the comments-rail shortcut', () => {
    const actions = makeActions()
    render(<Harness actions={actions} />)

    const metaC = new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true })
    const metaPrevented = !window.dispatchEvent(metaC)

    const altC = new KeyboardEvent('keydown', { key: 'c', altKey: true, bubbles: true, cancelable: true })
    const altPrevented = !window.dispatchEvent(altC)

    // Ctrl+C must also leave the browser copy chord alone (ctrl block returns
    // without preventDefault unless the key is d/u).
    const ctrlC = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    const ctrlPrevented = !window.dispatchEvent(ctrlC)

    expect(metaPrevented).toBe(false)
    expect(altPrevented).toBe(false)
    expect(ctrlPrevented).toBe(false)
    expect(actions.onToggleCommentsRail).not.toHaveBeenCalled()
  })

  it('still supports plan chrome toggles and navigation', () => {
    const actions = makeActions()
    render(<Harness actions={actions} />)

    fireEvent.keyDown(window, { key: 'm' })
    fireEvent.keyDown(window, { key: 'z' })
    fireEvent.keyDown(window, { key: 'o' })
    fireEvent.keyDown(window, { key: 'J' })
    fireEvent.keyDown(window, { key: 'K' })
    fireEvent.keyDown(window, { key: '?' })

    expect(actions.onToggleViewMode).toHaveBeenCalledOnce()
    expect(actions.onToggleZenMode).toHaveBeenCalledOnce()
    expect(actions.onToggleOutline).toHaveBeenCalledOnce()
    expect(actions.onNavigatePlan).toHaveBeenNthCalledWith(1, 'next')
    expect(actions.onNavigatePlan).toHaveBeenNthCalledWith(2, 'prev')
    expect(actions.onOpenShortcuts).toHaveBeenCalledOnce()
  })
})
