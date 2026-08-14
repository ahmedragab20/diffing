// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRef, type ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MockupFloatCard } from '../MockupFloatCard'

vi.mock('lucide-react', () => ({
  GripVertical: () => <svg data-testid="lucide-grip" />,
  X: () => <svg data-testid="lucide-x" />,
  Minus: () => <svg data-testid="lucide-minus" />,
  MessageSquare: () => <svg data-testid="lucide-msg" />,
  MessageSquarePlus: () => <svg data-testid="lucide-msg-plus" />,
  Maximize2: () => <svg data-testid="lucide-max" />,
  AlertTriangle: () => <svg data-testid="lucide-alert" />,
  Loader2: () => <svg data-testid="lucide-loader" />,
  Check: () => <svg data-testid="lucide-check" />,
  ChevronDown: () => <svg data-testid="lucide-chevron-down" />,
  ChevronRight: () => <svg data-testid="lucide-chevron-right" />,
  ChevronsUpDown: () => <svg data-testid="lucide-chevrons-up-down" />,
  Clock: () => <svg data-testid="lucide-clock" />,
}))

vi.mock('../CommentForm', () => ({
  CommentForm: () => null,
}))

vi.mock('../Markdown', () => ({
  Markdown: () => null,
}))

vi.mock('../../utils', () => ({ timeAgo: () => 'just now' }))

beforeEach(() => {
  // The card positions itself against the frame rect and clamps to the
  // viewport; jsdom reports zero rects by default, so give every element a
  // real box (same trick as the MockupCanvas suite).
  const rect = {
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
})

function renderCard({
  title = 'Comment 1',
  onClose = vi.fn(),
  children,
}: {
  title?: string
  onClose?: () => void
  children?: ReactNode
} = {}) {
  const frameRef = createRef<HTMLDivElement>()
  render(
    <div ref={frameRef}>
      <MockupFloatCard
        anchor={{ x: 50, y: 50 }}
        frameRef={frameRef}
        title={title}
        onClose={onClose}
      >
        {children}
      </MockupFloatCard>
    </div>,
  )
  return { onClose }
}

function dialog(): HTMLElement {
  return screen.getByRole('dialog')
}

function dragResize(edge: string, dx: number, dy: number) {
  const handle = document.querySelector(
    `.plan-float-resize-${edge}`,
  ) as HTMLElement
  fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 })
  fireEvent.mouseMove(window, {
    clientX: 100 + dx,
    clientY: 100 + dy,
  })
  fireEvent.mouseUp(window)
}

describe('MockupFloatCard', () => {
  it('renders all eight resize handles', () => {
    renderCard()
    const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
    for (const edge of edges) {
      expect(
        document.querySelector(`.plan-float-resize-${edge}`),
      ).not.toBeNull()
    }
    expect(document.querySelectorAll('.plan-float-resize')).toHaveLength(8)
  })

  it('grows width and height when dragging the southeast handle', () => {
    renderCard()
    expect(dialog().style.width).toBe('340px')
    expect(dialog().style.height).toBe('420px')
    dragResize('se', 40, 30)
    expect(dialog().style.width).toBe('380px')
    expect(dialog().style.height).toBe('450px')
  })

  it('clamps resized panels to the minimum size', () => {
    renderCard()
    dragResize('se', -10000, -10000)
    expect(dialog().style.width).toBe('300px')
    expect(dialog().style.height).toBe('240px')
  })

  it('minimize hides the dialog and shows the shared plan-style tray chip', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const tray = document.querySelector(
      '.plan-float-tray.mockup-float-tray',
    ) as HTMLElement
    expect(tray).not.toBeNull()
    expect(tray.getAttribute('role')).toBe('toolbar')
    const chip = tray.querySelector('.plan-float-tray-chip') as HTMLElement
    expect(chip).not.toBeNull()
    expect(chip.textContent).toContain('Comment 1')
  })

  it('restore brings back the dialog with the child draft intact', () => {
    const { onClose } = renderCard({
      children: <textarea aria-label="Draft" defaultValue="draft body" />,
    })
    expect(screen.getByLabelText('Draft')).toHaveValue('draft body')
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(screen.queryByLabelText('Draft')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Comment 1' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toHaveValue('draft body')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from the tray close button without restoring', () => {
    const { onClose } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(
      document.querySelector('.plan-float-tray-close') as HTMLElement,
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores Escape while minimized but closes when expanded', () => {
    const { onClose } = renderCard()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Comment 1' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('ignores Escape while typing in an editable field', () => {
    const { onClose } = renderCard({
      children: <textarea aria-label="Draft" />,
    })
    fireEvent.keyDown(screen.getByLabelText('Draft'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
