// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { MockupComment } from '../../../lib/mockup-types'
import { MockupCanvas, type ProbeHit } from '../MockupCanvas'

vi.mock('lucide-react', () => ({
  GripVertical: () => <svg data-testid="lucide-grip" />,
  Minus: () => <svg data-testid="lucide-minus" />,
  X: () => <svg data-testid="lucide-x" />,
  AlertTriangle: () => <svg data-testid="lucide-alert" />,
  Bot: () => <svg data-testid="lucide-bot" />,
  CheckCircle2: () => <svg data-testid="lucide-check-circle" />,
  ChevronDown: () => <svg data-testid="lucide-chevron-down" />,
  ChevronRight: () => <svg data-testid="lucide-chevron-right" />,
  Pencil: () => <svg data-testid="lucide-pencil" />,
  Reply: () => <svg data-testid="lucide-reply" />,
  Trash2: () => <svg data-testid="lucide-trash" />,
  User: () => <svg data-testid="lucide-user" />,
  Check: () => <svg data-testid="lucide-check" />,
  Clock: () => <svg data-testid="lucide-clock" />,
  MessageSquare: () => <svg data-testid="lucide-msg" />,
  MessageSquareWarning: () => <svg data-testid="lucide-msg-warn" />,
}))

vi.mock('../Markdown', () => ({
  Markdown: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}))

vi.mock('../CommentForm', () => ({
  CommentForm: ({ initialBody = '', onSubmit }: any) => (
    <div data-testid="mockup-comment-form">
      <textarea aria-label="Comment body" defaultValue={initialBody} />
      <button onClick={() => onSubmit('posted')}>Submit</button>
    </div>
  ),
}))

vi.mock('../../utils', () => ({ timeAgo: () => 'just now' }))

function comment(overrides: Partial<MockupComment> = {}): MockupComment {
  return {
    id: 'c1',
    screenId: 'main',
    kind: 'block',
    selector: 'button.pay',
    body: 'too wide',
    status: 'open',
    createdAt: 0,
    createdAtMockupVersion: 2,
    viewport: 'desktop',
    replies: [],
    ...overrides,
  }
}

const baseProps = {
  title: 'Landing',
  srcdoc: '<html><body><h1>Hi</h1></body></html>',
  viewport: 1280 as const,
  comments: [] as MockupComment[],
  onIframeLoad: vi.fn(),
  hover: null as ProbeHit | null,
  pending: null as ProbeHit | null,
  selected: null as MockupComment | null,
  selectedId: null,
  selectedIndex: 0,
  composerDraftKey: '',
  onPinToggle: vi.fn(),
  onDismissThread: vi.fn(),
  onCancelPending: vi.fn(),
  onPostComment: vi.fn(),
  onThreadResolve: vi.fn(),
  onThreadUnresolve: vi.fn(),
  onThreadDelete: vi.fn(),
  onThreadEdit: vi.fn(),
  onThreadReply: vi.fn(),
  onThreadEditReply: vi.fn(),
  onThreadDeleteReply: vi.fn(),
}

beforeEach(() => {
  // Float cards position against the frame rect and clamp to the window;
  // jsdom reports zero rects by default, so give every element a real box.
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

function renderCanvas(overrides: Partial<typeof baseProps> = {}) {
  const frameRef = createRef<HTMLDivElement>()
  const iframeRef = createRef<HTMLIFrameElement>()
  const result = render(
    <MockupCanvas
      {...baseProps}
      frameRef={frameRef}
      iframeRef={iframeRef}
      {...overrides}
    />,
  )
  return { ...result, frameRef, iframeRef }
}

describe('MockupCanvas', () => {
  it('serves the screen document in a sandboxed iframe framed at the viewport width', () => {
    renderCanvas({ viewport: 768 })
    const frame = document.querySelector('.mockup-frame') as HTMLElement
    expect(frame.style.width).toBe('768px')
    const iframe = screen.getByTitle(
      'Landing — tablet (768px)',
    ) as HTMLIFrameElement
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.srcdoc).toContain('<h1>Hi</h1>')
    // the served document is passed through as-is (probe injection is server-side)
  })

  it('pins only the scoped comments passed in, with version+viewport labels', () => {
    renderCanvas({
      comments: [
        comment({ id: 'c1' }),
        comment({ id: 'c2', kind: 'point', x: 72, y: 18 }),
      ],
    })
    const pins = screen.getAllByRole('button', { name: /^Comment \d:/ })
    expect(pins).toHaveLength(2)
    expect(pins[0]).toHaveAccessibleName(expect.stringContaining('v2'))
    expect(pins[0]).toHaveAccessibleName(expect.stringContaining('desktop'))
    expect(pins[0].textContent).toBe('1')
    expect(pins[1].textContent).toBe('2')
  })

  it('clicking a pin toggles the thread selection', () => {
    const onPinToggle = vi.fn()
    renderCanvas({ comments: [comment({ id: 'c1' })], onPinToggle })
    fireEvent.click(screen.getByRole('button', { name: /^Comment 1:/ }))
    expect(onPinToggle).toHaveBeenCalledWith('c1')
  })

  it('draws the hover outline with the hit label', () => {
    renderCanvas({
      hover: {
        kind: 'block',
        selector: 'button.pay',
        x: 10,
        y: 10,
        rect: { x: 5, y: 6, w: 20, h: 8 },
      } as ProbeHit,
    })
    const outline = document.querySelector('.mockup-outline') as HTMLElement
    expect(outline).not.toBeNull()
    expect(outline.className).toContain('kind-block')
    expect(outline.textContent).toContain('block · button.pay')
  })

  it('opens the composer for a pending hit with the anchor label', () => {
    renderCanvas({
      pending: {
        kind: 'block',
        selector: 'button.pay',
        x: 50,
        y: 50,
      } as ProbeHit,
    })
    expect(
      screen.getByRole('dialog', { name: 'Commenting on block · button.pay' }),
    ).toBeInTheDocument()
  })

  it('shows the selected thread in a floating card', () => {
    renderCanvas({
      comments: [comment({ id: 'c1', body: 'too wide' })],
      selected: comment({ id: 'c1', body: 'too wide' }),
      selectedId: 'c1',
      selectedIndex: 0,
    })
    expect(
      screen.getByRole('dialog', { name: 'Comment 1' }),
    ).toBeInTheDocument()
    expect(screen.getByText('too wide')).toBeInTheDocument()
  })

  it('posts the composer body through onPostComment', () => {
    const onPostComment = vi.fn()
    renderCanvas({
      pending: {
        kind: 'block',
        selector: 'button.pay',
        x: 50,
        y: 50,
      } as ProbeHit,
      onPostComment,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onPostComment).toHaveBeenCalledWith('posted')
  })
})
