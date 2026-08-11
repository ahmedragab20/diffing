// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { DiffLineEntry } from '../../hooks/useDiffSearch'

// Stub the lucide icons FileSearchBar references so jsdom doesn't need the SVG engine.
vi.mock('lucide-react', () => ({
  Search: () => <svg data-testid="lucide-search" />,
  X: () => <svg data-testid="lucide-x" />,
  ChevronUp: () => <svg data-testid="lucide-chevron-up" />,
  ChevronDown: () => <svg data-testid="lucide-chevron-down" />,
}))

// ── Imports (after mocks) ──
import { FileSearchBar } from '../FileSearchBar'

// jsdom has no layout and does not implement scrollIntoView (calling it on a
// real element would throw). Define a no-op on the prototype so renders work,
// then reset it before each test so call-count assertions stay isolated.
beforeEach(() => {
  if (!Element.prototype.scrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  }
  vi.mocked(Element.prototype.scrollIntoView).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeHits(): DiffLineEntry[] {
  return [
    { filePath: 'src/a.ts', lineNumber: 1, side: 'additions', content: 'const foo = 1' },
    { filePath: 'src/a.ts', lineNumber: 3, side: 'deletions', content: 'let FOO = 3' },
  ]
}

function renderBar(overrides: Partial<React.ComponentProps<typeof FileSearchBar>> = {}) {
  const props = {
    filePath: 'src/a.ts',
    query: '',
    hits: [] as DiffLineEntry[],
    index: 0,
    onQueryChange: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<FileSearchBar {...props} />)
  return props
}

describe('FileSearchBar', () => {
  it('renders the search input, count span, and prev/next/close buttons', () => {
    renderBar()

    const input = screen.getByRole('textbox', { name: 'Find in file' })
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('placeholder', 'Find in file…')
    expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Previous match' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next match' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close search' })).toBeInTheDocument()
    expect(screen.getByRole('search')).toHaveAttribute('aria-label', 'Find in file')
  })

  it('shows "N matches" while the query is empty', () => {
    renderBar({ hits: makeHits() })
    expect(screen.getByText('2 matches')).toBeInTheDocument()
  })

  it('shows the singular "1 match" form for a single hit', () => {
    renderBar({ hits: [makeHits()[0]] })
    expect(screen.getByText('1 match')).toBeInTheDocument()
  })

  it('shows "0 matches" for an empty query with no hits', () => {
    renderBar()
    expect(screen.getByText('0 matches')).toBeInTheDocument()
  })

  it('shows current/total while the query is non-empty', () => {
    renderBar({ query: 'foo', hits: makeHits(), index: 0 })
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('shows current/total from the active index', () => {
    renderBar({ query: 'foo', hits: makeHits(), index: 1 })
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('shows 0/0 for a query with no hits', () => {
    renderBar({ query: 'zzz', hits: [], index: 0 })
    expect(screen.getByText('0/0')).toBeInTheDocument()
  })

  it('types into the input call onQueryChange', () => {
    const { onQueryChange } = renderBar()

    fireEvent.change(screen.getByRole('textbox', { name: 'Find in file' }), {
      target: { value: 'foo' },
    })

    expect(onQueryChange).toHaveBeenCalledWith('foo')
  })

  it('disables prev/next when there are no hits, but never the close button', () => {
    renderBar()

    expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close search' })).toBeEnabled()
  })

  it('enables prev/next when there are hits', () => {
    renderBar({ hits: makeHits() })

    expect(screen.getByRole('button', { name: 'Previous match' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next match' })).toBeEnabled()
  })

  it('re-focuses and selects the input when focusNonce bumps (⌘F after blur)', () => {
    const props = {
      filePath: 'src/a.ts',
      query: 'foo',
      hits: makeHits(),
      index: 0,
      focusNonce: 1,
      onQueryChange: vi.fn(),
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onClose: vi.fn(),
    }
    const { rerender } = render(<FileSearchBar {...props} />)

    const input = screen.getByRole('textbox', { name: 'Find in file' })
    expect(input).toHaveFocus()

    // Blur (user clicked elsewhere), then ⌘F re-opens → focusNonce bumps.
    input.blur()
    expect(input).not.toHaveFocus()

    rerender(<FileSearchBar {...props} focusNonce={2} />)

    expect(input).toHaveFocus()
  })

  it('scrolls the field back into view while typing (minimal, nearest scroll)', () => {
    const { onQueryChange } = renderBar()
    const input = screen.getByRole('textbox', { name: 'Find in file' })

    // A match jump (Enter) left the field focused but scrolled off-screen.
    const scrollSpy = vi.spyOn(input, 'scrollIntoView').mockImplementation(() => {})
    fireEvent.change(input, { target: { value: 'foo' } })

    expect(onQueryChange).toHaveBeenCalledWith('foo')
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
  })

  it('re-scrolls the field into view on every keystroke, not just the first', () => {
    const { onQueryChange } = renderBar()
    const input = screen.getByRole('textbox', { name: 'Find in file' })

    const scrollSpy = vi.spyOn(input, 'scrollIntoView').mockImplementation(() => {})
    // vitest's spyOn records one install-time invocation when it patches the
    // prototype method — drop it so the count reflects real calls only.
    scrollSpy.mockClear()
    fireEvent.change(input, { target: { value: 'f' } })
    fireEvent.change(input, { target: { value: 'fo' } })
    fireEvent.change(input, { target: { value: 'foo' } })

    expect(onQueryChange).toHaveBeenCalledTimes(3)
    expect(scrollSpy).toHaveBeenCalledTimes(3)
  })

  it('brings the field back into view when ⌘F refocuses it after a jump', () => {
    const props = {
      filePath: 'src/a.ts',
      query: 'foo',
      hits: makeHits(),
      index: 0,
      focusNonce: 1,
      onQueryChange: vi.fn(),
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onClose: vi.fn(),
    }
    const { rerender } = render(<FileSearchBar {...props} />)
    const input = screen.getByRole('textbox', { name: 'Find in file' })

    const scrollSpy = vi.spyOn(input, 'scrollIntoView').mockImplementation(() => {})
    rerender(<FileSearchBar {...props} focusNonce={2} />)

    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
  })

  it('fires onPrev/onNext/onClose from the buttons', () => {
    const { onPrev, onNext, onClose } = renderBar({ hits: makeHits() })

    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(onNext).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(onPrev).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Enter cycles next and Shift+Enter cycles prev from the input', () => {
    const { onNext, onPrev } = renderBar({ hits: makeHits() })

    const input = screen.getByRole('textbox', { name: 'Find in file' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('Escape closes from the input', () => {
    const { onClose } = renderBar()

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find in file' }), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape does not leak to the global keymap (would otherwise exit zen)', () => {
    const { onClose } = renderBar()
    const windowKeyDown = vi.fn()
    window.addEventListener('keydown', windowKeyDown)

    // A keydown inside the bar must close the search AND stop propagating, so
    // the shared window keymap (zen-exit on Escape) never sees the stroke.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find in file' }), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('search'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(2)
    expect(windowKeyDown).not.toHaveBeenCalled()
  })

  it('handles Enter and Escape on the wrapper too', () => {
    const { onNext, onClose } = renderBar({ hits: makeHits() })

    const wrapper = screen.getByRole('search')
    fireEvent.keyDown(wrapper, { key: 'Enter' })
    fireEvent.keyDown(wrapper, { key: 'Escape' })

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops click propagation from the wrapper', () => {
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <FileSearchBar
          filePath="src/a.ts"
          query=""
          hits={makeHits()}
          index={0}
          onQueryChange={vi.fn()}
          onNext={vi.fn()}
          onPrev={vi.fn()}
          onClose={vi.fn()}
        />
      </div>,
    )

    fireEvent.click(screen.getByRole('search'))

    expect(onParentClick).not.toHaveBeenCalled()
  })
})
