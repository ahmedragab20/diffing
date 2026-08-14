// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SUBMIT_PANEL_SIZE_KEY, SUBMIT_PANEL_WIDTH_KEY } from '../../hooks/useSubmitPanelSize'

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

vi.mock('@base-ui-components/react/popover', () => ({
  Popover: {
    Root: ({ children }: any) => {
      return <div data-testid="popover-root">{children}</div>
    },
    Trigger: ({ render }: any) => <div data-testid="popover-trigger">{render}</div>,
    Portal: ({ children }: any) => <>{children}</>,
    Positioner: ({ children }: any) => <>{children}</>,
    Popup: ({ children, className }: any) => <div className={className} data-testid="popover-popup">{children}</div>,
    Close: ({ children }: any) => <button>{children}</button>,
  },
}))

const { mockSubmitReview } = vi.hoisted(() => ({ mockSubmitReview: vi.fn() }))

// SubmitToGitHubPopover needs useSubmitPrReview
vi.mock('../../hooks/usePrSession', () => ({
  useSubmitPrReview: () => ({ mutateAsync: mockSubmitReview, isPending: false, error: null }),
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

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// ── Imports (after mocks) ──
import { SendReviewPopover } from '../SendReviewPopover'
import { SubmitPlanReviewPopover } from '../SubmitPlanReviewPopover'
import { SubmitToGitHubPopover } from '../SubmitToGitHubPopover'

const noop = async () => {}

function renderSend(
  open = true,
  overrides: Partial<React.ComponentProps<typeof SendReviewPopover>> = {},
) {
  return render(
    <SendReviewPopover
      comments={[]}
      totalFileCount={0}
      viewedFileCount={0}
      requireViewAllBeforeSend={false}
      onEditComment={noop as any}
      onDeleteComment={noop as any}
      onSend={noop as any}
      sending={false}
      agentWaiting={false}
      {...overrides}
    />
  )
}

function renderPlan(open = true) {
  return render(
    <SubmitPlanReviewPopover
      openCommentCount={0}
      onSubmit={noop as any}
      submitting={false}
      agentWaiting={false}
      currentDecision="pending"
    />
  )
}

function renderMockup(
  overrides: Partial<React.ComponentProps<typeof SubmitPlanReviewPopover>> = {},
) {
  return render(
    <SubmitPlanReviewPopover
      kind="mockup"
      openCommentCount={0}
      onSubmit={noop as any}
      submitting={false}
      agentWaiting={false}
      currentDecision="pending"
      {...overrides}
    />
  )
}

function renderGitHub(open = true, comments: any[] = [], onSubmitted?: (result: any) => void) {
  return render(
    <Wrapper>
      <SubmitToGitHubPopover
        session={{ submittedAt: null } as any}
        comments={comments}
        onEditComment={noop as any}
        onDeleteComment={noop as any}
        onSubmitted={onSubmitted}
      />
    </Wrapper>
  )
}

beforeEach(() => {
  mockUiStateGet.mockReset()
  mockUiStateSet.mockReset()
  mockUiStateGet.mockReturnValue(null)
  mockSubmitReview.mockReset()
  mockSubmitReview.mockResolvedValue({ ok: true, reviewId: 9, reviewUrl: 'https://github.test/review/9', authSource: 'gh' })
})

describe('SendReviewPopover', () => {
  it('renders verdict options', () => {
    renderSend()
    expect(screen.getByRole('radiogroup', { name: /verdict/i })).toBeInTheDocument()
  })

  it('renders resize handle', () => {
    renderSend()
    expect(screen.getByRole('separator', { name: /^resize submit panel$/i })).toBeInTheDocument()
  })

  it('renders left width resize handle', () => {
    renderSend()
    const handle = screen.getByRole('separator', { name: 'Resize submit panel width' })
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('renders corner bidirectional resize handle', () => {
    renderSend()
    expect(
      screen.getByRole('separator', { name: 'Resize submit panel width and height' }),
    ).toBeInTheDocument()
  })

  it('renders size presets', () => {
    renderSend()
    expect(screen.getByRole('group', { name: /panel size/i })).toBeInTheDocument()
    const buttons = screen.getAllByRole('radio', { name: /S|M|L|XL/ })
    expect(buttons).toHaveLength(4)
  })

  it('supports controlled mode: open=true renders the panel and Cancel reports close', async () => {
    const onOpenChange = vi.fn()
    renderSend(true, { open: true, onOpenChange })

    // The panel content is visible while controlled-open.
    expect(screen.getByRole('radiogroup', { name: /verdict/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Send review$/ })).toBeInTheDocument()

    // The internal Cancel handler routes through onOpenChange so the App can
    // sync its own ⌘Enter state back to closed.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('uses an in-app dialog before sending with unviewed files', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(undefined)
    renderSend(true, {
      totalFileCount: 3,
      viewedFileCount: 1,
      requireViewAllBeforeSend: true,
      onSend,
    })

    await user.click(screen.getByRole('radio', { name: /Approve/ }))
    await user.click(screen.getByRole('button', { name: /^Send review$/ }))

    expect(
      await screen.findByRole('alertdialog', { name: 'Send with 2 unviewed files?' }),
    ).toBeInTheDocument()
    expect(onSend).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Send anyway' }))
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('approved', '', 'standard', true),
    )
  })
})

describe('SubmitPlanReviewPopover', () => {
  it('renders verdict options', () => {
    renderPlan()
    expect(screen.getByRole('radiogroup', { name: /verdict/i })).toBeInTheDocument()
  })

  it('renders resize handle', () => {
    renderPlan()
    expect(screen.getByRole('separator', { name: /^resize submit panel$/i })).toBeInTheDocument()
  })

  it('renders left width resize handle', () => {
    renderPlan()
    const handle = screen.getByRole('separator', { name: 'Resize submit panel width' })
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('renders corner bidirectional resize handle', () => {
    renderPlan()
    expect(
      screen.getByRole('separator', { name: 'Resize submit panel width and height' }),
    ).toBeInTheDocument()
  })

  it('renders size presets', () => {
    renderPlan()
    expect(screen.getByRole('group', { name: /panel size/i })).toBeInTheDocument()
  })

  it('clicking preset calls setUiStateItem', async () => {
    renderPlan()
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('radio', { name: /[SML]/ })
    await user.click(buttons[0]!)
    expect(mockUiStateSet).toHaveBeenCalledWith(SUBMIT_PANEL_SIZE_KEY, '340')
    expect(mockUiStateSet).toHaveBeenCalledWith(SUBMIT_PANEL_WIDTH_KEY, '420')
  })

  it('renders XL preset', () => {
    renderPlan()
    const buttons = screen.getAllByRole('radio', { name: /S|M|L|XL/ })
    expect(buttons).toHaveLength(4)
    expect(buttons[3]).toHaveAccessibleName(/XL/i)
  })

  it('clicking XL preset persists 760', async () => {
    renderPlan()
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('radio', { name: /S|M|L|XL/ })
    await user.click(buttons[3])
    expect(mockUiStateSet).toHaveBeenCalledWith(SUBMIT_PANEL_SIZE_KEY, '760')
    expect(mockUiStateSet).toHaveBeenCalledWith(SUBMIT_PANEL_WIDTH_KEY, '640')
  })
})

describe('SubmitPlanReviewPopover mockup mode', () => {
  it('titles the panel “Submit mockup review”', () => {
    renderMockup()
    expect(screen.getByText('Submit mockup review')).toBeInTheDocument()
  })

  it('words the verdict descriptions with the mockup noun', () => {
    renderMockup()
    expect(
      screen.getByText('The mockup looks good — the agent should proceed.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The agent should revise the mockup and resubmit it.'),
    ).toBeInTheDocument()
  })

  it('reports scoped vs total open counts when scopedOpenCount is provided', () => {
    renderMockup({ openCommentCount: 5, scopedOpenCount: 2 })
    expect(screen.getByText('2 open in view · 5 open total')).toBeInTheDocument()
  })

  it('falls back to the plural comment count without a scoped count', () => {
    renderMockup({ openCommentCount: 3 })
    expect(screen.getByText('3 open comments')).toBeInTheDocument()
  })

  it('omits the count entirely when there are no open comments', () => {
    renderMockup({ openCommentCount: 0, scopedOpenCount: 0 })
    expect(screen.queryByText(/open in view/)).not.toBeInTheDocument()
    expect(screen.queryByText(/open comments/)).not.toBeInTheDocument()
  })

  it('labels an already-decided mockup as an update', () => {
    renderMockup({ currentDecision: 'approved' })
    expect(screen.getByText('Update mockup review')).toBeInTheDocument()
  })
})

describe('SubmitToGitHubPopover', () => {
  it('renders verdict options', () => {
    renderGitHub()
    expect(screen.getByRole('radiogroup', { name: /verdict/i })).toBeInTheDocument()
  })

  it('renders resize handle', () => {
    renderGitHub()
    expect(screen.getByRole('separator', { name: /^resize submit panel$/i })).toBeInTheDocument()
  })

  it('renders left width resize handle', () => {
    renderGitHub()
    const handle = screen.getByRole('separator', { name: 'Resize submit panel width' })
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('renders corner bidirectional resize handle', () => {
    renderGitHub()
    expect(
      screen.getByRole('separator', { name: 'Resize submit panel width and height' }),
    ).toBeInTheDocument()
  })

  it('renders size presets', () => {
    renderGitHub()
    expect(screen.getByRole('group', { name: /panel size/i })).toBeInTheDocument()
  })

  it('uses submit-to-github-popover class', () => {
    renderGitHub()
    // The popover mock renders the Popup with className
    const popup = screen.getByTestId('popover-popup')
    expect(popup.className).toContain('submit-to-github-popover')
  })

  it('labels and renders the inline comments that will be published', () => {
    renderGitHub(true, [{
      id: 'c1',
      filePath: 'src/example.ts',
      side: 'additions',
      lineNumber: 12,
      lineContent: 'const answer = 42',
      body: 'Please explain this value.',
      status: 'open',
      createdAt: 1,
      replies: [],
    }])

    expect(screen.getByText('Inline comments to publish')).toBeInTheDocument()
    expect(screen.getByText('Please explain this value.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Comments to send' })).toBeInTheDocument()
  })

  it('emits a page-lifetime success event after submission', async () => {
    const onSubmitted = vi.fn()
    renderGitHub(true, [], onSubmitted)
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /^ApproveThe PR is good/i }))
    await user.click(screen.getByRole('button', { name: 'Submit review' }))
    expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 9, authSource: 'gh' }))
  })
})
