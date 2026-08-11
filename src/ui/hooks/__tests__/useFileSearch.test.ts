// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffLineEntry } from '../useDiffSearch'
import { useFileSearch } from '../useFileSearch'

vi.mock('../../utils', () => ({
  scrollToLine: vi.fn(),
}))

import { scrollToLine } from '../../utils'

const diffEntries: DiffLineEntry[] = [
  { filePath: 'src/a.ts', lineNumber: 1, side: 'additions', content: 'const foo = 1' },
  { filePath: 'src/a.ts', lineNumber: 2, side: 'additions', content: 'const bar = 2' },
  { filePath: 'src/a.ts', lineNumber: 3, side: 'deletions', content: 'let FOO = 3' },
  { filePath: 'src/a.ts', lineNumber: 4, side: 'additions', content: 'console.log(baz)' },
  { filePath: 'src/b.ts', lineNumber: 10, side: 'additions', content: 'const foo = 10' },
]

describe('useFileSearch', () => {
  beforeEach(() => {
    vi.mocked(scrollToLine).mockClear()
  })

  it('starts closed with no query, hits, or index', () => {
    const { result } = renderHook(() => useFileSearch(diffEntries))

    expect(result.current.filePath).toBeNull()
    expect(result.current.query).toBe('')
    expect(result.current.hits).toEqual([])
    expect(result.current.index).toBe(0)
  })

  it('open on a new file sets the file and clears any query and index', () => {
    const { result } = renderHook(() => useFileSearch(diffEntries))

    act(() => {
      result.current.open('src/a.ts')
      result.current.setQuery('foo')
    })
    act(() => {
      result.current.next()
    })
    expect(result.current.index).toBe(1)

    act(() => {
      result.current.open('src/b.ts')
    })

    expect(result.current.filePath).toBe('src/b.ts')
    expect(result.current.query).toBe('')
    expect(result.current.hits).toEqual([])
    expect(result.current.index).toBe(0)
  })

  it('re-opening the same file keeps the query and bumps focusNonce', () => {
    const { result } = renderHook(() => useFileSearch(diffEntries))

    act(() => {
      result.current.open('src/a.ts')
      result.current.setQuery('foo')
    })
    act(() => {
      result.current.next()
    })
    expect(result.current.index).toBe(1)
    const nonceAfterOpen = result.current.focusNonce

    // Simulate ⌘F after the field blurred: re-open the same file. The query
    // and cursor must survive (so the input can select it for retyping) and
    // the nonce must bump so the bar re-focuses its input.
    act(() => {
      result.current.open('src/a.ts')
    })

    expect(result.current.filePath).toBe('src/a.ts')
    expect(result.current.query).toBe('foo')
    expect(result.current.hits.map((h) => h.lineNumber)).toEqual([1, 3])
    expect(result.current.index).toBe(1)
    expect(result.current.focusNonce).toBe(nonceAfterOpen + 1)
  })

  it('setQuery filters hits to the open file, case-insensitively and trimmed', () => {
    const { result } = renderHook(() => useFileSearch(diffEntries))

    act(() => {
      result.current.open('src/a.ts')
      result.current.setQuery('  FOO  ')
    })

    const hits = result.current.hits
    expect(hits.map((h) => h.lineNumber)).toEqual([1, 3])
    expect(hits.every((h) => h.filePath === 'src/a.ts')).toBe(true)
    expect(hits[0]).toMatchObject({ filePath: 'src/a.ts', lineNumber: 1, side: 'additions' })
    expect(hits[1]).toMatchObject({ filePath: 'src/a.ts', lineNumber: 3, side: 'deletions' })
  })

  it('yields no hits before a query or for a whitespace-only query', () => {
    const { result } = renderHook(() => useFileSearch(diffEntries))

    act(() => {
      result.current.open('src/a.ts')
    })
    expect(result.current.hits).toEqual([])

    act(() => {
      result.current.setQuery('   ')
    })
    expect(result.current.hits).toEqual([])
    expect(result.current.index).toBe(0)
  })

  it('next/prev cycle through hits modulo length and scroll to the match', () => {
    const { result } = renderHook(() => useFileSearch(diffEntries))

    act(() => {
      result.current.open('src/a.ts')
      result.current.setQuery('foo')
    })

    expect(result.current.hits.map((h) => h.lineNumber)).toEqual([1, 3])
    expect(result.current.index).toBe(0)

    act(() => {
      result.current.next()
    })
    expect(result.current.index).toBe(1)
    expect(scrollToLine).toHaveBeenLastCalledWith('src/a.ts', 3, 'deletions', 'foo')

    act(() => {
      result.current.next()
    })
    expect(result.current.index).toBe(0)
    expect(scrollToLine).toHaveBeenLastCalledWith('src/a.ts', 1, 'additions', 'foo')

    act(() => {
      result.current.prev()
    })
    expect(result.current.index).toBe(1)
    expect(scrollToLine).toHaveBeenLastCalledWith('src/a.ts', 3, 'deletions', 'foo')

    act(() => {
      result.current.prev()
    })
    expect(result.current.index).toBe(0)
    expect(scrollToLine).toHaveBeenLastCalledWith('src/a.ts', 1, 'additions', 'foo')

    expect(scrollToLine).toHaveBeenCalledTimes(4)
  })

  it('passes the trimmed query to scrollToLine', () => {
    const { result } = renderHook(() => useFileSearch(diffEntries))

    act(() => {
      result.current.open('src/a.ts')
      result.current.setQuery('  foo  ')
    })
    act(() => {
      result.current.next()
    })

    // next() advances to the second hit (index 1 → line 3), and the query is
    // trimmed before it reaches scrollToLine.
    expect(scrollToLine).toHaveBeenCalledTimes(1)
    expect(scrollToLine).toHaveBeenCalledWith('src/a.ts', 3, 'deletions', 'foo')
  })

  it('next/prev do nothing and keep index at 0 when there are no hits', () => {
    const { result } = renderHook(() => useFileSearch(diffEntries))

    act(() => {
      result.current.open('src/a.ts')
      result.current.setQuery('zzz-no-match')
    })

    expect(result.current.hits).toEqual([])

    act(() => {
      result.current.next()
      result.current.prev()
    })

    expect(result.current.index).toBe(0)
    expect(scrollToLine).not.toHaveBeenCalled()
  })

  it('close resets the session', () => {
    const { result } = renderHook(() => useFileSearch(diffEntries))

    act(() => {
      result.current.open('src/a.ts')
      result.current.setQuery('foo')
      result.current.next()
    })
    expect(result.current.filePath).toBe('src/a.ts')

    act(() => {
      result.current.close()
    })

    expect(result.current.filePath).toBeNull()
    expect(result.current.query).toBe('')
    expect(result.current.hits).toEqual([])
    expect(result.current.index).toBe(0)
  })

  it('clamps the index when hits shrink after the diff entries change', () => {
    const { result, rerender } = renderHook(
      ({ entries }: { entries: DiffLineEntry[] }) => useFileSearch(entries),
      { initialProps: { entries: diffEntries } },
    )

    act(() => {
      result.current.open('src/a.ts')
      result.current.setQuery('foo')
    })
    act(() => {
      result.current.next()
    })
    expect(result.current.hits).toHaveLength(2)
    expect(result.current.index).toBe(1)

    // The diff refreshes and only one matching line remains for the open file.
    const slimEntries = diffEntries.filter((e) => e.lineNumber === 1 || e.filePath === 'src/b.ts')
    rerender({ entries: slimEntries })

    expect(result.current.hits).toHaveLength(1)
    expect(result.current.hits[0].lineNumber).toBe(1)
    expect(result.current.index).toBe(0)
  })
})
