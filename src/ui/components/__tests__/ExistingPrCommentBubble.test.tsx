// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExistingPrCommentBubble } from '../ExistingPrCommentBubble'

const comment = {
  id: 101,
  author: { login: 'reviewer' },
  body: 'Original feedback',
  path: 'src/x.ts',
  line: 12,
  side: 'RIGHT',
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
  state: 'COMMENTED',
  replies: [],
  isOutdated: false,
  threadId: 'PRRT_thread',
  isResolved: false,
  viewerCanResolve: true,
  viewerCanUnresolve: true,
} as any

describe('ExistingPrCommentBubble GitHub actions', () => {
  it('resolves the GitHub thread and edits the published comment', async () => {
    const setResolved = vi.fn().mockResolvedValue(undefined)
    const edit = vi.fn().mockResolvedValue(undefined)
    render(<ExistingPrCommentBubble comment={comment} onSetResolved={setResolved} onEdit={edit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Resolve conversation' }))
    await waitFor(() => expect(setResolved).toHaveBeenCalledWith('PRRT_thread', true))

    fireEvent.click(screen.getByRole('button', { name: 'Edit GitHub comment' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit GitHub comment body' }), { target: { value: 'Updated feedback' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save on GitHub' }))
    await waitFor(() => expect(edit).toHaveBeenCalledWith(101, 'Updated feedback'))
  })

  it('reopens a resolved thread', async () => {
    const setResolved = vi.fn().mockResolvedValue(undefined)
    render(<ExistingPrCommentBubble comment={{ ...comment, isResolved: true }} onSetResolved={setResolved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reopen conversation' }))
    await waitFor(() => expect(setResolved).toHaveBeenCalledWith('PRRT_thread', false))
  })

  it('renders GitHub suggestion fences as a before/after preview', () => {
    render(
      <ExistingPrCommentBubble
        comment={{ ...comment, body: 'Use the newer action:\n\n```suggestion\nuses: actions/download-artifact@v8\n```' }}
        lineContent="uses: actions/download-artifact@v4"
      />,
    )

    expect(screen.getByText('Use the newer action:')).toBeInTheDocument()
    expect(screen.getByLabelText('Suggested change preview')).toBeInTheDocument()
    expect(screen.getByText('uses: actions/download-artifact@v4')).toBeInTheDocument()
    expect(screen.getByText('uses: actions/download-artifact@v8')).toBeInTheDocument()
    expect(screen.queryByText(/```suggestion/)).not.toBeInTheDocument()
  })
})
