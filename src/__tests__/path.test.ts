import { describe, it, expect } from 'vitest'
import { isSafePath } from '../path.js'

describe('isSafePath', () => {
  const baseDir = '/home/user/project'

  it('allows a normal relative path', () => {
    expect(isSafePath('src/index.ts', baseDir)).toBe(true)
  })

  it('allows a nested relative path', () => {
    expect(isSafePath('src/components/Button.tsx', baseDir)).toBe(true)
  })

  it('rejects path with parent directory traversal', () => {
    expect(isSafePath('../etc/passwd', baseDir)).toBe(false)
  })

  it('rejects deeply nested path traversal', () => {
    expect(isSafePath('src/../../etc/passwd', baseDir)).toBe(false)
  })

  it('rejects path with null byte', () => {
    expect(isSafePath('src/\0malicious', baseDir)).toBe(false)
  })

  it('rejects an absolute path', () => {
    expect(isSafePath('/etc/passwd', baseDir)).toBe(false)
  })

  it('rejects URL-encoded path traversal (%2e%2e)', () => {
    expect(isSafePath('%2e%2e/etc/passwd', baseDir)).toBe(false)
  })

  it('rejects URL-encoded slash traversal', () => {
    expect(isSafePath('..%2f..%2fetc%2fpasswd', baseDir)).toBe(false)
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(isSafePath('src\\components\\file.ts', baseDir)).toBe(true)
  })

  it('rejects backslash with parent traversal', () => {
    expect(isSafePath('..\\..\\etc\\passwd', baseDir)).toBe(false)
  })

  it('allows path equal to baseDir', () => {
    expect(isSafePath('', baseDir)).toBe(true)
  })

  it('allows a path with a dot prefix', () => {
    expect(isSafePath('.env', baseDir)).toBe(true)
  })

  it('returns false for baseDir mismatch', () => {
    const result = isSafePath('src/../../other', baseDir)
    expect(result).toBe(false)
  })
})
