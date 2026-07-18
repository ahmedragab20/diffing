// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ShortcutsHelpModal } from '../ShortcutsHelpModal'

// Stub lucide-react icons as no-op components so the jsdom env doesn't
// need the SVG engine. We cover every icon the modal references.
vi.mock('lucide-react', () => {
  const Stub = () => null
  const proxy: Record<string, unknown> = {}
  const keys = ['X', 'Keyboard', 'Navigation', 'Eye', 'MessageSquare', 'GitCommit']
  for (const k of keys) proxy[k] = Stub
  return proxy
})

describe('ShortcutsHelpModal', () => {
  beforeEach(() => {
    // Base UI's Dialog.Portal mounts into document.body — clear it
    // between tests so the rendered popups don't bleed across cases.
    document.body.innerHTML = ''
  })

  it('renders the dialog when open', () => {
    render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Developer Keyboard Shortcuts' })).toBeInTheDocument()
  })

  it('does not render anything when closed', () => {
    render(<ShortcutsHelpModal isOpen={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Developer Keyboard Shortcuts')).not.toBeInTheDocument()
  })

  it('invokes onClose when the X button is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutsHelpModal isOpen={true} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  describe('diff mode (default)', () => {
    it('still lists the surrounding scrolling shortcuts', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} />)

      // The new entries sit alongside the existing ones — make sure we
      // didn't accidentally regress the other scrolling bindings.
      expect(screen.getByText('Scroll Down slightly')).toBeInTheDocument()
      expect(screen.getByText('Scroll Up slightly')).toBeInTheDocument()
      expect(screen.getByText('Scroll Down half page')).toBeInTheDocument()
      expect(screen.getByText('Scroll Up half page')).toBeInTheDocument()
      expect(screen.getByText('Scroll to Top of diffs')).toBeInTheDocument()
      expect(screen.getByText('Scroll to Bottom of diffs')).toBeInTheDocument()
    })

    it('documents commit walk and corrected search palette bindings', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} />)

      expect(screen.getByText('Commit Walk')).toBeInTheDocument()
      expect(screen.getByText(/Next commit \(diffing show multi-commit\)/i)).toBeInTheDocument()
      expect(screen.getByText(/Previous commit \(diffing show multi-commit\)/i)).toBeInTheDocument()
      // g f opens all-scope palette (not Files); g v is Files.
      expect(screen.getAllByText(/Open Search Palette \(all scopes\)/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText(/Browse any file in the repo \(Files scope\)/i)).toBeInTheDocument()
      expect(screen.getByText(/Cycle Inline Diff Style \(word → word-alt → char → none\)/i)).toBeInTheDocument()
      expect(screen.getByText(/Collapse \/ expand the vim status bar/i)).toBeInTheDocument()
    })

    it('documents review history, filters, and suggest-change affordances', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} />)

      expect(screen.getByText(/open review history timeline/i)).toBeInTheDocument()
      expect(screen.getByText(/File-tree chips/i)).toBeInTheDocument()
      expect(screen.getByText(/Suggest change/i)).toBeInTheDocument()
      expect(screen.getByText(/deep permalink/i)).toBeInTheDocument()
    })
  })

  describe('plan mode', () => {
    it('uses a plan-specific title and scrolling entries', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} mode="plan" />)

      expect(
        screen.getByRole('heading', { level: 2, name: 'Plan Review Shortcuts' }),
      ).toBeInTheDocument()
      // In plan mode the gg / G entries point at the plan body, not at the diffs.
      expect(screen.getByText('Scroll to Top of plan')).toBeInTheDocument()
      expect(screen.getByText('Scroll to Bottom of plan')).toBeInTheDocument()
    })

    it('shows plan-specific plan navigation, not file navigation', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} mode="plan" />)

      // The plan navigation category replaces the file navigation one.
      expect(screen.getByText('Jump to Next Plan in list')).toBeInTheDocument()
      expect(screen.getByText('Jump to Previous Plan in list')).toBeInTheDocument()
      // File-navigation entries should NOT appear in plan mode.
      expect(screen.queryByText('Jump to Next File Diff')).not.toBeInTheDocument()
      expect(screen.queryByText('Jump to Previous File Diff')).not.toBeInTheDocument()
    })

    it('documents view mode cycle, split resize, and plan chrome actions', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} mode="plan" />)

      expect(screen.getByText(/Cycle view mode \(Source → Read → Split\)/i)).toBeInTheDocument()
      expect(screen.getByText(/drag the center divider/i)).toBeInTheDocument()
      expect(screen.getByText(/double-click divider to reset 50\/50/i)).toBeInTheDocument()
      expect(screen.getAllByText(/Open Keyboard Shortcuts Guide/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText(/Open Settings/i)).toBeInTheDocument()
      expect(screen.getByText(/copy link · copy markdown · open in editor/i)).toBeInTheDocument()
      expect(screen.getAllByText(/Toggle Comments map sidebar \(right rail\)/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Toggle Outline sidebar \(left TOC\)/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/Header: Outline \(o\) · Comments map \(c\)/i)).toBeInTheDocument()
    })
  })

})
