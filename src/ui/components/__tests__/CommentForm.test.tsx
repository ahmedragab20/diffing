// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../hooks/useHaptics', () => ({
  useFeedback: () => ({ haptic: vi.fn(), sound: vi.fn() }),
}))

const { mockUpdateSettings } = vi.hoisted(() => ({ mockUpdateSettings: vi.fn() }))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ settings: { savedReplies: [] }, updateSettings: mockUpdateSettings }),
}))

vi.mock('../drafts', () => ({
  getDraft: () => null,
  setDraft: vi.fn(),
  clearDraft: vi.fn(),
}))

vi.mock('./Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}))

import { CommentForm } from '../CommentForm'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [{ path: 'src/foo.ts' }] }),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('CommentForm — @-mention dropdown offset parent', () => {
  it('renders the dropdown in a positioning wrapper that excludes the suggest-row', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <CommentForm
          lineContent="const x = 1"
          showSeverity={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    )

    // The suggest-row (Saved replies / Save template / Suggest change) is always
    // present; its height mutates as the user types, which is what used to shove
    // the dropdown around before the fix.
    const suggestRow = document.querySelector('.comment-form-suggest-row')
    expect(suggestRow).not.toBeNull()

    // Type "@a" to open the file-mention dropdown.
    const textarea = screen.getByLabelText('Comment body') as HTMLTextAreaElement
    await user.type(textarea, '@a')

    // Dropdown renders with at least one option.
    const dropdown = (await screen
      .findByRole('listbox', { name: 'File suggestions' })
      .then((lb) => lb.closest('.mention-dropdown') as HTMLElement))!
    expect(dropdown).not.toBeNull()
    expect(dropdown.querySelectorAll('[role="option"]').length).toBeGreaterThan(0)

    // The dropdown's DOM parent must be the position:relative wrapper that holds
    // ONLY the textarea + dropdown — NOT the suggest-row. This is the structural
    // guarantee that decouples the dropdown's anchor from the toolbar reflow.
    const offsetWrapper = dropdown.parentElement as HTMLElement
    expect(getComputedStyle(offsetWrapper).position).toBe('relative')
    expect(offsetWrapper.contains(suggestRow)).toBe(false)
    expect(offsetWrapper.querySelector('textarea')).not.toBeNull()
  })
})