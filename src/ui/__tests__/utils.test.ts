import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { timeAgo, truncate, fileName } from '../utils.js'

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for less than 5 seconds', () => {
    const now = Date.now()
    expect(timeAgo(now)).toBe('just now')
    expect(timeAgo(now - 3000)).toBe('just now')
  })

  it('returns seconds ago for less than 60 seconds', () => {
    const ts = Date.now() - 10000
    expect(timeAgo(ts)).toBe('10s ago')
  })

  it('returns minutes ago for less than 60 minutes', () => {
    const ts = Date.now() - 120000
    expect(timeAgo(ts)).toBe('2m ago')
  })

  it('returns hours ago for less than 24 hours', () => {
    const ts = Date.now() - 3600000 * 3
    expect(timeAgo(ts)).toBe('3h ago')
  })

  it('returns days ago for 24+ hours', () => {
    const ts = Date.now() - 86400000 * 5
    expect(timeAgo(ts)).toBe('5d ago')
  })
})

describe('truncate', () => {
  it('returns the full text when shorter than maxLen', () => {
    expect(truncate('Hello', 10)).toBe('Hello')
  })

  it('truncates and appends ellipsis when text exceeds maxLen', () => {
    const result = truncate('Hello World', 5)
    expect(result).toBe('Hello…')
  })

  it('only considers the first line', () => {
    const result = truncate('First line\nSecond line', 20)
    expect(result).toBe('First line')
  })

  it('truncates first line within maxLen', () => {
    const result = truncate('A very long first line\nSecond line', 10)
    expect(result).toBe('A very lon…')
  })

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('')
  })
})

describe('fileName', () => {
  it('returns the basename from a path', () => {
    expect(fileName('src/components/Button.tsx')).toBe('Button.tsx')
  })

  it('returns the name for a root-level file', () => {
    expect(fileName('README.md')).toBe('README.md')
  })

  it('handles empty string', () => {
    expect(fileName('')).toBe('')
  })

  it('handles trailing slash', () => {
    expect(fileName('src/components/')).toBe('')
  })
})
