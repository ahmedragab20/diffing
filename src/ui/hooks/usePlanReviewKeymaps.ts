import { useEffect } from 'react'
import { fireFeedback, playSound } from './useHaptics'

export interface PlanReviewKeymapActions {
  onNavigatePlan: (direction: 'next' | 'prev') => void
  onToggleViewMode: () => void
  onToggleZenMode: () => void
  onToggleCommentsRail: () => void
  onToggleOutline: () => void
  onCycleTabSize: () => void
  onToggleSidebar: () => void
  onToggleLineWrap: () => void
  onToggleLineNumbers: () => void
  onOpenTheme: () => void
  onOpenShortcuts: () => void
}

/** Vim-style keyboard model for the plan review surface. */
export function usePlanReviewKeymaps(actions: PlanReviewKeymapActions) {
  useEffect(() => {
    let keyBuffer = ''
    let bufferTimeout: ReturnType<typeof setTimeout>
    let lastNavSound = 0

    const resetBuffer = () => {
      keyBuffer = ''
      clearTimeout(bufferTimeout)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement
      if (active) {
        const tag = active.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || active.hasAttribute('contenteditable')) {
          return
        }
      }

      // Never steal browser chords (⌘C copy, ⌥ shortcuts, etc.). Ctrl+D/U
      // page-scroll is handled below; other Ctrl chords also bail out there.
      if (event.metaKey || event.altKey) return

      clearTimeout(bufferTimeout)
      const key = event.key

      if (event.ctrlKey) {
        if (key === 'd' || key === 'u') {
          event.preventDefault()
          window.scrollBy({
            top: key === 'd' ? window.innerHeight / 2 : -window.innerHeight / 2,
            behavior: 'auto',
          })
          fireFeedback('selection', 'navigate')
          resetBuffer()
        }
        return
      }

      if (key.length > 1 && key !== 'Escape' && key !== 'Enter') return

      keyBuffer += key
      bufferTimeout = setTimeout(() => {
        keyBuffer = ''
      }, 800)

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
        handled(
          () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' }),
          'navigate',
        )
      } else if (keyBuffer === 'J') {
        handled(() => actions.onNavigatePlan('next'), 'navigate')
      } else if (keyBuffer === 'K') {
        handled(() => actions.onNavigatePlan('prev'), 'navigate')
      } else if (keyBuffer === 'm') {
        handled(actions.onToggleViewMode)
      } else if (keyBuffer === 'z') {
        handled(actions.onToggleZenMode)
      } else if (keyBuffer === 'c') {
        handled(actions.onToggleCommentsRail)
      } else if (keyBuffer === 'o') {
        handled(actions.onToggleOutline)
      } else if (keyBuffer === 't') {
        handled(actions.onCycleTabSize)
      } else if (keyBuffer === 'b') {
        handled(actions.onToggleSidebar)
      } else if (keyBuffer === 'w') {
        handled(actions.onToggleLineWrap)
      } else if (keyBuffer === 'n') {
        handled(actions.onToggleLineNumbers)
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
