// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ResolveAllControl } from '../Toolbar'

describe('ResolveAllControl', () => {
  it('requires an in-app confirmation before resolving every thread', async () => {
    const user = userEvent.setup()
    const resolveAll = vi.fn().mockResolvedValue(undefined)
    render(<ResolveAllControl commentCount={15} onResolveAllOpen={resolveAll} />)

    await user.click(screen.getByRole('button', { name: 'Resolve all' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Resolve all 15 open comments?',
    })
    expect(dialog).toBeInTheDocument()
    expect(resolveAll).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Resolve all 15' }))
    await waitFor(() => expect(resolveAll).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('keeps the action untouched when the dialog is cancelled', async () => {
    const user = userEvent.setup()
    const resolveAll = vi.fn()
    render(<ResolveAllControl commentCount={2} onResolveAllOpen={resolveAll} />)

    await user.click(screen.getByRole('button', { name: 'Resolve all' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(resolveAll).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps a failed bulk action open and exposes its error', async () => {
    const user = userEvent.setup()
    const resolveAll = vi.fn().mockRejectedValue(new Error('Server unavailable'))
    render(<ResolveAllControl commentCount={4} onResolveAllOpen={resolveAll} />)

    await user.click(screen.getByRole('button', { name: 'Resolve all' }))
    await user.click(await screen.findByRole('button', { name: 'Resolve all 4' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
