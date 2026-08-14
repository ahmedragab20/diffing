// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { MockupSummary } from '../../../lib/mockup-types'
import { MockupList } from '../MockupList'

vi.mock('lucide-react', () => ({
  Check: () => <svg />,
  X: () => <svg />,
  MessageSquareWarning: () => <svg />,
  MessageSquare: () => <svg />,
  Clock: () => <svg />,
  Trash2: () => <svg />,
  Search: () => <svg />,
  PanelLeftClose: () => <svg />,
  PanelLeftOpen: () => <svg />,
  AlertTriangle: () => <svg />,
  Loader2: () => <svg />,
}))

vi.mock('../../primitives/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}))

vi.mock('../../utils', () => ({ timeAgo: () => '2h ago' }))

function summary(overrides: Partial<MockupSummary> = {}): MockupSummary {
  return {
    id: 'm1',
    title: 'Landing hero',
    screens: [{ id: 'main', label: 'Main' }],
    createdAt: 0,
    updatedAt: 0,
    version: 2,
    decision: 'pending',
    versionCount: 2,
    commentCounts: { total: 3, open: 2, resolved: 1 },
    ...overrides,
  }
}

const summaries: MockupSummary[] = [
  summary({
    id: 'm1',
    title: 'Landing hero',
    decision: 'pending',
    commentCounts: { total: 3, open: 2, resolved: 1 },
  }),
  summary({
    id: 'm2',
    title: 'Checkout flow',
    screens: [
      { id: 'main', label: 'Main' },
      { id: 'checkout', label: 'Checkout' },
    ],
    decision: 'approved',
    model: 'opus',
    commentCounts: { total: 0, open: 0, resolved: 0 },
  }),
]

function renderList(
  overrides: Partial<React.ComponentProps<typeof MockupList>> = {},
) {
  return render(
    <MockupList
      mockups={summaries}
      activeId={null}
      collapsed={false}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('MockupList', () => {
  it('renders compact summaries with counts and model', () => {
    renderList()
    expect(screen.getByText('Landing hero')).toBeInTheDocument()
    expect(screen.getByText('1 screen · 2 open · 2h ago')).toBeInTheDocument()
    expect(screen.getByText('Checkout flow')).toBeInTheDocument()
    expect(screen.getByText('2 screens · opus · 2h ago')).toBeInTheDocument()
  })

  it('selects a mockup', () => {
    const onSelect = vi.fn()
    renderList({ onSelect })
    fireEvent.click(screen.getByText('Landing hero'))
    expect(onSelect).toHaveBeenCalledWith('m1')
  })

  it('filters by decision chips', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }))
    expect(screen.getByText('Checkout flow')).toBeInTheDocument()
    expect(screen.queryByText('Landing hero')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Landing hero')).toBeInTheDocument()
  })

  it('shows the pending count on the pending chip', () => {
    renderList()
    expect(
      screen.getByRole('button', { name: 'Pending 1' }),
    ).toBeInTheDocument()
  })

  it('searches titles and model', () => {
    renderList()
    fireEvent.change(screen.getByLabelText('Search mockups'), {
      target: { value: 'opus' },
    })
    expect(screen.getByText('Checkout flow')).toBeInTheDocument()
    expect(screen.queryByText('Landing hero')).not.toBeInTheDocument()
  })

  it('deletes only after the confirmation dialog', () => {
    const onDelete = vi.fn()
    renderList({ onDelete })
    fireEvent.click(screen.getAllByLabelText('Delete mockup')[0])
    expect(onDelete).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: 'Delete mockup?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('m1')
  })

  it('collapses to just the expand toggle', () => {
    const onToggle = vi.fn()
    renderList({ collapsed: true, onToggle })
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(onToggle).toHaveBeenCalled()
    expect(screen.queryByText('Landing hero')).not.toBeInTheDocument()
  })
})
