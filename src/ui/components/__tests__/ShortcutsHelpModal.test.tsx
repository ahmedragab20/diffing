// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ShortcutsHelpModal } from '../ShortcutsHelpModal'

// Stub lucide-react icons as no-op components so the jsdom env doesn't
// need the SVG engine. We cover every icon the modal references.
vi.mock('lucide-react', () => {
  const Stub = () => null
  const proxy: Record<string, unknown> = {}
  const keys = ['X', 'Keyboard', 'Navigation', 'Eye', 'MessageSquare']
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
    it('lists the new Ctrl+O and Ctrl+I jump-list shortcuts', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} />)

      expect(screen.getByText('Jump Back in scroll history')).toBeInTheDocument()
      expect(screen.getByText('Jump Forward in scroll history')).toBeInTheDocument()
    })

    it('renders the Ctrl+O binding as a separate kbd element', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} />)

      const row = screen.getByText('Jump Back in scroll history').closest('.shortcuts-row') as HTMLElement
      expect(row).not.toBeNull()
      const kbdLabels = Array.from(row.querySelectorAll('kbd.vim-kbd'))
        .map(el => el.textContent?.trim() ?? '')
      expect(kbdLabels).toEqual(['Ctrl', 'o'])
    })

    it('renders the Ctrl+I binding as a separate kbd element', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} />)

      const row = screen.getByText('Jump Forward in scroll history').closest('.shortcuts-row') as HTMLElement
      expect(row).not.toBeNull()
      const kbdLabels = Array.from(row.querySelectorAll('kbd.vim-kbd'))
        .map(el => el.textContent?.trim() ?? '')
      expect(kbdLabels).toEqual(['Ctrl', 'i'])
    })

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
  })

  describe('plan mode', () => {
    it('lists the new Ctrl+O and Ctrl+I jump-list shortcuts', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} mode="plan" />)

      expect(screen.getByText('Jump Back in scroll history')).toBeInTheDocument()
      expect(screen.getByText('Jump Forward in scroll history')).toBeInTheDocument()
    })

    it('refers to the plan content in the surrounding scrolling entries', () => {
      render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} mode="plan" />)

      // In plan mode the gg / G entries point at the plan body, not at
      // the diffs. The new Ctrl+O / Ctrl+I entries should be grouped
      // with them in the same section.
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
  })

  it('exposes the same jump-list entries in both modes', () => {
    const { unmount } = render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} />)
    expect(screen.getAllByText('Jump Back in scroll history')).toHaveLength(1)
    expect(screen.getAllByText('Jump Forward in scroll history')).toHaveLength(1)
    unmount()

    render(<ShortcutsHelpModal isOpen={true} onClose={() => {}} mode="plan" />)
    expect(screen.getAllByText('Jump Back in scroll history')).toHaveLength(1)
    expect(screen.getAllByText('Jump Forward in scroll history')).toHaveLength(1)
  })
})
