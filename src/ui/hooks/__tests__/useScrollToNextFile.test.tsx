import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { FileDiffMetadata } from '@pierre/diffs'
import {
    useScrollToNextFile,
    decideScroll,
} from '../useScrollToNextFile.js'
import { sortFilesByName } from '../../components/DiffViewer.js'

const file = (name: string): FileDiffMetadata =>
    ({
        name,
        type: 'change',
        hunks: [],
        splitLineCount: 0,
        unifiedLineCount: 0,
        isPartial: false,
        deletionLines: [],
        additionLines: [],
    } as unknown as FileDiffMetadata)

// Synthetic viewport rects. jsdom's `getBoundingClientRect` returns all
// zeros, which would always fail the gate — tests that need to exercise
// the hook's behavior at all must pass `viewport` via `opts` to bypass the
// DOM lookup.
const IN_VIEW = { top: 100, bottom: 200, height: 1000 }
const OUT_OF_VIEW_BELOW = { top: 700, bottom: 800, height: 1000 }
const OUT_OF_VIEW_ABOVE = { top: -200, bottom: -50, height: 1000 }

describe('decideScroll', () => {
    it('order-consistency: sortFilesByName order matches the next-file decision', () => {
        // Invariant ① — the hook receives the IDENTICAL sorted array that
        // <DiffViewer> renders. This test sorts an intentionally-scrambled
        // list with the shared comparator and verifies the next-file lookup
        // walks the same order. If the comparator or the lookup ever
        // diverges, this test catches it.
        const unsorted = [
            file('b/c.ts'),
            file('a.ts'),
            file('b/a.ts'),
            file('z.ts'),
        ]
        const sorted = [...unsorted].sort(sortFilesByName)
        // sortFilesByName puts directory components before root files:
        // b/ is a directory prefix, so b/a.ts and b/c.ts come before a.ts
        expect(sorted.map((f) => f.name)).toEqual([
            'b/a.ts',
            'b/c.ts',
            'a.ts',
            'z.ts',
        ])

        // First in sorted order: b/a.ts → next is b/c.ts
        const decision = decideScroll({
            files: sorted,
            currentPath: 'b/a.ts',
            viewport: IN_VIEW,
            reduce: false,
        })
        expect(decision.targetId).toBe('file-b/c.ts')

        // Second in sorted order: b/c.ts → next is a.ts
        const step2 = decideScroll({
            files: sorted,
            currentPath: 'b/c.ts',
            viewport: IN_VIEW,
            reduce: false,
        })
        expect(step2.targetId).toBe('file-a.ts')
    })

    it('next-file target: returns the immediately-following entry when current is in the middle', () => {
        const files = [file('a.ts'), file('b.ts'), file('c.ts')]
        const decision = decideScroll({
            files,
            currentPath: 'b.ts',
            viewport: IN_VIEW,
            reduce: false,
        })
        expect(decision.targetId).toBe('file-c.ts')
        expect(decision.behavior).toBe('smooth')
    })

    it('last-file no-op: returns null when current is the last entry', () => {
        const files = [file('a.ts'), file('b.ts'), file('c.ts')]
        const decision = decideScroll({
            files,
            currentPath: 'c.ts',
            viewport: IN_VIEW,
            reduce: false,
        })
        expect(decision.targetId).toBeNull()
        expect(decision.behavior).toBe('smooth')
    })

    it('unknown-file no-op: returns null when currentPath is not in the list', () => {
        // Defensive: a stale filePath from a previous diff shouldn't crash
        // or scroll to a wrong target. The hook treats "not in the list"
        // the same as "no next file".
        const files = [file('a.ts'), file('b.ts')]
        const decision = decideScroll({
            files,
            currentPath: 'filtered-out.ts',
            viewport: IN_VIEW,
            reduce: false,
        })
        expect(decision.targetId).toBeNull()
    })

    it('visibility gate: skips when current has scrolled past the upper 60% of the viewport', () => {
        // The user has read to the bottom of the current file (or below).
        // Auto-advancing now would feel like the app is dragging them
        // forward. Skip and let them scroll/click on their own terms.
        const files = [file('a.ts'), file('b.ts')]
        const decision = decideScroll({
            files,
            currentPath: 'a.ts',
            viewport: OUT_OF_VIEW_BELOW,
            reduce: false,
        })
        expect(decision.targetId).toBeNull()
    })

    it('visibility gate: skips when current is fully above the viewport (scrolled up)', () => {
        const files = [file('a.ts'), file('b.ts')]
        const decision = decideScroll({
            files,
            currentPath: 'a.ts',
            viewport: OUT_OF_VIEW_ABOVE,
            reduce: false,
        })
        expect(decision.targetId).toBeNull()
    })

    it('reduced motion: returns behavior "auto" when reduce=true', () => {
        const files = [file('a.ts'), file('b.ts')]
        const decision = decideScroll({
            files,
            currentPath: 'a.ts',
            viewport: IN_VIEW,
            reduce: true,
        })
        expect(decision.behavior).toBe('auto')
        expect(decision.targetId).toBe('file-b.ts')
    })

    it('default: returns behavior "smooth" when reduce=false', () => {
        const files = [file('a.ts'), file('b.ts')]
        const decision = decideScroll({
            files,
            currentPath: 'a.ts',
            viewport: IN_VIEW,
            reduce: false,
        })
        expect(decision.behavior).toBe('smooth')
    })
})

describe('useScrollToNextFile (hook integration)', () => {
    let scrollIntoViewSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        document.body.innerHTML = ''
        for (const name of ['a.ts', 'b.ts', 'c.ts', 'src/nested/d.ts']) {
            const el = document.createElement('div')
            el.id = `file-${name}`
            document.body.appendChild(el)
        }

        if (!Element.prototype.scrollIntoView) {
            Element.prototype.scrollIntoView = vi.fn()
        }
        scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView')

        // Shim rAF to execute callbacks synchronously in tests
        const origRAF = window.requestAnimationFrame
        window.requestAnimationFrame = (cb: FrameRequestCallback) => {
            cb(0)
            return 0
        }
    })

    afterEach(() => {
        cleanup()
        document.body.innerHTML = ''
        if (scrollIntoViewSpy) scrollIntoViewSpy.mockRestore()
        delete (window as { requestAnimationFrame?: typeof window.requestAnimationFrame }).requestAnimationFrame
    })

    it('calls scrollIntoView on the next-file element with {block:"start", behavior:"smooth"}', () => {
        const files = [
            file('a.ts'),
            file('b.ts'),
            file('c.ts'),
            file('src/nested/d.ts'),
        ]
        const { result } = renderHook(() => useScrollToNextFile(files))

        act(() => {
            result.current('c.ts')
        })

        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)
        expect(scrollIntoViewSpy).toHaveBeenCalledWith({
            block: 'start',
            behavior: 'smooth',
        })
    })

    it('honors prefers-reduced-motion via window.matchMedia', () => {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query.includes('reduce'),
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as unknown as typeof window.matchMedia

        const files = [file('a.ts'), file('b.ts')]
        const { result } = renderHook(() => useScrollToNextFile(files))

        act(() => {
            result.current('a.ts')
        })

        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)
        expect(scrollIntoViewSpy).toHaveBeenCalledWith({
            block: 'start',
            behavior: 'auto',
        })
    })

    it('debounces the same target within 250ms but lets a different target through', () => {
        vi.useFakeTimers()
        // Fake timers override our rAF shim; re-shim it so the scroll fires.
        window.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0 }
        const t0 = new Date('2024-01-01T00:00:00Z').getTime()
        vi.setSystemTime(t0)

        const files = [file('a.ts'), file('b.ts'), file('c.ts')]
        const { result } = renderHook(() => useScrollToNextFile(files))

        // (a) First call: a.ts → b.ts. Scrolls.
        act(() => {
            result.current('a.ts')
        })
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)

        // Same target, +100 ms (< 250 ms). Debounced.
        vi.setSystemTime(t0 + 100)
        act(() => {
            result.current('a.ts')
        })
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)

        // (b) Different target, still +100 ms (within the 250 ms window
        //     of the *previous* call, but the new target is different).
        //     Should fire: scrolls to c.ts.
        vi.setSystemTime(t0 + 100)
        act(() => {
            result.current('b.ts')
        })
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2)

        // (c) Back to a.ts, +300 ms (past the 250 ms window of the most
        //     recent call at +100 ms). Should fire again.
        vi.setSystemTime(t0 + 300)
        act(() => {
            result.current('a.ts')
        })
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(3)
    })

    it('skips non-file siblings when finding the next file card', () => {
        // Replace the default beforeEach layout with one that has non-file
        // elements (a wrapper div, a banner) between two file cards. The
        // hook must walk past them and land on the next `file-*` element.
        document.body.innerHTML = ''
        const a = document.createElement('div')
        a.id = 'file-a.ts'
        const wrapper = document.createElement('div')
        wrapper.id = 'wrapper-banner'
        const spacer = document.createElement('div')
        spacer.id = 'hunk-actions-spacer'
        const b = document.createElement('div')
        b.id = 'file-b.ts'
        document.body.append(a, wrapper, spacer, b)

        // The `files` array is now irrelevant to the lookup — pass a
        // different order to prove DOM traversal is the source of truth.
        const files = [file('b.ts'), file('a.ts')]
        const { result } = renderHook(() => useScrollToNextFile(files))

        // Pass `reduce: false` explicitly because the earlier
        // "honors prefers-reduced-motion" test mocks `matchMedia` to
        // return `matches: true`, and that mock persists into this test.
        act(() => {
            result.current('a.ts', { reduce: false })
        })

        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)
        // The spy was called on the `b` element (next file in the DOM),
        // not on `wrapper` or `spacer`.
        expect(scrollIntoViewSpy.mock.instances[0]).toBe(b)
        expect(scrollIntoViewSpy).toHaveBeenCalledWith({
            block: 'start',
            behavior: 'smooth',
        })
    })

    it('no-op when the current file is the last file in the DOM', () => {
        // Only one file card exists — nothing to advance to.
        document.body.innerHTML = ''
        const only = document.createElement('div')
        only.id = 'file-only.ts'
        document.body.appendChild(only)

        const files = [file('only.ts')]
        const { result } = renderHook(() => useScrollToNextFile(files))

        act(() => {
            result.current('only.ts')
        })

        expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    })

    it('no-op when the current file id does not exist in the DOM', () => {
        // The beforeEach setup creates file-a.ts, file-b.ts, file-c.ts,
        // and file-src/nested/d.ts. Asking to scroll from a path that
        // isn't in the DOM must not scroll to anything.
        const files = [file('a.ts'), file('b.ts')]
        const { result } = renderHook(() => useScrollToNextFile(files))

        act(() => {
            result.current('nonexistent.ts')
        })

        expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    })
})
