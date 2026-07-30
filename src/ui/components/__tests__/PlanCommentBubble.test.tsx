// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PlanComment } from '../../../lib/plan-types'
import { PlanCommentBubble } from '../PlanCommentBubble'

const unbroken = 'review-surface-'.repeat(40)

function comment(overrides: Partial<PlanComment> = {}): PlanComment {
  return {
    id: 'plan-comment-1',
    lineNumber: 38,
    startLineNumber: 36,
    lineContent: `const ${unbroken} = true`,
    selectedQuote: `Selection ${unbroken}`,
    sectionTitle: 'Geometry and containment',
    severity: 'blocking',
    body: `Prose must remain readable ${unbroken}\n\n[Long link](https://example.com/${unbroken}) and \`${unbroken}\`.\n\n\`\`\`ts\nconst path = '${unbroken}'\n\`\`\``,
    status: 'open',
    createdAt: Date.now(),
    createdAtPlanVersion: 2,
    replies: [
      {
        id: 'reply-agent',
        body: `Agent reply ${unbroken}`,
        createdAt: Date.now(),
        role: 'agent',
        model: 'Codex',
      },
      {
        id: 'reply-user',
        body: `User reply ${unbroken}`,
        createdAt: Date.now(),
        role: 'user',
      },
    ],
    ...overrides,
  }
}

const callbacks = {
  onResolve: vi.fn(),
  onUnresolve: vi.fn(),
  onDelete: vi.fn(),
  onEdit: vi.fn(),
  onReply: vi.fn(),
  onEditReply: vi.fn(),
  onDeleteReply: vi.fn(),
}

describe('PlanCommentBubble content states', () => {
  it('keeps long prose, links, inline code, fenced code, context, and replies in the card DOM', () => {
    const { container } = render(<PlanCommentBubble comment={comment()} {...callbacks} />)

    const card = screen.getByRole('article')
    expect(card).toHaveClass('comment-bubble-canvas')
    expect(card).toHaveTextContent('Prose must remain readable')
    expect(card).toHaveTextContent('Agent reply')
    expect(card).toHaveTextContent('User reply')
    expect(screen.getByRole('link', { name: 'Long link' })).toHaveAttribute(
      'href',
      expect.stringContaining('https://example.com/'),
    )
    expect(container.querySelectorAll('.comment-node-body')).toHaveLength(3)
    expect(container.querySelector('.comment-node-body .md-code-block pre')).toBeInTheDocument()
    expect(container.querySelector('.plan-comment-source')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('uses an intentionally truncated collapsed preview and restores the complete thread', () => {
    render(
      <PlanCommentBubble
        comment={comment({ selectedQuote: undefined, lineContent: '' })}
        {...callbacks}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse comment thread' }))
    const collapsed = screen.getByRole('article')
    expect(collapsed).toHaveClass('comment-collapsed-bar')
    expect(collapsed.querySelector('.comment-collapsed-preview')).toHaveAttribute(
      'title',
      expect.stringContaining(unbroken),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand comment thread' }))
    expect(screen.getByRole('article')).toHaveClass('comment-bubble-canvas')
    expect(screen.getByRole('article')).toHaveTextContent('Prose must remain readable')
  })

  it('starts resolved conversations collapsed without discarding their content', () => {
    render(<PlanCommentBubble comment={comment({ status: 'resolved' })} {...callbacks} />)

    expect(screen.getByRole('article')).toHaveClass('comment-collapsed-bar-resolved')
    fireEvent.click(screen.getByRole('button', { name: 'Expand comment thread' }))
    expect(screen.getByRole('article')).toHaveTextContent('Prose must remain readable')
    expect(screen.getByRole('button', { name: 'Unresolve' })).toBeInTheDocument()
  })
})
