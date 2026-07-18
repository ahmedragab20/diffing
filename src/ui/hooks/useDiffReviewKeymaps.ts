import { useEffect } from 'react'
import type { Scope } from '../lib/searchTypes'
import { fireFeedback, playSound } from './useHaptics'

interface DiffReviewKeymapActions {
  onNavigateFile: (direction: 'next' | 'prev') => void
  onNavigateCommit?: (direction: 'next' | 'prev') => void
  onToggleViewed: () => void
  onToggleDiffStyle: () => void
  onCycleTabSize: () => void
  onToggleSidebar: () => void
  onToggleLineWrap: () => void
  onToggleLineNumbers: () => void
  onCycleDiffIndicators: () => void
  onCycleLineDiffType: () => void
  onOpenPalette: (scope: Scope) => void
  onTogglePalette?: () => void
  onOpenTheme: () => void
  onOpenShortcuts: () => void
}

/** Shared keyboard model for local and GitHub diff review surfaces. */
export function useDiffReviewKeymaps(actions: DiffReviewKeymapActions) {
  useEffect(() => {
    let keyBuffer = ''
    let bufferTimeout: ReturnType<typeof setTimeout>
    let lastNavSound = 0

    const resetBuffer = () => {
      keyBuffer = ''
      clearTimeout(bufferTimeout)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // The command palette remains global, including while an editor is focused.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (actions.onTogglePalette) actions.onTogglePalette()
        else actions.onOpenPalette('all')
        resetBuffer()
        return
      }

      const active = document.activeElement
      if (active) {
        const tag = active.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || active.hasAttribute('contenteditable')) return
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === '?' || (event.key === '/' && event.shiftKey) || (event.code === 'Slash' && event.shiftKey))
      ) {
        event.preventDefault()
        actions.onOpenShortcuts()
        fireFeedback('medium', 'open')
        resetBuffer()
        return
      }

      if (event.ctrlKey) {
        if (event.key === 'd' || event.key === 'u') {
          event.preventDefault()
          window.scrollBy({
            top: event.key === 'd' ? window.innerHeight / 2 : -window.innerHeight / 2,
            behavior: 'auto',
          })
          fireFeedback('selection', 'navigate')
          resetBuffer()
        }
        return
      }

      const key = event.key
      if (key.length > 1 && key !== 'Escape' && key !== 'Enter') return
      clearTimeout(bufferTimeout)
      keyBuffer += key
      bufferTimeout = setTimeout(() => { keyBuffer = '' }, 800)

      const handled = (callback: () => void, feedback: 'navigate' | 'toggle' | 'open' = 'toggle') => {
        event.preventDefault()
        callback()
        fireFeedback(feedback === 'open' ? 'medium' : 'selection', feedback)
        resetBuffer()
      }

      if (keyBuffer === 'j' || keyBuffer === 'k') {
        event.preventDefault()
        window.scrollBy({ top: keyBuffer === 'j' ? 100 : -100, behavior: 'auto' })
        const now = Date.now()
        if (now - lastNavSound > 80) {
          playSound('navigate')
          lastNavSound = now
        }
        resetBuffer()
      } else if (keyBuffer === 'gg') {
        handled(() => window.scrollTo({ top: 0, behavior: 'auto' }), 'navigate')
      } else if (keyBuffer === 'G') {
        handled(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' }), 'navigate')
      } else if (keyBuffer === 'J') {
        handled(() => actions.onNavigateFile('next'), 'navigate')
      } else if (keyBuffer === 'K') {
        handled(() => actions.onNavigateFile('prev'), 'navigate')
      } else if (keyBuffer === ']' && actions.onNavigateCommit) {
        handled(() => actions.onNavigateCommit?.('next'), 'navigate')
      } else if (keyBuffer === '[' && actions.onNavigateCommit) {
        handled(() => actions.onNavigateCommit?.('prev'), 'navigate')
      } else if (keyBuffer === 'v') {
        handled(actions.onToggleViewed)
      } else if (keyBuffer === 'm') {
        handled(actions.onToggleDiffStyle)
      } else if (keyBuffer === 't') {
        handled(actions.onCycleTabSize)
      } else if (keyBuffer === 'b') {
        handled(actions.onToggleSidebar)
      } else if (keyBuffer === 'w') {
        handled(actions.onToggleLineWrap)
      } else if (keyBuffer === 'n') {
        handled(actions.onToggleLineNumbers)
      } else if (keyBuffer === 'i') {
        handled(actions.onCycleDiffIndicators)
      } else if (keyBuffer === 'I') {
        handled(actions.onCycleLineDiffType)
      } else if (keyBuffer === '/') {
        handled(() => actions.onOpenPalette('text'), 'open')
      } else if (keyBuffer === 's' || keyBuffer === 'gs') {
        handled(() => actions.onOpenPalette('symbols'), 'open')
      } else if (keyBuffer === 'gf') {
        handled(() => actions.onOpenPalette('all'), 'open')
      } else if (keyBuffer === 'gv') {
        handled(() => actions.onOpenPalette('files'), 'open')
      } else if (keyBuffer === 'gt') {
        handled(actions.onOpenTheme, 'open')
      } else if (keyBuffer === '?') {
        handled(actions.onOpenShortcuts, 'open')
      } else if (keyBuffer.length >= 2) {
        resetBuffer()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearTimeout(bufferTimeout)
    }
  }, [actions])
}
