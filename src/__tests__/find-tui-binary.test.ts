// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockExistsSync = vi.fn()
const mockExecFileSync = vi.fn()

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: mockExistsSync }
})
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: mockExecFileSync }
})

// Stand-in caller URL so the resolved candidate paths are stable across
// machines. The test only cares about the *shape* of the returned path
// (does it end in `target/release/diffing-tui.exe`?), not the absolute
// prefix that the host's CWD happens to produce.
const FAKE_CLI_URL = 'file:///fake/repo/dist/cli.mjs'

describe('findTuiBinary', () => {
  // The candidate list is order-sensitive: development builds should win
  // over a stale `bin/` artefact, and a PATH lookup is a last-resort fallback.
  // These tests pin down both the per-platform extension *and* the search
  // order, which together make the difference between a working TUI on a
  // contributor's Windows machine and a confusing "TUI binary not found".

  const originalPlatform = process.platform

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    // By default, nothing exists — each test opts in to the candidate it
    // cares about so we can assert which path findTuiBinary actually returned.
    mockExistsSync.mockReturnValue(false)
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not on PATH')
    })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
  })

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true })
  }

  it('finds the production sibling `dist/diffing-tui` on POSIX', async () => {
    setPlatform('linux')
    mockExistsSync.mockImplementation((p: string) =>
      p === '/fake/repo/dist/diffing-tui',
    )
    const { findTuiBinary } = await import('../lib/find-tui-binary.js')
    expect(findTuiBinary(FAKE_CLI_URL)).toBe('/fake/repo/dist/diffing-tui')
  })

  it('finds `diffing-tui.exe` on Windows', async () => {
    setPlatform('win32')
    mockExistsSync.mockImplementation((p: string) => p.endsWith('diffing-tui.exe'))
    const { findTuiBinary } = await import('../lib/find-tui-binary.js')
    const found = findTuiBinary(FAKE_CLI_URL)
    expect(found).not.toBeNull()
    expect(found).toMatch(/diffing-tui\.exe$/)
  })

  it('falls back to `target/release/diffing-tui` when no dist binary exists', async () => {
    setPlatform('linux')
    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith('/target/release/diffing-tui'),
    )
    const { findTuiBinary } = await import('../lib/find-tui-binary.js')
    const found = findTuiBinary(FAKE_CLI_URL)
    expect(found).toMatch(/target\/release\/diffing-tui$/)
  })

  it('falls back to `target/debug/diffing-tui` for `cargo build` (no --release)', async () => {
    // Regression test for the contributor-experience fix: `cargo build`
    // (without --release) is enough to iterate on the TUI. Before this
    // change `findTuiBinary` only looked under `target/release/` and
    // silently said "TUI not built" even though the debug binary was right
    // there on disk.
    setPlatform('linux')
    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith('/target/debug/diffing-tui'),
    )
    const { findTuiBinary } = await import('../lib/find-tui-binary.js')
    expect(findTuiBinary(FAKE_CLI_URL)).toMatch(/target\/debug\/diffing-tui$/)
  })

  it('falls back to `target/debug/diffing-tui.exe` on Windows debug builds', async () => {
    setPlatform('win32')
    mockExistsSync.mockImplementation(
      (p: string) =>
        p.includes('target') && p.includes('debug') && p.endsWith('diffing-tui.exe'),
    )
    const { findTuiBinary } = await import('../lib/find-tui-binary.js')
    expect(findTuiBinary(FAKE_CLI_URL)).toMatch(/diffing-tui\.exe$/)
  })

  it('prefers release over debug when both are present', async () => {
    setPlatform('linux')
    mockExistsSync.mockImplementation(
      (p: string) =>
        p.endsWith('/target/release/diffing-tui') ||
        p.endsWith('/target/debug/diffing-tui'),
    )
    const { findTuiBinary } = await import('../lib/find-tui-binary.js')
    expect(findTuiBinary(FAKE_CLI_URL)).toMatch(/target\/release\/diffing-tui$/)
  })

  it('returns null when nothing is on disk and PATH lookup fails', async () => {
    setPlatform('linux')
    const { findTuiBinary } = await import('../lib/find-tui-binary.js')
    expect(findTuiBinary(FAKE_CLI_URL)).toBeNull()
  })

  it('uses `where` (not `which`) for the PATH fallback on Windows', async () => {
    setPlatform('win32')
    // Swap `node:path` for `node:path/win32` so `isAbsolute('C:\\...')`
    // returns true even when the test host is POSIX.
    vi.doMock('node:path', async () => await import('node:path/win32'))
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      // Only `where diffing-tui` should be invoked — `which` would be a
      // POSIX-ism that fails on a stock Windows install.
      if (cmd === 'where' && args[0] === 'diffing-tui') {
        return 'C:\\Tools\\diffing-tui.exe\r\n'
      }
      throw new Error('unexpected exec')
    })
    try {
      const { findTuiBinary } = await import('../lib/find-tui-binary.js')
      expect(findTuiBinary(FAKE_CLI_URL)).toBe('C:\\Tools\\diffing-tui.exe')
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'where',
        ['diffing-tui'],
        expect.any(Object),
      )
    } finally {
      vi.doUnmock('node:path')
    }
  })

  it('takes the first line of multi-result PATH output on POSIX', async () => {
    setPlatform('linux')
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'diffing-tui') {
        return '/usr/local/bin/diffing-tui\n/opt/homebrew/bin/diffing-tui\n'
      }
      throw new Error('unexpected exec')
    })
    const { findTuiBinary } = await import('../lib/find-tui-binary.js')
    expect(findTuiBinary(FAKE_CLI_URL)).toBe('/usr/local/bin/diffing-tui')
  })

  it('handles CRLF line endings from `where` on Windows', async () => {
    // `where` separates multiple hits with CRLF. Real-world failure mode
    // from the user's bug report.
    setPlatform('win32')
    vi.doMock('node:path', async () => await import('node:path/win32'))
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'where') {
        return 'C:\\Tools\\diffing-tui.exe\r\nC:\\Other\\diffing-tui.exe\r\n'
      }
      throw new Error('unexpected exec')
    })
    try {
      const { findTuiBinary } = await import('../lib/find-tui-binary.js')
      expect(findTuiBinary(FAKE_CLI_URL)).toBe('C:\\Tools\\diffing-tui.exe')
    } finally {
      vi.doUnmock('node:path')
    }
  })
})
