// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
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
