// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mocks ──

vi.mock('lucide-react', () => ({
  Bot: () => <svg data-testid="lucide-bot" />,
  Pencil: () => <svg data-testid="lucide-pencil" />,
  Trash2: () => <svg data-testid="lucide-trash2" />,
  Check: () => <svg data-testid="lucide-check" />,
  X: () => <svg data-testid="lucide-x" />,
  MessageSquareWarning: () => <svg data-testid="lucide-msg-warn" />,
  MessageSquare: () => <svg data-testid="lucide-msg" />,
  GitPullRequest: () => <svg data-testid="lucide-git-pr" />,
  ClipboardCheck: () => <svg data-testid="lucide-clipboard" />,
  RefreshCw: () => <svg data-testid="lucide-refresh" />,
  AlertCircle: () => <svg data-testid="lucide-alert" />,
  AlertTriangle: () => <svg data-testid="lucide-alert-triangle" />,
  Loader2: () => <svg data-testid="lucide-loader" />,
  ShieldAlert: () => <svg data-testid="lucide-shield-alert" />,
  ExternalLink: () => <svg data-testid="lucide-external" />,
  FilePenLine: () => <svg data-testid="lucide-file-pen" />,
}))

vi.mock('../../hooks/useHaptics', () => ({
  useFeedback: () => ({ haptic: vi.fn(), sound: vi.fn() }),
}))

const mockUiStateGet = vi.fn()
const mockUiStateSet = vi.fn()
vi.mock('../../utils/uiState', () => ({
  getUiStateItem: (...args: any[]) => mockUiStateGet(...args),
  setUiStateItem: (...args: any[]) => mockUiStateSet(...args),
}))

// MarkdownField uses a tabs pattern that may not render well in JSDOM
vi.mock('../MarkdownField', () => ({
  MarkdownField: ({ value, onChange, placeholder, ariaLabel }: any) => (
    <textarea
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid="markdown-field"
    />
  ),
}))

// ── Imports (after mocks) ──
import { SendReviewModal } from '../SendReviewModal'

const noop = async () => {}

function renderModal(overrides: Partial<React.ComponentProps<typeof SendReviewModal>> = {}) {
  return render(
    <SendReviewModal
      open
      onClose={vi.fn()}
      comments={[]}
      totalFileCount={3}
      viewedFileCount={3}
      requireViewAllBeforeSend={false}
      onEditComment={noop as any}
      onDeleteComment={noop as any}
      onSend={noop as any}
      sending={false}
      agentWaiting={false}
      waitingAgents={[]}
      onCopyComments={noop as any}
      onCopyMarkdown={noop as any}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  mockUiStateGet.mockReset()
  mockUiStateSet.mockReset()
  mockUiStateGet.mockReturnValue(null)
  // Base UI's Dialog.Portal mounts into document.body — clear it between
  // tests so the rendered popups don't bleed across cases.
  document.body.innerHTML = ''
})

describe('SendReviewModal', () => {
  it('renders the four verdict options', () => {
    renderModal()
    const verdicts = screen.getByRole('radiogroup', { name: /verdict/i })
    expect(verdicts).toBeInTheDocument()
    const radios = within(verdicts).getAllByRole('radio')
    expect(radios).toHaveLength(4)
    expect(within(verdicts).getByRole('radio', { name: /Approve/ })).toBeInTheDocument()
    expect(within(verdicts).getByRole('radio', { name: /Request edits/ })).toBeInTheDocument()
    expect(within(verdicts).getByRole('radio', { name: /Reject/ })).toBeInTheDocument()
    expect(within(verdicts).getByRole('radio', { name: /Comment only/ })).toBeInTheDocument()
  })

  it('renders the bottom and corner resize handles but no left handle', () => {
    renderModal()
    expect(
      screen.getByRole('separator', { name: /^Resize submit panel$/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('separator', { name: 'Resize submit panel width and height' }),
    ).toBeInTheDocument()
    // The centered dialog has no left width handle (that one stays in the popover).
    expect(
      screen.queryByRole('separator', { name: 'Resize submit panel width' }),
    ).not.toBeInTheDocument()
  })

  it('renders the four panel size presets', () => {
    renderModal()
    expect(screen.getByRole('group', { name: /panel size/i })).toBeInTheDocument()
    const presets = screen.getAllByRole('radio', { name: /S|M|L|XL/ })
    expect(presets).toHaveLength(4)
  })

  it('closes when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lists the inline comments that will be handed off', () => {
    const { rerender } = renderModal()
    rerender(
      <SendReviewModal
        open
        onClose={vi.fn()}
        comments={[
          {
            id: 'c1',
            filePath: 'src/example.ts',
            side: 'additions',
            lineNumber: 12,
            lineContent: 'const answer = 42',
            body: 'Please explain this value.',
            status: 'open',
            createdAt: 1,
            replies: [],
          },
        ]}
        totalFileCount={3}
        viewedFileCount={3}
        requireViewAllBeforeSend={false}
        onEditComment={noop as any}
        onDeleteComment={noop as any}
        onSend={noop as any}
        sending={false}
        agentWaiting={false}
        waitingAgents={[]}
        onCopyComments={noop as any}
        onCopyMarkdown={noop as any}
      />,
    )
    expect(screen.getByText('Please explain this value.')).toBeInTheDocument()
  })

  // The SendReviewModal wires the Approve verdict button into Modal's
  // initialFocus (via SendReviewPanel.initialFocusRef) so opening the dialog
  // lands keyboard focus on the first verdict instead of the S/M/L presets.
  it('focuses the Approve verdict on open', async () => {
    renderModal()
    const approve = screen.getByRole('radio', { name: /Approve/ })
    // Base UI's Dialog.Popup applies initialFocus after mount/transition, so
    // wait for the focus to land rather than asserting synchronously.
    await waitFor(() => expect(approve).toHaveFocus())
  })
})
