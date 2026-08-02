// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewComment } from '../../../lib/types'
import { CommentBubble } from '../CommentBubble'

// CommentBubble pulls reply actions from the comments hook; stub it so the
// footer markup is all we exercise.
vi.mock('../../hooks/useComments', () => ({
  useComments: () => ({
    resolveComment: vi.fn(),
    unresolveComment: vi.fn(),
    addReply: vi.fn(),
    removeReply: vi.fn(),
    editReply: vi.fn(),
    applySuggestion: vi.fn(),
    editComment: vi.fn(),
  }),
}))

vi.mock('../Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}))

vi.mock('../CommentForm', () => ({
  CommentForm: () => <div data-testid="form" />,
}))

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    filePath: 'a.ts',
    side: 'additions',
    lineNumber: 9,
    lineContent: '+const x = 1',
    body: 'fragile check',
    status: 'open',
    createdAt: Date.now(),
    replies: [],
    ...overrides,
  }
}

describe('CommentBubble footer meta row', () => {
  it('renders severity + outdated badges above the reply trigger', () => {
    const { container } = render(
      <CommentBubble comment={comment({ severity: 'blocking', outdated: true })} onDelete={vi.fn()} />,
    )

    const meta = container.querySelector('.comment-canvas-footer-meta')
    expect(meta).not.toBeNull()

    const sev = meta!.querySelector('.comment-sev-badge-soft')
    expect(sev).not.toBeNull()
    expect(sev).toHaveAttribute('data-severity', 'blocking')
    // Soft, icon-led pill — a leading svg must be present (mirrors outdated).
    expect(sev!.querySelector('svg')).not.toBeNull()

    const outdated = meta!.querySelector('.comment-outdated-badge')
    expect(outdated).not.toBeNull()
    expect(outdated).toHaveTextContent('outdated')

    // Meta row sits before the reply/resolve row inside the footer.
    const row = container.querySelector('.comment-canvas-footer-row')
    expect(row).not.toBeNull()
    expect(
      meta!.compareDocumentPosition(row!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('omits the meta row when no severity and not outdated', () => {
    const { container } = render(
      <CommentBubble comment={comment({ severity: undefined, outdated: undefined })} onDelete={vi.fn()} />,
    )
    expect(container.querySelector('.comment-canvas-footer-meta')).toBeNull()
  })

  it('omits the meta row when severity is "none"', () => {
    const { container } = render(
      <CommentBubble comment={comment({ severity: 'none' })} onDelete={vi.fn()} />,
    )
    expect(container.querySelector('.comment-canvas-footer-meta')).toBeNull()
  })

  it('shows only the outdated badge when outdated but no severity', () => {
    const { container } = render(
      <CommentBubble comment={comment({ severity: undefined, outdated: true })} onDelete={vi.fn()} />,
    )
    const meta = container.querySelector('.comment-canvas-footer-meta')
    expect(meta).not.toBeNull()
    expect(meta!.querySelector('.comment-outdated-badge')).not.toBeNull()
    expect(meta!.querySelector('.comment-sev-badge-soft')).toBeNull()
  })

  it('renders the Resolve conversation button as a btn-sm inside the footer row', () => {
    const { container, getByRole } = render(
      <CommentBubble comment={comment()} onDelete={vi.fn()} />,
    )
    const resolve = getByRole('button', { name: 'Resolve conversation' })
    expect(resolve).toHaveClass('btn-sm')
    const row = container.querySelector('.comment-canvas-footer-row')
    expect(row).not.toBeNull()
    expect(row!.contains(resolve)).toBe(true)
  })
})