import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useJumpList } from '../useJumpList.js'

describe('useJumpList', () => {
  describe('initial state', () => {
    it('starts with an empty list and a sentinel index of -1', () => {
      const { result } = renderHook(() => useJumpList())

      expect(result.current.jumpList).toEqual([])
      expect(result.current.jumpListIndex).toBe(-1)
    })
  })

  describe('addToJumpList', () => {
    it('appends a scroll-only entry and advances the index', () => {
      const { result } = renderHook(() => useJumpList())

      act(() => result.current.addToJumpList(120))

      expect(result.current.jumpList).toEqual([{ scrollY: 120 }])
      expect(result.current.jumpListIndex).toBe(0)
    })

    it('appends a scroll+file entry and preserves the file context', () => {
      const { result } = renderHook(() => useJumpList())

      act(() => result.current.addToJumpList(240, 'src/app.tsx'))

      expect(result.current.jumpList).toEqual([
        { scrollY: 240, file: 'src/app.tsx' },
      ])
      expect(result.current.jumpListIndex).toBe(0)
    })

    it('grows the list and advances the index with each new entry', () => {
      const { result } = renderHook(() => useJumpList())

      act(() => result.current.addToJumpList(0))
      act(() => result.current.addToJumpList(50, 'a.ts'))
      act(() => result.current.addToJumpList(150, 'b.ts'))

      expect(result.current.jumpList).toEqual([
        { scrollY: 0 },
        { scrollY: 50, file: 'a.ts' },
        { scrollY: 150, file: 'b.ts' },
      ])
      expect(result.current.jumpListIndex).toBe(2)
    })

    it('records duplicate (scrollY, file) pairs as distinct entries', () => {
      const { result } = renderHook(() => useJumpList())

      act(() => result.current.addToJumpList(100, 'a.ts'))
      act(() => result.current.addToJumpList(100, 'a.ts'))

      expect(result.current.jumpList).toHaveLength(2)
      expect(result.current.jumpListIndex).toBe(1)
    })

    it('records zero and negative scroll values verbatim', () => {
      const { result } = renderHook(() => useJumpList())

      act(() => result.current.addToJumpList(0))
      act(() => result.current.addToJumpList(-42))

      expect(result.current.jumpList).toEqual([
        { scrollY: 0 },
        { scrollY: -42 },
      ])
    })
  })

  describe('goBack / goForward', () => {
    type Target = { scrollY: number; file?: string } | null
    function seed(hook: ReturnType<typeof useJumpList>) {
      act(() => hook.addToJumpList(0))
      act(() => hook.addToJumpList(100, 'a.ts'))
      act(() => hook.addToJumpList(200, 'b.ts'))
    }

    it('returns null and does not change state when goBack is at the start', () => {
      const { result } = renderHook(() => useJumpList())

      // No entries yet.
      let back: Target = null
      act(() => {
        back = result.current.goBack()
      })
      expect(back).toBeNull()
      expect(result.current.jumpListIndex).toBe(-1)

      // After a single add, going back should still be a no-op.
      act(() => result.current.addToJumpList(0))
      act(() => {
        back = result.current.goBack()
      })
      expect(back).toBeNull()
      expect(result.current.jumpListIndex).toBe(0)
    })

    it('walks backward one entry at a time, returning the target', () => {
      const { result } = renderHook(() => useJumpList())
      seed(result.current)

      let target: Target = null
      act(() => {
        target = result.current.goBack()
      })
      expect(target).toEqual({ scrollY: 100, file: 'a.ts' })
      expect(result.current.jumpListIndex).toBe(1)

      act(() => {
        target = result.current.goBack()
      })
      expect(target).toEqual({ scrollY: 0 })
      expect(result.current.jumpListIndex).toBe(0)
    })

    it('stops at the first entry and returns null on a further goBack', () => {
      const { result } = renderHook(() => useJumpList())
      seed(result.current)

      act(() => result.current.goBack())
      act(() => result.current.goBack())

      let target: Target = null
      act(() => {
        target = result.current.goBack()
      })
      expect(target).toBeNull()
      expect(result.current.jumpListIndex).toBe(0)
    })

    it('returns null and does not change state when goForward is at the end', () => {
      const { result } = renderHook(() => useJumpList())
      seed(result.current)

      let target: Target = null
      act(() => {
        target = result.current.goForward()
      })
      expect(target).toBeNull()
      expect(result.current.jumpListIndex).toBe(2)
    })

    it('walks forward one entry at a time, returning the target', () => {
      const { result } = renderHook(() => useJumpList())
      seed(result.current)

      // Step back twice so we have somewhere to walk forward to.
      act(() => result.current.goBack())
      act(() => result.current.goBack())
      expect(result.current.jumpListIndex).toBe(0)

      let target: Target = null
      act(() => {
        target = result.current.goForward()
      })
      expect(target).toEqual({ scrollY: 100, file: 'a.ts' })
      expect(result.current.jumpListIndex).toBe(1)

      act(() => {
        target = result.current.goForward()
      })
      expect(target).toEqual({ scrollY: 200, file: 'b.ts' })
      expect(result.current.jumpListIndex).toBe(2)
    })

    it('preserves the underlying list across back/forward steps', () => {
      const { result } = renderHook(() => useJumpList())
      seed(result.current)

      act(() => result.current.goBack())
      act(() => result.current.goForward())

      expect(result.current.jumpList).toEqual([
        { scrollY: 0 },
        { scrollY: 100, file: 'a.ts' },
        { scrollY: 200, file: 'b.ts' },
      ])
    })
  })

  describe('forward-history truncation (vim-style)', () => {
    it('discards the "future" branch when a new entry is pushed mid-list', () => {
      const { result } = renderHook(() => useJumpList())

      act(() => result.current.addToJumpList(0))
      act(() => result.current.addToJumpList(100, 'a.ts'))
      act(() => result.current.addToJumpList(200, 'b.ts'))

      // Walk back to the middle entry.
      act(() => result.current.goBack())
      expect(result.current.jumpListIndex).toBe(1)

      // Adding a new entry should drop the branch past the current index.
      act(() => result.current.addToJumpList(150, 'c.ts'))

      expect(result.current.jumpList).toEqual([
        { scrollY: 0 },
        { scrollY: 100, file: 'a.ts' },
        { scrollY: 150, file: 'c.ts' },
      ])
      expect(result.current.jumpListIndex).toBe(2)
    })

    it('after truncating, goForward has nothing to walk to', () => {
      const { result } = renderHook(() => useJumpList())

      act(() => result.current.addToJumpList(0))
      act(() => result.current.addToJumpList(100))
      act(() => result.current.addToJumpList(200))
      act(() => result.current.goBack()) // index = 1
      act(() => result.current.addToJumpList(300)) // truncates 200

      let target: unknown = 'sentinel'
      act(() => {
        target = result.current.goForward()
      })
      expect(target).toBeNull()
      expect(result.current.jumpListIndex).toBe(2)
    })
  })

  describe('maximum size cap', () => {
    it('drops the oldest entry once the list exceeds the default cap of 100', () => {
      const { result } = renderHook(() => useJumpList())

      act(() => {
        for (let i = 0; i < 101; i++) {
          result.current.addToJumpList(i)
        }
      })

      expect(result.current.jumpList).toHaveLength(100)
      // The first entry (scrollY: 0) should have been dropped.
      expect(result.current.jumpList[0]).toEqual({ scrollY: 1 })
      expect(result.current.jumpList[99]).toEqual({ scrollY: 100 })
    })

    it('clamps the index at maxSize - 1 even when entries overflow', () => {
      const { result } = renderHook(() => useJumpList())

      act(() => {
        for (let i = 0; i < 150; i++) {
          result.current.addToJumpList(i)
        }
      })

      expect(result.current.jumpListIndex).toBe(99)
      expect(result.current.jumpList).toHaveLength(100)
    })

    it('honors a custom maxSize', () => {
      const { result } = renderHook(() => useJumpList(5))

      act(() => {
        for (let i = 0; i < 8; i++) {
          result.current.addToJumpList(i * 10)
        }
      })

      expect(result.current.jumpList).toHaveLength(5)
      expect(result.current.jumpList.map(e => e.scrollY)).toEqual([
        30, 40, 50, 60, 70,
      ])
      // Index is clamped at maxSize - 1 = 4.
      expect(result.current.jumpListIndex).toBe(4)
    })

    it('keeps the list intact when the cap is not reached', () => {
      const { result } = renderHook(() => useJumpList(5))

      act(() => result.current.addToJumpList(10))
      act(() => result.current.addToJumpList(20))
      act(() => result.current.addToJumpList(30))

      expect(result.current.jumpList).toEqual([
        { scrollY: 10 },
        { scrollY: 20 },
        { scrollY: 30 },
      ])
      expect(result.current.jumpListIndex).toBe(2)
    })
  })

  describe('hook identity', () => {
    it('returns stable callback references across re-renders', () => {
      const { result, rerender } = renderHook(() => useJumpList())
      const initial = {
        addToJumpList: result.current.addToJumpList,
        goBack: result.current.goBack,
        goForward: result.current.goForward,
      }

      rerender()

      expect(result.current.addToJumpList).toBe(initial.addToJumpList)
      expect(result.current.goBack).toBe(initial.goBack)
      expect(result.current.goForward).toBe(initial.goForward)
    })

    it('keeps callbacks stable after a state change', () => {
      const { result, rerender } = renderHook(() => useJumpList())
      const initial = {
        addToJumpList: result.current.addToJumpList,
        goBack: result.current.goBack,
        goForward: result.current.goForward,
      }

      act(() => result.current.addToJumpList(100))
      rerender()

      // Callbacks are stable because internal state lives in a ref — a
      // re-render doesn't need to invalidate any closure.
      expect(result.current.addToJumpList).toBe(initial.addToJumpList)
      expect(result.current.goBack).toBe(initial.goBack)
      expect(result.current.goForward).toBe(initial.goForward)
    })
  })
})
