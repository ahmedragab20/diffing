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

  it('confirms deletion in the app before removing a published comment', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    render(<ExistingPrCommentBubble comment={comment} onDelete={remove} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete GitHub comment' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Delete published GitHub comment?' }),
    ).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(101))
  })

  it('confirms deletion in the app before removing a published reply', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    render(
      <ExistingPrCommentBubble
        comment={{
          ...comment,
          replies: [
            {
              id: 202,
              body: 'Published reply',
              createdAt: '2026-07-18T10:01:00.000Z',
              author: { login: 'reviewer' },
              viewerDidAuthor: true,
            },
          ],
        }}
        onDelete={remove}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 reply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete GitHub reply' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Delete published GitHub reply?' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete reply' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(202))
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

  it('proxies Enterprise GitHub avatar URLs and keeps the login alt text', () => {
    const avatarUrl = 'https://github.enterprise.example/avatar/u/42?size=64&format=png'
    const { container } = render(
      <ExistingPrCommentBubble
        comment={{ ...comment, author: { login: 'enterprise-reviewer', avatarUrl } }}
      />,
    )

    const avatar = container.querySelector('img.pr-existing-avatar')
    expect(avatar).toHaveAttribute('src', `/api/gh/avatar?url=${encodeURIComponent(avatarUrl)}`)
    expect(avatar).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(avatar).toHaveAttribute('alt', 'enterprise-reviewer')
  })

  it('renders a fallback when the author has no avatar URL', () => {
    const { container } = render(
      <ExistingPrCommentBubble comment={{ ...comment, author: { login: 'reviewer' } }} />,
    )

    expect(container.querySelector('img.pr-existing-avatar')).not.toBeInTheDocument()
    expect(container.querySelector('.pr-existing-avatar-fallback')).toBeInTheDocument()
  })

  it('renders a fallback when the comment has no author', () => {
    const { container } = render(<ExistingPrCommentBubble comment={{ ...comment, author: null }} />)

    expect(container.querySelector('img.pr-existing-avatar')).not.toBeInTheDocument()
    expect(container.querySelector('.pr-existing-avatar-fallback')).toBeInTheDocument()
  })

  it('replaces a broken avatar image with a fallback', () => {
    const avatarUrl = 'https://avatars.githubusercontent.com/u/42?v=4'
    const { container } = render(
      <ExistingPrCommentBubble
        comment={{ ...comment, author: { login: 'reviewer', avatarUrl } }}
      />,
    )

    fireEvent.error(container.querySelector('img.pr-existing-avatar')!)

    expect(container.querySelector('img.pr-existing-avatar')).not.toBeInTheDocument()
    expect(container.querySelector('.pr-existing-avatar-fallback')).toBeInTheDocument()
  })

  it('shows a changed avatar URL after the previous avatar failed', () => {
    const firstAvatarUrl = 'https://avatars.githubusercontent.com/u/42?v=4'
    const nextAvatarUrl = 'https://github.enterprise.example/avatar/u/99?size=64'
    const { container, rerender } = render(
      <ExistingPrCommentBubble
        comment={{ ...comment, author: { login: 'reviewer', avatarUrl: firstAvatarUrl } }}
      />,
    )

    fireEvent.error(container.querySelector('img.pr-existing-avatar')!)
    rerender(
      <ExistingPrCommentBubble
        comment={{ ...comment, author: { login: 'reviewer', avatarUrl: nextAvatarUrl } }}
      />,
    )

    const avatar = container.querySelector('img.pr-existing-avatar')
    expect(avatar).toHaveAttribute('src', `/api/gh/avatar?url=${encodeURIComponent(nextAvatarUrl)}`)
    expect(avatar).toHaveAttribute('alt', 'reviewer')
  })
})
