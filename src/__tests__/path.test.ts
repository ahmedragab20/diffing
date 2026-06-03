import { describe, it, expect, vi } from 'vitest'
import { isSafePath, toSafeRelativePath } from '../lib/path.js'

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

  it('rejects an absolute path outside baseDir', () => {
    expect(isSafePath('/etc/passwd', baseDir)).toBe(false)
  })

  it('allows an absolute path inside the baseDir', () => {
    expect(isSafePath('/home/user/project/src/index.ts', baseDir)).toBe(true)
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

  describe('toSafeRelativePath', () => {
    it('resolves a safe relative path to itself', () => {
      expect(toSafeRelativePath('src/index.ts', baseDir)).toBe('src/index.ts')
    })

    it('resolves a safe absolute path to a relative path', () => {
      expect(toSafeRelativePath('/home/user/project/src/index.ts', baseDir)).toBe('src/index.ts')
    })

    it('returns null for an absolute path outside baseDir', () => {
      expect(toSafeRelativePath('/etc/passwd', baseDir)).toBeNull()
    })

    it('returns null for parent directory traversal', () => {
      expect(toSafeRelativePath('../etc/passwd', baseDir)).toBeNull()
    })
  })
})

describe('isSafePath on Windows-style paths', () => {
  // Regression test for the bug where every static-file and git endpoint
  // returned 403 on Windows because the safety check hard-coded '/' as the
  // separator. We swap in `path/win32` to simulate Windows path semantics on
  // any host platform.
  it('accepts a child path under a Windows-style baseDir', async () => {
    vi.resetModules()
    vi.doMock('node:path', async () => await import('node:path/win32'))
    try {
      const { isSafePath: isSafeWin } = await import('../lib/path.js')
      expect(isSafeWin('index.html', 'C:\\Users\\foo\\diffing\\client')).toBe(true)
      expect(isSafeWin('assets/app.js', 'C:\\Users\\foo\\diffing\\client')).toBe(true)
    } finally {
      vi.doUnmock('node:path')
      vi.resetModules()
    }
  })

  it('still rejects traversal under a Windows-style baseDir', async () => {
    vi.resetModules()
    vi.doMock('node:path', async () => await import('node:path/win32'))
    try {
      const { isSafePath: isSafeWin } = await import('../lib/path.js')
      expect(isSafeWin('..\\..\\Windows\\System32\\config\\sam', 'C:\\Users\\foo\\diffing\\client')).toBe(false)
      expect(isSafeWin('C:\\Windows\\System32\\config\\sam', 'C:\\Users\\foo\\diffing\\client')).toBe(false)
    } finally {
      vi.doUnmock('node:path')
      vi.resetModules()
    }
  })
})
