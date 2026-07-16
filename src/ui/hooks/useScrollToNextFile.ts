import { useCallback, useRef } from 'react'
import type { FileDiffMetadata } from '@pierre/diffs'

/**
 * Minimal viewport-rect shape used to decide whether the current file is in
 * the upper portion of the viewport. Mirrors the relevant fields of a
 * `DOMRect` plus `window.innerHeight`, so tests can pass synthetic values
 * without standing up a real DOM.
 */
export interface ScrollDecisionViewport {
    top: number
    bottom: number
    height: number
}

export interface ScrollDecision {
    targetId: string | null
    behavior: 'smooth' | 'auto'
}

export interface DecideScrollInput {
    /** Pre-sorted file list. Order MUST match what `<DiffViewer>` renders. */
    files: FileDiffMetadata[]
    currentPath: string
    /**
     * Where the current file sits in the viewport. Only used in tests to
     * exercise the visibility gate; in production the gate is skipped since
     * the user just interacted with the card.
     */
    viewport?: ScrollDecisionViewport
    reduce: boolean
}

export interface ScrollToNextFileOptions {
    /** Override the DOM-derived viewport rect (tests only). */
    viewport?: ScrollDecisionViewport
    /** Override `prefers-reduced-motion` (tests only). */
    reduce?: boolean
}

const VISIBILITY_TOP_RATIO = 0.6
const DEBOUNCE_MS = 250

/**
 * Pure decision helper. Given a (already-sorted) file list, the current file
 * path, an optional viewport rect, and a reduce-motion flag, decide which
 * `file-*` element to scroll to next.
 *
 * Three "no-op" conditions short-circuit to `targetId: null`:
 *   1. The current file is not in the list (filtered out, typo, etc.).
 *   2. The current file is the last entry — nothing to advance to.
 *   3. The visibility gate fails: the current file's top is in the lower
 *      40 % of the viewport, OR its bottom has scrolled above the viewport
 *      top. This prevents a runaway "staircase" where reading to the bottom
 *      of a file auto-jumps to the next one. The user must still feel in
 *      control: we only advance when they're near the top of the current
 *      file.
 *
 * The function is intentionally pure: it does not touch the DOM, the global
 * `matchMedia`, or any timers. The hook (`useScrollToNextFile`) is responsible
 * for gathering the viewport, honoring the debounce, and performing the scroll.
 */
export function decideScroll({
    files,
    currentPath,
    viewport,
    reduce,
}: DecideScrollInput): ScrollDecision {
    const behavior: 'smooth' | 'auto' = reduce ? 'auto' : 'smooth'
    const currentIndex = files.findIndex((f) => f.name === currentPath)
    if (currentIndex === -1 || currentIndex >= files.length - 1) {
        return { targetId: null, behavior }
    }
    if (viewport) {
        const visible =
            viewport.top < viewport.height * VISIBILITY_TOP_RATIO &&
            viewport.bottom > 0
        if (!visible) {
            return { targetId: null, behavior }
        }
    }
    const next = files[currentIndex + 1]
    return { targetId: `file-${next.name}`, behavior }
}

function detectReduceMotion(): boolean {
    if (typeof window === 'undefined') return false
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    return mq?.matches ?? false
}

/**
 * Returns a stable callback that, given the current file path, scrolls the
 * next file card in the DOM into view.
 *
 * Why DOM sibling traversal instead of array-based lookup:
 *   The previous implementation looked up `files[currentIndex + 1]` from a
 *   pre-sorted list and then fetched the element by id. This was fragile:
 *   the rendered DOM order can drift from the array order (e.g. when the
 *   <DiffViewer> renders binary files interleaved with text diffs, when
 *   the sort comparator changes, or when conditional UI between cards
 *   introduces extra wrapper elements). The "scroll to the next file"
 *   behavior is fundamentally a DOM question — "what card is actually
 *   rendered next to this one?" — so we now ask the DOM directly via
 *   `nextElementSibling`. We walk past any non-file siblings (wrapper
 *   divs, banners) until we find another element whose id starts with
 *   `file-`, which is the id convention used by `<FileDiffCard>`.
 *
 * Why a hook and not a one-off helper:
 *   - The 250 ms last-target debounce state has to live somewhere across
 *     rapid toggles. A module-level `let` would leak across remounts in
 *     StrictMode; a `useRef` is the natural fit.
 *   - The `files` parameter is kept for API compatibility (App.tsx passes
 *     `sortedFiles`), but the returned callback no longer reads it. The
 *     callback identity is stable across renders, so consumers can pass
 *     it into memoized children without churn.
 *
 * Safety:
 *   - Uses `getElementById('file-' + name)` exclusively for the *current*
 *     element. File paths routinely contain `/` and `.`, which would
 *     break a `querySelector` call. `getElementById` is the only DOM API
 *     that treats the id as an opaque string.
 *   - The `nextElementSibling` walk treats the id prefix as opaque too —
 *     we check `id.startsWith('file-')` and only stop on a match.
 *   - Reuses the existing `scroll-margin-top: 90px` on `.file-diff-card` so
 *     the toolbar doesn't overlap the next card. No new CSS.
 */
export function useScrollToNextFile(_files: FileDiffMetadata[]) {
    // `_files` is intentionally unused — the hook now consults the DOM
    // directly via sibling traversal instead of looking up the next entry
    // in the pre-sorted file list. Kept in the signature so App.tsx
    // doesn't need to change its call site, and so future callers can
    // pass context without us changing the API again.
    void _files

    const lastTargetRef = useRef<{ id: string; ts: number } | null>(null)

    const scrollToNextFile = useCallback(
        (currentFilePath: string, opts?: ScrollToNextFileOptions) => {
            const reduce = opts?.reduce ?? detectReduceMotion()
            const behavior: 'smooth' | 'auto' = reduce ? 'auto' : 'smooth'

            const currentEl = document.getElementById(`file-${currentFilePath}`)
            if (!currentEl) return

            // Walk past any non-file siblings (wrapper divs, banners, etc.)
            // until we land on the next rendered file card. This is the
            // single source of truth for "what comes after this card" —
            // it reflects whatever the React tree actually rendered, not
            // whatever array index a pre-sorted list says should be next.
            let nextEl: Element | null = currentEl.nextElementSibling
            while (nextEl) {
                const id = nextEl.id
                if (id && id.startsWith('file-')) {
                    break
                }
                nextEl = nextEl.nextElementSibling
            }
            if (!nextEl) return

            const targetEl = nextEl
            const targetId = targetEl.id

            // Debounce: only scroll if this is a different target or enough
            // time has passed. Prevents double-scrolls when the user clicks
            // a header chevron and the "Viewed" checkbox in quick succession.
            const now = Date.now()
            const last = lastTargetRef.current
            if (last && last.id === targetId && now - last.ts < DEBOUNCE_MS) {
                return
            }
            lastTargetRef.current = { id: targetId, ts: now }

            // Wait two animation frames so React can commit the collapse
            // (optimistic setCollapsed + viewed prop) and the browser can
            // reflow content-visibility cards. A single rAF often fires
            // before the expanded body unmounts, so scrollIntoView measures
            // against the full-height card and overshoots the next file.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Re-resolve in case the node was replaced during commit.
                    const el = document.getElementById(targetId) ?? targetEl
                    el.scrollIntoView({
                        block: 'start',
                        behavior,
                    })
                })
            })
        },
        [],
    )

    return scrollToNextFile
}
