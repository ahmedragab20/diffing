import { useEffect, useRef } from 'react'
import type { FileDiffMetadata } from '@pierre/diffs'

/**
 * Harden "active file" detection for the diff review page.
 *
 * `activeFile` previously changed only on explicit actions (sidebar click,
 * J/K navigation, deep link), so scrolling to another file and pressing ⌘F
 * targeted a stale file. This hook keeps it in sync with the user's actual
 * focus using two signals, most-relevant-first:
 *
 *   1. **Mouse** — hovering over a file card makes it active immediately.
 *      The user's pointer is the strongest statement of intent.
 *   2. **Viewport** — the card with the largest visible height in the
 *      viewport is active. This is what keeps ⌘F correct after a plain
 *      scroll (wheel, PageDown, j/k, drag).
 *
 * Explicit selections (click / J·K / permalink) and the *programmatic smooth
 * scrolls* they trigger (viewed-advance) are protected by a suppression
 * window: `explicitSelectionRef` records when the last explicit selection
 * happened, and viewport-derived detection is ignored for a short period so a
 * smooth scroll past intermediate cards cannot flicker the active file.
 * Mouse-over is never suppressed — the cursor is where the user is looking —
 * but its selection is shielded from the viewport detector for the same short
 * window, so a re-render cannot immediately clobber a hover choice.
 */
export interface ViewportActiveFileOptions {
  /** Window (ms) after an explicit selection during which scroll-derived detection is ignored. */
  explicitSuppressMs?: number
  /** Re-scan interval for cards that lazy-mount while no scroll fires (ms). */
  pollMs?: number
}

export function useViewportActiveFileTracking(
  files: FileDiffMetadata[],
  activeFile: string | null,
  onActiveFileChange: (filePath: string) => void,
  explicitSelectionRef: React.MutableRefObject<number>,
  options: ViewportActiveFileOptions = {},
) {
  const suppressMs = options.explicitSuppressMs ?? 250
  const pollMs = options.pollMs ?? 500
  const activeFileRef = useRef(activeFile)
  activeFileRef.current = activeFile
  /**
   * When the last mouse-over selection happened. A ref (not effect-local state)
   * so the shield survives effect re-runs — e.g. the re-render triggered by the
   * hover's own state change must not immediately clobber the selection.
   */
  const lastMouseAtRef = useRef(0)

  useEffect(() => {
    const fileSet = new Set(files.map((f) => f.name))
    if (fileSet.size === 0) return

    let raf = 0
    let poll: ReturnType<typeof setInterval> | null = null
    let disposed = false

    const apply = (path: string) => {
      if (path !== activeFileRef.current) onActiveFileChange(path)
    }

    /** Pick the mounted card with the most visible height in the viewport. */
    const detectFromViewport = () => {
      raf = 0
      if (disposed) return
      if (Date.now() - explicitSelectionRef.current < suppressMs) return
      // A just-hovered file is the user's intent; do not clobber it until the
      // mouse-derived selection has had time to be acted on (e.g. ⌘F).
      if (Date.now() - lastMouseAtRef.current < suppressMs) return
      const vh = window.innerHeight || document.documentElement.clientHeight
      let bestPath: string | null = null
      let bestVisible = 0
      for (const path of fileSet) {
        const el = document.getElementById(`file-${path}`)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        const visible = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0))
        if (visible > bestVisible) {
          bestVisible = visible
          bestPath = path
        }
      }
      if (bestPath && bestVisible > 0) apply(bestPath)
    }

    const scheduleViewport = () => {
      if (!raf) raf = requestAnimationFrame(detectFromViewport)
    }

    // Mouse-over: the card under the pointer is the active file.
    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as Element | null
      const card = target?.closest?.('[id^="file-"]')
      if (!card) return
      const path = card.id.slice('file-'.length)
      if (fileSet.has(path)) {
        lastMouseAtRef.current = Date.now()
        apply(path)
      }
    }

    window.addEventListener('scroll', scheduleViewport, { passive: true })
    window.addEventListener('resize', scheduleViewport)
    document.addEventListener('mouseover', onMouseOver, { passive: true })
    // Cards lazy-mount as they scroll near the viewport; poll so detection
    // still converges when no scroll event follows the mount.
    poll = setInterval(detectFromViewport, pollMs)

    detectFromViewport()

    return () => {
      disposed = true
      window.removeEventListener('scroll', scheduleViewport)
      window.removeEventListener('resize', scheduleViewport)
      document.removeEventListener('mouseover', onMouseOver)
      if (poll) clearInterval(poll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [files, onActiveFileChange, explicitSelectionRef, suppressMs, pollMs])
}
