import { describe, it, expect } from 'vitest'
import { sanitizePaths, buildExpandedPaths } from '../lib/treePathSanitize'

describe('sanitizePaths', () => {
  it('collapses exact duplicate paths and keeps the first occurrence', () => {
    const { paths, dropped } = sanitizePaths(['a/b', 'a/b', 'a/c'])
    expect(paths).toEqual(['a/b', 'a/c'])
    expect(dropped).toEqual([])
  })

  it('drops a standalone file that collides with a real directory (a/b + a/b/c)', () => {
    const { paths, dropped } = sanitizePaths(['a/b', 'a/b/c'])
    expect(paths).toEqual(['a/b/c'])
    expect(dropped).toEqual(['a/b'])
  })

  it('produces the same result regardless of input order for collisions', () => {
    const { paths: forwardPaths, dropped: forwardDropped } = sanitizePaths([
      'a/b/c',
      'a/b',
    ])
    const { paths: reversePaths, dropped: reverseDropped } = sanitizePaths([
      'a/b',
      'a/b/c',
    ])
    expect(forwardPaths).toEqual(reversePaths)
    expect(forwardDropped).toEqual(reverseDropped)
    expect(forwardPaths).toEqual(['a/b/c'])
    expect(forwardDropped).toEqual(['a/b'])
  })

  it('drops empty and whitespace-only entries', () => {
    const { paths, dropped } = sanitizePaths(['', '   ', 'a/b', '\t\n'])
    expect(paths).toEqual(['a/b'])
    expect(dropped).toEqual([])
  })

  it('strips a single leading "./" so "./a/b" and "a/b" are the same path', () => {
    const { paths, dropped } = sanitizePaths(['./a/b', 'a/b'])
    expect(paths).toEqual(['a/b'])
    expect(dropped).toEqual([])
  })

  it('ignores non-string entries', () => {
    const { paths, dropped } = sanitizePaths([
      null as unknown as string,
      undefined as unknown as string,
      42 as unknown as string,
      'a/b',
    ])
    expect(paths).toEqual(['a/b'])
    expect(dropped).toEqual([])
  })

  it('drops the file when a deeper path proves it is a real directory', () => {
    const { paths, dropped } = sanitizePaths([
      'skills/diffing',
      'skills/diffing/SKILL.md',
    ])
    expect(paths).toEqual(['skills/diffing/SKILL.md'])
    expect(dropped).toEqual(['skills/diffing'])
  })

  it('preserves the original order of surviving paths', () => {
    const { paths, dropped } = sanitizePaths(['x', 'a/b', 'a/b/c', 'm/n'])
    expect(paths).toEqual(['x', 'a/b/c', 'm/n'])
    expect(dropped).toEqual(['a/b'])
  })

  it('returns empty results for an empty input', () => {
    const { paths, dropped } = sanitizePaths([])
    expect(paths).toEqual([])
    expect(dropped).toEqual([])
  })
})

describe('buildExpandedPaths', () => {
  it('returns every ancestor prefix of every input path (excluding the file itself)', () => {
    const result = buildExpandedPaths(['a/b/c.ts', 'x/y/z'])
    expect(new Set(result)).toEqual(new Set(['a', 'a/b', 'x', 'x/y']))
  })

  it('returns an empty list for an empty input', () => {
    expect(buildExpandedPaths([])).toEqual([])
  })

  it('also handles collisions in the input by sanitizing first', () => {
    // `a/b` is a directory because `a/b/c` is in the list, so the standalone
    // `a/b` file is dropped. The surviving paths are just `a/b/c`, whose
    // ancestor prefixes are `a` and `a/b` (not `a/b` the file).
    const result = buildExpandedPaths(['a/b', 'a/b/c'])
    expect(new Set(result)).toEqual(new Set(['a', 'a/b']))
  })

  it('produces a stable set even when input paths share intermediate directories', () => {
    // `a/b/c` and `a/b/d` share the directory prefix `a/b`; `a/e` has only
    // `a` as a parent. The expansion set contains only the directories,
    // deduped, never the file paths themselves.
    const result = buildExpandedPaths(['a/b/c', 'a/b/d', 'a/e'])
    expect(new Set(result)).toEqual(new Set(['a', 'a/b']))
  })
})
