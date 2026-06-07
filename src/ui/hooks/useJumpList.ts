import { useCallback, useRef, useState } from "react"

export interface JumpEntry {
  scrollY: number
  file?: string
}

const DEFAULT_MAX_SIZE = 100

/**
 * Vim-style jump list for scroll/file navigation.
 *
 * Tracks a bounded list of scroll positions (and the file that was active
 * at the time). Pressing `Ctrl+O` walks backward through history; `Ctrl+I`
 * walks forward. New entries added after a backward walk discard the
 * "future" branch — mirroring how vim's jumplist behaves.
 *
 * The maximum size defaults to 100 entries; older entries are dropped
 * from the front of the list when the cap is exceeded.
 *
 * Internally, the index is mirrored in a ref so that `goBack` / `goForward`
 * can return their target entry synchronously to keyboard handlers.
 */
export function useJumpList(maxSize: number = DEFAULT_MAX_SIZE) {
  const [jumpList, setJumpList] = useState<JumpEntry[]>([])
  const [jumpListIndex, setJumpListIndex] = useState(-1)
  const indexRef = useRef(-1)
  const listRef = useRef<JumpEntry[]>([])

  const addToJumpList = useCallback(
    (scrollY: number, file?: string) => {
      // Read the *current* (ref-mirrored) index so batched calls compose
      // correctly — relying on the React state `jumpListIndex` would capture
      // a stale closure when several addToJumpList calls land in the same
      // React tick.
      const currentIndex = indexRef.current
      const truncated = listRef.current.slice(0, currentIndex + 1)
      truncated.push({ scrollY, file })
      while (truncated.length > maxSize) truncated.shift()

      const nextIndex = Math.min(currentIndex + 1, maxSize - 1)
      listRef.current = truncated
      indexRef.current = nextIndex
      setJumpList(truncated)
      setJumpListIndex(nextIndex)
    },
    [maxSize],
  )

  const goBack = useCallback((): JumpEntry | null => {
    if (indexRef.current <= 0) return null
    const nextIndex = indexRef.current - 1
    const target = listRef.current[nextIndex] ?? null
    indexRef.current = nextIndex
    setJumpListIndex(nextIndex)
    return target
  }, [])

  const goForward = useCallback((): JumpEntry | null => {
    if (indexRef.current >= listRef.current.length - 1) return null
    const nextIndex = indexRef.current + 1
    const target = listRef.current[nextIndex] ?? null
    indexRef.current = nextIndex
    setJumpListIndex(nextIndex)
    return target
  }, [])

  return {
    jumpList,
    jumpListIndex,
    addToJumpList,
    goBack,
    goForward,
  }
}
