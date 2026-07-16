import { describe, it, expect } from 'vitest'
import { parseExtensionFilter, matchesExtensionFilter, formatExtensionFilter } from '../extensionFilter'

describe('parseExtensionFilter', () => {
  it('returns empty array for empty string', () => {
    expect(parseExtensionFilter('')).toEqual([])
  })

  it('parses comma-separated extensions', () => {
    expect(parseExtensionFilter('vue,js,ts')).toEqual(['vue', 'js', 'ts'])
  })

  it('parses space-separated extensions', () => {
    expect(parseExtensionFilter('vue js ts')).toEqual(['vue', 'js', 'ts'])
  })

  it('handles mixed comma and space separators', () => {
    expect(parseExtensionFilter('vue, js, ts')).toEqual(['vue', 'js', 'ts'])
  })

  it('strips leading dots and lowercases', () => {
    expect(parseExtensionFilter('.Vue, .JS, .TS')).toEqual(['vue', 'js', 'ts'])
  })

  it('ignores empty tokens', () => {
    expect(parseExtensionFilter('vue,,  ,ts')).toEqual(['vue', 'ts'])
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
