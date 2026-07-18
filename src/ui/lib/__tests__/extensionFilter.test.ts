import { describe, it, expect } from 'vitest'
import {
  parseExtensionFilter,
  matchesExtensionFilter,
  formatExtensionFilter,
  collectExtensions,
  normalizeExtensions,
  sameExtensionSet,
  extensionFilterNeedsApply,
} from '../extensionFilter'

describe('parseExtensionFilter', () => {
  it('returns empty array for empty string', () => {
    expect(parseExtensionFilter('')).toEqual([])
  })

  it('parses comma-separated extensions', () => {
    expect(parseExtensionFilter('vue,js,ts')).toEqual(['js', 'ts', 'vue'])
  })

  it('parses space-separated extensions', () => {
    expect(parseExtensionFilter('vue js ts')).toEqual(['js', 'ts', 'vue'])
  })

  it('handles mixed comma and space separators', () => {
    expect(parseExtensionFilter('vue, js, ts')).toEqual(['js', 'ts', 'vue'])
  })

  it('strips leading dots and lowercases', () => {
    expect(parseExtensionFilter('.Vue, .JS, .TS')).toEqual(['js', 'ts', 'vue'])
  })

  it('ignores empty tokens', () => {
    expect(parseExtensionFilter('vue,,  ,ts')).toEqual(['ts', 'vue'])
  })
})

describe('matchesExtensionFilter', () => {
  it('matches when filter is empty', () => {
    expect(matchesExtensionFilter('src/foo.vue', [])).toBe(true)
  })

  it('matches files with allowed extensions', () => {
    expect(matchesExtensionFilter('src/foo.vue', ['vue', 'js'])).toBe(true)
    expect(matchesExtensionFilter('src/foo.js', ['vue', 'js'])).toBe(true)
  })

  it('does not match files with disallowed extensions', () => {
    expect(matchesExtensionFilter('README.md', ['vue', 'js', 'ts'])).toBe(false)
    expect(matchesExtensionFilter('src/foo.php', ['vue', 'js', 'ts'])).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(matchesExtensionFilter('src/foo.VUE', ['vue'])).toBe(true)
  })

  it('does not match files without extension', () => {
    expect(matchesExtensionFilter('Makefile', ['vue'])).toBe(false)
  })

  it('does not match directory names with dots', () => {
    expect(matchesExtensionFilter('some.dir/file', ['dir'])).toBe(false)
  })
})

describe('formatExtensionFilter', () => {
  it('returns empty string for empty filter', () => {
    expect(formatExtensionFilter([])).toBe('')
  })

  it('formats extensions with leading dots', () => {
    expect(formatExtensionFilter(['vue', 'js', 'ts'])).toBe('.vue, .js, .ts')
  })
})

describe('collectExtensions', () => {
  it('returns sorted unique extensions from paths', () => {
    expect(
      collectExtensions(['src/a.ts', 'src/b.tsx', 'src/c.ts', 'README.md', 'Makefile']),
    ).toEqual(['md', 'ts', 'tsx'])
  })

  it('ignores paths without a usable extension', () => {
    expect(collectExtensions(['.gitignore', 'src/.env', 'noext'])).toEqual([])
  })
})

describe('normalizeExtensions / sameExtensionSet', () => {
  it('dedupes and sorts', () => {
    expect(normalizeExtensions(['TS', '.js', 'ts', 'JS'])).toEqual(['js', 'ts'])
  })

  it('compares as sets', () => {
    expect(sameExtensionSet(['ts', 'js'], ['js', 'ts'])).toBe(true)
    expect(sameExtensionSet(['ts'], ['js'])).toBe(false)
  })
})

describe('extensionFilterNeedsApply', () => {
  it('is false for small diffs', () => {
    expect(extensionFilterNeedsApply(10, 100)).toBe(false)
  })

  it('is true when file count or line volume is high', () => {
    expect(extensionFilterNeedsApply(25, 0)).toBe(true)
    expect(extensionFilterNeedsApply(5, 1500)).toBe(true)
  })
})
