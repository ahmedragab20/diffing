// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { MockupComment } from '../../../lib/mockup-types'
import { MockupThread } from '../MockupThread'

vi.mock('lucide-react', () => ({
  AlertTriangle: () => <svg data-testid="lucide-alert" />,
  Bot: () => <svg data-testid="lucide-bot" />,
  CheckCircle2: () => <svg data-testid="lucide-check-circle" />,
  ChevronDown: () => <svg data-testid="lucide-chevron-down" />,
  ChevronRight: () => <svg data-testid="lucide-chevron-right" />,
  Pencil: () => <svg data-testid="lucide-pencil" />,
  Reply: () => <svg data-testid="lucide-reply" />,
  Trash2: () => <svg data-testid="lucide-trash" />,
  User: () => <svg data-testid="lucide-user" />,
}))

vi.mock('../Markdown', () => ({
  Markdown: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}))

vi.mock('../CommentForm', () => ({
  CommentForm: ({ initialBody = '', onSubmit, onCancel }: any) => {
    const [value, setValue] = useState(initialBody)
    return (
      <div data-testid="mockup-comment-form">
        <textarea
          aria-label="Comment body"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button onClick={() => onSubmit(value)}>Submit</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    )
  },
}))

vi.mock('../../utils', () => ({ timeAgo: () => 'just now' }))

function comment(overrides: Partial<MockupComment> = {}): MockupComment {
  return {
    id: 'c1',
    screenId: 'main',
    kind: 'block',
    selector: 'button.pay',
    body: 'The hero button is too wide',
    status: 'open',
    createdAt: 0,
    createdAtMockupVersion: 2,
    replies: [],
    ...overrides,
  }
}

function noop() {}

function renderThread(
  c: MockupComment,
  overrides: Partial<Record<string, any>> = {},
) {
  return render(
    <MockupThread
      index={1}
      comment={c}
      onClose={noop}
      onResolve={noop}
      onUnresolve={noop}
      onDelete={noop}
      onEdit={noop}
      onReply={noop}
      onEditReply={noop}
      onDeleteReply={noop}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('MockupThread', () => {
  it('renders the open comment body with a reply trigger', () => {
    renderThread(comment())
    expect(screen.getByText('The hero button is too wide')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reply...' })).toBeInTheDocument()
  })

  it('posts a reply through the composer', () => {
    const onReply = vi.fn()
    renderThread(comment(), { onReply })
    fireEvent.click(screen.getByRole('button', { name: 'Reply...' }))
    fireEvent.change(screen.getByLabelText('Comment body'), {
      target: { value: 'fixed in next revision' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onReply).toHaveBeenCalledWith('fixed in next revision')
  })

  it('resolves an open thread', () => {
    const onResolve = vi.fn()
    renderThread(comment(), { onResolve })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(onResolve).toHaveBeenCalled()
  })

  it('resolved threads collapse and can be expanded and unresolved', () => {
    const onUnresolve = vi.fn()
    renderThread(comment({ status: 'resolved' }), { onUnresolve })
    expect(screen.getByText('Resolved')).toBeInTheDocument()
    expect(screen.getByLabelText('Expand comment thread')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Expand comment thread'))
    expect(
      screen.getByRole('button', { name: 'Unresolve' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unresolve' }))
    expect(onUnresolve).toHaveBeenCalled()
  })

  it('edits the comment body through the composer', () => {
    const onEdit = vi.fn()
    renderThread(comment(), { onEdit })
    fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }))
    const body = screen.getByLabelText('Comment body')
    expect(body).toHaveValue('The hero button is too wide')
    fireEvent.change(body, { target: { value: 'shorter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onEdit).toHaveBeenCalledWith('shorter')
  })

  it('deletes a comment only after confirmation', () => {
    const onDelete = vi.fn()
    renderThread(comment(), { onDelete })
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm delete comment' }),
    )
    expect(onDelete).toHaveBeenCalled()
  })

  it('edits and deletes replies, with agent model chips', () => {
    const onEditReply = vi.fn()
    const onDeleteReply = vi.fn()
    renderThread(
      comment({
        replies: [
          {
            id: 'r1',
            body: 'old reply',
            createdAt: 0,
            role: 'agent',
            model: 'opus',
          },
        ],
      }),
      { onEditReply, onDeleteReply },
    )
    expect(screen.getByText('old reply')).toBeInTheDocument()
    expect(screen.getByText('opus')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit reply' }))
    fireEvent.change(screen.getByLabelText('Comment body'), {
      target: { value: 'new reply' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onEditReply).toHaveBeenCalledWith('r1', 'new reply')

    fireEvent.click(screen.getByRole('button', { name: 'Delete reply' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm delete reply' }),
    )
    expect(onDeleteReply).toHaveBeenCalledWith('r1')
  })
})
