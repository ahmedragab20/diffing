// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { PlanReview } from '../components/PlanReview.js'
import type { Plan } from '../../lib/plan-types.js'

// Stub the SSE bus and the worker pool used by @pierre/diffs (no-op in jsdom).
vi.mock('../live', () => ({
  subscribeLive: () => () => {},
}))

vi.mock('@pierre/diffs/react', () => ({
  useWorkerPool: () => ({}),
  File: () => <div data-testid="diffs-file-stub" />,
}))

// Stub all lucide icons (PlanReview + PlanCommentBubble + float composers).
vi.mock('lucide-react', () => {
  const Stub = () => null
  const names = [
    'Bot', 'FileText', 'Code2', 'MessageSquarePlus', 'Check', 'X',
    'MessageSquareWarning', 'Clock', 'History', 'ArrowLeft', 'ChevronsUpDown',
    'MessageSquare', 'Copy', 'Link2', 'FolderOpen', 'ListTree',
    'ExternalLink', 'Loader2', 'MessagesSquare', 'Maximize2', 'Minimize2',
    'Pencil', 'Trash2', 'CornerDownRight', 'CheckCircle2', 'Circle',
    'ChevronDown', 'ChevronRight', 'User', 'AlertTriangle', 'Reply',
    'MoreHorizontal', 'Send', 'Edit2', 'Edit3', 'GripVertical', 'Minus',
    // CommentForm severity select
    'AlertOctagon', 'CircleDot', 'HelpCircle', 'Sparkles',
  ]
  const mod: Record<string, unknown> = { __esModule: true }
  for (const n of names) mod[n] = Stub
  return mod
})

// Stub usePlans so we don't need a real network/cache plumbing.
const mockUsePlans = vi.fn()
vi.mock('../hooks/usePlans', () => ({
  usePlans: () => mockUsePlans(),
}))

// Replace the Base UI Select with a plain <select> so the version-switcher
// can be driven by a `change` event in tests, without trying to portal-mount
// the popup inside jsdom (Base UI's positioning logic needs layout APIs we
// don't have here).
vi.mock('../primitives/Select', () => ({
  Select: ({ value, onValueChange, options, ariaLabel }: any) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
}))

vi.mock('../primitives/Tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const basePlan: Plan = {
  id: 'p1',
  title: 'My Plan',
  body: '# v3 body',
  sourcePath: '/Users/me/.diffing/demo/plan-sources/p1.md',
  source: '/Users/me/proj/PLAN.md',
  createdAt: 1000,
  updatedAt: 3000,
  version: 3,
  decision: 'pending',
  comments: [],
  versions: [
    { version: 1, body: '# v1 body', title: 'My Plan v1', createdAt: 1000 },
    { version: 2, body: '# v2 body', title: 'My Plan v2', createdAt: 2000 },
    { version: 3, body: '# v3 body', title: 'My Plan', createdAt: 3000 },
  ],
}

const baseProps = {
  theme: 'nord',
  fontSize: 13,
  monoFontFamily: 'monospace',
  defaultTabSize: 2,
  lineWrap: true,
  showLineNumbers: true,
  lineHoverHighlight: 'line' as const,
  viewMode: 'source' as const,
}

describe('PlanReview version switcher', () => {
  beforeEach(() => {
    mockUsePlans.mockReset()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    mockUsePlans.mockReturnValue({
      addPlanComment: vi.fn(),
      editPlanComment: vi.fn(),
      resolvePlanComment: vi.fn(),
      unresolvePlanComment: vi.fn(),
      removePlanComment: vi.fn(),
      addPlanReply: vi.fn(),
      editPlanReply: vi.fn(),
      removePlanReply: vi.fn(),
      submitDecision: vi.fn(),
      submitting: false,
      agentWaiting: false,
    })
  })

  it('shows a single version chip when the plan has only one version', () => {
    render(<PlanReview plan={{ ...basePlan, version: 1, body: 'only', versions: [{ version: 1, body: 'only', title: 'My Plan', createdAt: 0 }] }} {...baseProps} />, { wrapper: createWrapper() })
    expect(screen.getByText('v1')).toBeInTheDocument()
    // No version dropdown when there's only one version
    expect(screen.queryByLabelText('Plan version')).not.toBeInTheDocument()
  })

  it('renders the version dropdown when more than one version exists', () => {
    render(<PlanReview plan={basePlan} {...baseProps} />, { wrapper: createWrapper() })
    // The dropdown trigger is the only element with aria-label "Plan version"
    expect(screen.getByLabelText('Plan version')).toBeInTheDocument()
  })

  it('shows the "viewing v{N} of v{M}" banner when an older version is selected', async () => {
    render(<PlanReview plan={basePlan} {...baseProps} />, { wrapper: createWrapper() })

    // The Select primitive is mocked above as a native <select>, so we can
    // change the value directly and trigger the change event to fire the
    // PlanReview's onValueChange handler.
    const select = screen.getByLabelText('Plan version') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '1' } })

    await waitFor(() => {
      expect(screen.getByText(/Viewing/i)).toBeInTheDocument()
      expect(screen.getByText(/current is/i)).toBeInTheDocument()
    })
  })

  it('shows plan comments inline in Read mode and filters by historical version', async () => {
    const plan: Plan = {
      ...basePlan,
      comments: [
        { id: 'c1', lineNumber: 1, lineContent: 'x', body: 'old feedback', status: 'open', createdAt: 0, createdAtPlanVersion: 1, replies: [] },
        { id: 'c2', lineNumber: 1, lineContent: 'x', body: 'new feedback', status: 'open', createdAt: 0, createdAtPlanVersion: 3, replies: [] },
      ],
    }
    render(<PlanReview plan={plan} {...baseProps} viewMode="rendered" />, { wrapper: createWrapper() })
    // Current version: both threads appear (inline + rail).
    await waitFor(() => {
      expect(screen.getAllByText('new feedback').length).toBeGreaterThan(0)
      expect(screen.getAllByText('old feedback').length).toBeGreaterThan(0)
    })
    // Historical version: only comments anchored to that version.
    const select = screen.getByLabelText('Plan version') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '1' } })
    await waitFor(() => {
      expect(screen.getAllByText('old feedback').length).toBeGreaterThan(0)
      expect(screen.queryByText('new feedback')).not.toBeInTheDocument()
    })
  })

  it('exposes Copy path controls that write the absolute sourcePath', async () => {
    render(<PlanReview plan={basePlan} {...baseProps} />, { wrapper: createWrapper() })
    const buttons = screen.getAllByRole('button', { name: /copy plan source path/i })
    expect(buttons.length).toBeGreaterThan(0)
    fireEvent.click(buttons[0])
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '/Users/me/.diffing/demo/plan-sources/p1.md',
      )
    })
  })
})
