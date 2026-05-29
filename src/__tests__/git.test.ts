// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockExecFileSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockIsSafePath = vi.fn()
const mockParseEditorConfig = vi.fn()

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: mockExecFileSync }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: mockReadFileSync }
})

vi.mock('../lib/path.js', () => ({ isSafePath: mockIsSafePath }))
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
      expect(dir).toContain('.diffit')
      expect(dir).toContain('my-repo-')
    })

    it('respects customRepoRoot when provided', async () => {
      const { getProjectStorageDir } = await import('../lib/git.js')
      const dir = getProjectStorageDir('/custom/path/some-repo')
      expect(dir).toContain('.diffit')
      expect(dir).toContain('some-repo-')
    })
  })
})
