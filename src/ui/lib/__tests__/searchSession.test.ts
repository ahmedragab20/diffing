import { describe, expect, it, vi } from 'vitest'
import {
  activateSearchSessionHit,
  cycleSearchIndex,
  defaultChangedOnlyForScope,
  jumpToSearchHit,
  rowsToNavHits,
} from '../searchSession'

vi.mock('../../utils', () => ({
  scrollToLine: vi.fn(),
}))

import { scrollToLine } from '../../utils'

describe('searchSession', () => {
  const ctx = {
    diffFileSet: new Set(['src/a.ts']),
    changedKeys: new Set(['src/a.ts:10']),
    customMode: false,
    staged: false,
  }

  it('defaults changed-only for scoped palette shortcuts', () => {
    expect(defaultChangedOnlyForScope('text')).toBe(true)
    expect(defaultChangedOnlyForScope('files')).toBe(true)
    expect(defaultChangedOnlyForScope('symbols')).toBe(true)
    expect(defaultChangedOnlyForScope('all')).toBe(true)
  })

  it('maps palette rows to navigable hits', () => {
    const hits = rowsToNavHits(
      [
        { kind: 'file', hit: { path: 'src/a.ts' } },
        { kind: 'text', hit: { path: 'src/a.ts', line: 10 } },
        { kind: 'symbol', hit: { path: 'src/a.ts', line: 4, name: 'foo' } },
      ],
      'needle',
    )
    expect(hits).toEqual([
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'text', path: 'src/a.ts', line: 10, match: 'needle' },
      { kind: 'symbol', path: 'src/a.ts', line: 4, match: 'foo' },
    ])
  })

  it('wraps search index like the TUI', () => {
    expect(cycleSearchIndex(0, 1, 3)).toBe(1)
    expect(cycleSearchIndex(0, -1, 3)).toBe(2)
  })

  it('jumps in-diff line hits via scrollToLine', () => {
    const onNavigateFile = vi.fn()
    const result = jumpToSearchHit(
      { kind: 'text', path: 'src/a.ts', line: 10, match: 'x' },
      ctx,
      onNavigateFile,
    )
    expect(result).toBe('navigated')
    expect(scrollToLine).toHaveBeenCalledWith('src/a.ts', 10, 'additions', 'x')
  })

  it('activates a session hit at the requested index', () => {
    const onNavigateFile = vi.fn()
    activateSearchSessionHit(
      {
        hits: [{ kind: 'file', path: 'src/a.ts' }],
        index: 0,
        query: 'a',
      },
      0,
      ctx,
      onNavigateFile,
    )
    expect(onNavigateFile).toHaveBeenCalledWith('src/a.ts')
  })
})
