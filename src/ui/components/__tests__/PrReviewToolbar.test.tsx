// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('../../router', () => ({ navigate }))
vi.mock('../ReviewSettingsPopover', () => ({
  ReviewSettingsPopover: () => <button type="button">Settings</button>,
}))
vi.mock('../SubmitToGitHubPopover', () => ({
  SubmitToGitHubPopover: () => <button type="button">Submit to GitHub</button>,
}))

import { PrReviewToolbar } from '../PrReviewToolbar'

const session = {
  owner: 'octo',
  repo: 'project',
  pullNumber: 42,
  title: 'Unify the review experience',
  changedFiles: 3,
  additions: 21,
  deletions: 8,
  headSha: 'abcdef123456',
  headRefName: 'feature/widget',
  baseRefName: 'main',
  url: 'https://github.com/octo/project/pull/42',
} as any

describe('PrReviewToolbar', () => {
  beforeEach(() => navigate.mockReset())

  it('keeps the local toolbar language while exposing GitHub review actions', () => {
    render(
      <PrReviewToolbar
        session={session}
        comments={[]}
        settingsProps={{} as any}
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        onOpenSearch={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    )

    expect(screen.getByText('octo/project')).toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(screen.queryByText('Unify the review experience')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit to github/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/pull request summary/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/send to agent/i)).not.toBeInTheDocument()
  })

  it('routes back locally and refreshes explicitly', () => {
    const refresh = vi.fn()
    render(
      <PrReviewToolbar
        session={session}
        comments={[]}
        settingsProps={{} as any}
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        onOpenSearch={vi.fn()}
        onRefresh={refresh}
        refreshing={false}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /back to local review/i }))
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(navigate).toHaveBeenCalledWith('/')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('shows the head and base branch flow when both branch names are present', () => {
    render(
      <PrReviewToolbar
        session={session}
        comments={[]}
        settingsProps={{} as any}
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        onOpenSearch={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    )

    expect(screen.getByText('feature/widget')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByTitle('Comparing feature/widget into main')).toBeInTheDocument()
  })

  it('omits the branch flow when branch names are missing', () => {
    const sessionWithoutBranches = { ...session }
    delete sessionWithoutBranches.headRefName
    delete sessionWithoutBranches.baseRefName
    render(
      <PrReviewToolbar
        session={sessionWithoutBranches}
        comments={[]}
        settingsProps={{} as any}
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        onOpenSearch={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    )

    expect(screen.queryByText('feature/widget')).not.toBeInTheDocument()
    expect(screen.queryByTitle(/Comparing/)).not.toBeInTheDocument()
  })
})
