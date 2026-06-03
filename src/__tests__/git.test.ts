// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockExecFileSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockIsSafePath = vi.fn()
const mockParseEditorConfig = vi.fn()
const mockToSafeRelativePath = vi.fn((filePath) => mockIsSafePath(filePath) ? filePath : null)

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: mockExecFileSync }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: mockReadFileSync }
})

vi.mock('../lib/path.js', () => ({
  isSafePath: mockIsSafePath,
  toSafeRelativePath: mockToSafeRelativePath,
}))
vi.mock('editorconfig', () => ({ parseSync: mockParseEditorConfig }))

describe('git', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    try {
      const { _resetRepoRootCache } = await import('../lib/git.js')
      _resetRepoRootCache()
    } catch {}
  })

  describe('isImageFile', () => {
    it('returns true for common image extensions', async () => {
      const { isImageFile } = await import('../lib/git.js')
      for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif']) {
        expect(isImageFile(`file.${ext}`)).toBe(true)
      }
    })

    it('handles uppercase extensions', async () => {
      const { isImageFile } = await import('../lib/git.js')
      expect(isImageFile('photo.PNG')).toBe(true)
      expect(isImageFile('photo.JPG')).toBe(true)
    })

    it('returns false for non-image extensions', async () => {
      const { isImageFile } = await import('../lib/git.js')
      for (const ext of ['ts', 'jsx', 'css', 'md', 'txt', 'json']) {
        expect(isImageFile(`file.${ext}`)).toBe(false)
      }
    })

    it('returns false for files without extension', async () => {
      const { isImageFile } = await import('../lib/git.js')
      expect(isImageFile('Makefile')).toBe(false)
    })
  })

  describe('isGitRepo', () => {
    it('returns true when execFileSync succeeds', async () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''))
      const { isGitRepo } = await import('../lib/git.js')
      expect(isGitRepo()).toBe(true)
    })

    it('returns false when execFileSync throws', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('not a repo') })
      const { isGitRepo } = await import('../lib/git.js')
      expect(isGitRepo()).toBe(false)
    })
  })

  describe('getRepoRoot', () => {
    it('returns trimmed root path', async () => {
      mockExecFileSync.mockReturnValue('/home/user/project\n')
      const { getRepoRoot } = await import('../lib/git.js')
      expect(getRepoRoot()).toBe('/home/user/project')
    })
  })

  describe('getRepoName', () => {
    it('returns basename', async () => {
      mockExecFileSync.mockReturnValue('/home/user/my-project\n')
      const { getRepoName } = await import('../lib/git.js')
      expect(getRepoName()).toBe('my-project')
    })
  })

  describe('getBranchName', () => {
    it('returns branch on success', async () => {
      mockExecFileSync.mockReturnValue('main\n')
      const { getBranchName } = await import('../lib/git.js')
      expect(getBranchName()).toBe('main')
    })

    it('returns empty string on error', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('error') })
      const { getBranchName } = await import('../lib/git.js')
      expect(getBranchName()).toBe('')
    })
  })

  describe('getCustomGitDiff', () => {
    it('forwards args with DIFF_FLAGS', async () => {
      mockExecFileSync.mockReturnValue('output')
      const { getCustomGitDiff } = await import('../lib/git.js')
      const result = getCustomGitDiff(['HEAD~3', '--', '*.ts'])
      expect(result).toBe('output')
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git', ['diff', '--no-ext-diff', '--no-color', 'HEAD~3', '--', '*.ts'],
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
      )
    })
  })

  describe('getGitDiff', () => {
    it('returns unstaged + staged when both enabled', async () => {
      mockExecFileSync
        .mockReturnValueOnce('unstaged\n')
        .mockReturnValueOnce('staged\n')
      const { getGitDiff } = await import('../lib/git.js')
      expect(getGitDiff({ staged: true, untracked: false })).toBe('unstaged\n\nstaged\n')
    })

    it('skips empty staged section', async () => {
      mockExecFileSync
        .mockReturnValueOnce('unstaged\n')
        .mockReturnValueOnce('')
      const { getGitDiff } = await import('../lib/git.js')
      expect(getGitDiff({ staged: true, untracked: false })).toBe('unstaged\n')
    })

    it('returns only unstaged with no options', async () => {
      mockExecFileSync.mockReturnValueOnce('unstaged diff')
      const { getGitDiff } = await import('../lib/git.js')
      expect(getGitDiff()).toBe('unstaged diff')
    })
  })

  describe('getTabSizeForFiles', () => {
    it('uses tab_width from editorconfig', async () => {
      mockExecFileSync.mockReturnValue('/repo\n')
      mockParseEditorConfig.mockReturnValue({ tab_width: 2, indent_size: 2 })
      const { getTabSizeForFiles } = await import('../lib/git.js')
      expect(getTabSizeForFiles(['src/index.ts'])).toEqual({ 'src/index.ts': 2 })
    })

    it('falls back to indent_size', async () => {
      mockExecFileSync.mockReturnValue('/repo\n')
      mockParseEditorConfig.mockReturnValue({ indent_size: 4 })
      const { getTabSizeForFiles } = await import('../lib/git.js')
      expect(getTabSizeForFiles(['src/index.ts'])).toEqual({ 'src/index.ts': 4 })
    })

    it('skips files on error', async () => {
      mockExecFileSync.mockReturnValue('/repo\n')
      mockParseEditorConfig.mockImplementation(() => { throw new Error('fail') })
      const { getTabSizeForFiles } = await import('../lib/git.js')
      expect(getTabSizeForFiles(['src/index.ts'])).toEqual({})
    })
  })

  describe('getUntrackedFilePaths', () => {
    it('splits output by newline', async () => {
      mockExecFileSync.mockReturnValue('a.ts\nb.ts\n')
      const { getUntrackedFilePaths } = await import('../lib/git.js')
      expect(getUntrackedFilePaths()).toEqual(['a.ts', 'b.ts'])
    })

    it('returns empty array for empty output', async () => {
      mockExecFileSync.mockReturnValue('')
      const { getUntrackedFilePaths } = await import('../lib/git.js')
      expect(getUntrackedFilePaths()).toEqual([])
    })
  })

  describe('getFileContent', () => {
    it('returns null for unsafe path', async () => {
      mockIsSafePath.mockReturnValue(false)
      mockExecFileSync.mockReturnValue('/repo\n')
      const { getFileContent } = await import('../lib/git.js')
      expect(getFileContent('../etc/passwd', 'new')).toBeNull()
    })

    it('reads file from disk for new version', async () => {
      mockIsSafePath.mockReturnValue(true)
      mockExecFileSync.mockReturnValue('/repo\n')
      mockReadFileSync.mockReturnValue(Buffer.from('file content'))
      const { getFileContent } = await import('../lib/git.js')
      expect(getFileContent('src/index.ts', 'new')).toEqual(Buffer.from('file content'))
    })

    it('returns null when new file missing', async () => {
      mockIsSafePath.mockReturnValue(true)
      mockExecFileSync.mockReturnValue('/repo\n')
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT') })
      const { getFileContent } = await import('../lib/git.js')
      expect(getFileContent('src/index.ts', 'new')).toBeNull()
    })

    it('reads file from git for old version', async () => {
      mockIsSafePath.mockReturnValue(true)
      mockExecFileSync
        .mockReturnValueOnce('/repo\n')
        .mockReturnValueOnce(Buffer.from('old content'))
      const { getFileContent } = await import('../lib/git.js')
      expect(getFileContent('src/index.ts', 'old')).toEqual(Buffer.from('old content'))
    })

    it('returns null when old file missing', async () => {
      mockIsSafePath.mockReturnValue(true)
      mockExecFileSync
        .mockReturnValueOnce('/repo\n')
        .mockImplementationOnce(() => { throw new Error('fatal') })
      const { getFileContent } = await import('../lib/git.js')
      expect(getFileContent('newfile.ts', 'old')).toBeNull()
    })
  })

  describe('getProjectStorageDir', () => {
    it('returns correct path format under homedir', async () => {
      mockExecFileSync.mockReturnValue('/Users/user/projects/my-repo\n')
      const { getProjectStorageDir } = await import('../lib/git.js')
      const dir = getProjectStorageDir()
      expect(dir).toContain('.diffing')
      expect(dir).toContain('my-repo-')
    })

    it('respects customRepoRoot when provided', async () => {
      const { getProjectStorageDir } = await import('../lib/git.js')
      const dir = getProjectStorageDir('/custom/path/some-repo')
      expect(dir).toContain('.diffing')
      expect(dir).toContain('some-repo-')
    })
  })

  describe('getFilePatch — CRLF handling', () => {
    // The untracked-file synthesizer reads the file from disk and emits one
    // `+line` per source line. Before the fix it split on a literal `'\n'`,
    // which on Windows left a trailing `\r` on every line and inflated the
    // hunk header's line count when the file ended in CRLF.

    it('strips trailing CR from CRLF-terminated untracked file', async () => {
      mockIsSafePath.mockReturnValue(true)
      mockExecFileSync
        .mockReturnValueOnce('') // `git diff` -> no output (untracked)
        .mockReturnValueOnce('/repo\n') // getRepoRoot inside the untracked branch
      mockReadFileSync.mockImplementation((p: string) =>
        p === '/repo/new-windows-file.ts'
          ? 'line one\r\nline two\r\nline three\r\n'
          : Buffer.from(''),
      )
      const { getFilePatch } = await import('../lib/git.js')
      const patch = getFilePatch('new-windows-file.ts')

      // No stray \r at the end of any added line.
      for (const line of patch.split('\n').filter(l => l.startsWith('+'))) {
        expect(line.endsWith('\r')).toBe(false)
      }

      // The header should match the actual line count after CRLF-aware split:
      // ["line one", "line two", "line three", ""] → 4 elements.
      expect(patch).toContain('@@ -0,0 +1,4 @@')
      expect(patch).toContain('+line one')
      expect(patch).toContain('+line two')
      expect(patch).toContain('+line three')
    })

    it('handles plain LF file unchanged', async () => {
      mockIsSafePath.mockReturnValue(true)
      mockExecFileSync
        .mockReturnValueOnce('')
        .mockReturnValueOnce('/repo\n')
      mockReadFileSync.mockImplementation((p: string) =>
        p === '/repo/posix-file.ts' ? 'a\nb\nc\n' : Buffer.from(''),
      )
      const { getFilePatch } = await import('../lib/git.js')
      const patch = getFilePatch('posix-file.ts')

      expect(patch).toContain('@@ -0,0 +1,4 @@')
      expect(patch).toContain('+a\n+b\n+c\n+')
    })

    it('handles legacy CR-only line endings', async () => {
      // Classic Mac line endings — vanishingly rare but legal, and a stray
      // \r in the middle of the diff stream would corrupt the UI just like
      // CRLF does.
      mockIsSafePath.mockReturnValue(true)
      mockExecFileSync
        .mockReturnValueOnce('')
        .mockReturnValueOnce('/repo\n')
      mockReadFileSync.mockImplementation((p: string) =>
        p === '/repo/classic-mac.txt' ? 'foo\rbar\rbaz' : Buffer.from(''),
      )
      const { getFilePatch } = await import('../lib/git.js')
      const patch = getFilePatch('classic-mac.txt')

      expect(patch).toContain('@@ -0,0 +1,3 @@')
      expect(patch).toContain('+foo')
      expect(patch).toContain('+bar')
      expect(patch).toContain('+baz')
      // No stray \r anywhere in the synthesized output.
      expect(patch.includes('\r')).toBe(false)
    })

    it('handles mixed CRLF/LF in one file', async () => {
      mockIsSafePath.mockReturnValue(true)
      mockExecFileSync
        .mockReturnValueOnce('')
        .mockReturnValueOnce('/repo\n')
      mockReadFileSync.mockImplementation((p: string) =>
        p === '/repo/mixed.txt' ? 'win\r\nposix\nmac\r\n' : Buffer.from(''),
      )
      const { getFilePatch } = await import('../lib/git.js')
      const patch = getFilePatch('mixed.txt')

      expect(patch).toContain('+win')
      expect(patch).toContain('+posix')
      expect(patch).toContain('+mac')
      expect(patch.includes('\r')).toBe(false)
    })
  })
})
