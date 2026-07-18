// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scope } from '../../lib/searchTypes'

vi.mock('../useHaptics', () => ({
  fireFeedback: vi.fn(),
  playSound: vi.fn(),
}))

import { useDiffReviewKeymaps } from '../useDiffReviewKeymaps'

function makeActions() {
  return {
    onNavigateFile: vi.fn(),
    onNavigateCommit: vi.fn(),
    onToggleViewed: vi.fn(),
    onToggleDiffStyle: vi.fn(),
    onCycleTabSize: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleLineWrap: vi.fn(),
    onToggleLineNumbers: vi.fn(),
    onCycleDiffIndicators: vi.fn(),
    onCycleLineDiffType: vi.fn(),
    onOpenPalette: vi.fn<(scope: Scope) => void>(),
    onTogglePalette: vi.fn(),
    onOpenTheme: vi.fn(),
    onOpenShortcuts: vi.fn(),
  }
}

function Harness({ actions }: { actions: ReturnType<typeof makeActions> }) {
  useDiffReviewKeymaps(actions)
  return null
}

describe('shared diff review keymaps', () => {
  beforeEach(() => {
    vi.stubGlobal('scrollBy', vi.fn())
    vi.stubGlobal('scrollTo', vi.fn())
  })

  it('supports file navigation, viewed state, sidebar, and formatting bindings', () => {
    const actions = makeActions()
    render(<Harness actions={actions} />)

    for (const key of ['J', 'K', 'v', 'm', 't', 'b', 'w', 'n', 'i', 'I']) {
      fireEvent.keyDown(window, { key })
    }

    expect(actions.onNavigateFile).toHaveBeenNthCalledWith(1, 'next')
    expect(actions.onNavigateFile).toHaveBeenNthCalledWith(2, 'prev')
    expect(actions.onToggleViewed).toHaveBeenCalledOnce()
    expect(actions.onToggleDiffStyle).toHaveBeenCalledOnce()
    expect(actions.onCycleTabSize).toHaveBeenCalledOnce()
    expect(actions.onToggleSidebar).toHaveBeenCalledOnce()
    expect(actions.onToggleLineWrap).toHaveBeenCalledOnce()
    expect(actions.onToggleLineNumbers).toHaveBeenCalledOnce()
    expect(actions.onCycleDiffIndicators).toHaveBeenCalledOnce()
    expect(actions.onCycleLineDiffType).toHaveBeenCalledOnce()
  })

  it('supports the same search and theme sequences as local review', () => {
    const actions = makeActions()
    render(<Harness actions={actions} />)

    fireEvent.keyDown(window, { key: '/' })
    fireEvent.keyDown(window, { key: 's' })
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'f' })
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'v' })
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 't' })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(actions.onOpenPalette).toHaveBeenNthCalledWith(1, 'text')
    expect(actions.onOpenPalette).toHaveBeenNthCalledWith(2, 'symbols')
    expect(actions.onOpenPalette).toHaveBeenNthCalledWith(3, 'all')
    expect(actions.onOpenPalette).toHaveBeenNthCalledWith(4, 'files')
    expect(actions.onOpenTheme).toHaveBeenCalledOnce()
    expect(actions.onTogglePalette).toHaveBeenCalledOnce()
  })

  it('supports scrolling, help, and commit navigation where available', () => {
    const actions = makeActions()
    render(<Harness actions={actions} />)

    fireEvent.keyDown(window, { key: 'd', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true })
    fireEvent.keyDown(window, { key: ']' })
    fireEvent.keyDown(window, { key: '[' })
    fireEvent.keyDown(window, { key: '?' })

    expect(window.scrollBy).toHaveBeenCalledTimes(2)
    expect(actions.onNavigateCommit).toHaveBeenCalledWith('next')
    expect(actions.onNavigateCommit).toHaveBeenCalledWith('prev')
    expect(actions.onOpenShortcuts).toHaveBeenCalledOnce()
  })
})
