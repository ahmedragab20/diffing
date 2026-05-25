// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'
import type { CommentStore } from '../comments.js'

const mockGetGitDiff = vi.fn()
const mockGetCustomGitDiff = vi.fn()
const mockGetRepoName = vi.fn()
const mockGetBranchName = vi.fn()
const mockGetFileContent = vi.fn()
const mockGetTabSizeForFiles = vi.fn()
const mockGetUntrackedFilePaths = vi.fn()
const mockLoadSettings = vi.fn()
const mockSaveSettings = vi.fn()
const mockIsSafePath = vi.fn()
const mockGetRepoRoot = vi.fn()
const mockGetProjectStorageDir = vi.fn()

const mockGetGitDiffAsync = vi.fn()
const mockGetCustomGitDiffAsync = vi.fn()
const mockGetRepoRootAsync = vi.fn()
const mockGetBranchNameAsync = vi.fn()
const mockGetUntrackedFilePathsAsync = vi.fn()

vi.mock('../git.js', () => ({
  getGitDiff: mockGetGitDiff,
  getCustomGitDiff: mockGetCustomGitDiff,
  getRepoName: mockGetRepoName,
  getBranchName: mockGetBranchName,
  getFileContent: mockGetFileContent,
  getTabSizeForFiles: mockGetTabSizeForFiles,
  getUntrackedFilePaths: mockGetUntrackedFilePaths,
  getGitDiffAsync: mockGetGitDiffAsync,
  getCustomGitDiffAsync: mockGetCustomGitDiffAsync,
  getRepoRootAsync: mockGetRepoRootAsync,
  getBranchNameAsync: mockGetBranchNameAsync,
  getUntrackedFilePathsAsync: mockGetUntrackedFilePathsAsync,
  getRepoRoot: mockGetRepoRoot,
  getProjectStorageDir: mockGetProjectStorageDir,
}))

vi.mock('../settings.js', () => ({
  loadSettings: mockLoadSettings,
  saveSettings: mockSaveSettings,
}))

vi.mock('../path.js', () => ({
  isSafePath: mockIsSafePath,
}))

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()
const mockReaddir = vi.fn()
const mockStat = vi.fn()
const mockRm = vi.fn()

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
    readdir: mockReaddir,
    stat: mockStat,
    rm: mockRm,
  }
})

const mockExistsSync = vi.fn()
let originalExistsSync: any

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  originalExistsSync = actual.existsSync
  return {
    ...actual,
    existsSync: (path: any) => mockExistsSync(path),
  }
})

const defaultSettings = { staged: true, untracked: true, diffStyle: 'split', defaultTabSize: 4 }

class MockCommentStore implements CommentStore {
  comments: any[] = []
  async getAll() { return this.comments }
  async add(c: any) { this.comments.push(c); return c }
  async update(id: string, fields: any) {
    const c = this.comments.find((x) => x.id === id)
    if (!c) return null
    Object.assign(c, fields)
    return c
  }
  async remove(id: string) {
    const idx = this.comments.findIndex((x) => x.id === id)
    if (idx === -1) return false
    this.comments.splice(idx, 1)
    return true
  }
  async addReply(commentId: string, reply: any) {
    const c = this.comments.find((x) => x.id === commentId)
    if (!c) return null
    c.replies.push(reply)
    return c
  }
}

describe('server', () => {
  let app: Hono
  let mockStore: MockCommentStore
  const clientDir = '/tmp/test-client'

  beforeEach(() => {
    vi.clearAllMocks()
    mockStore = new MockCommentStore()
    mockGetRepoName.mockReturnValue('test-repo')
    mockGetBranchName.mockReturnValue('main')
    mockLoadSettings.mockReturnValue(defaultSettings)
    mockSaveSettings.mockImplementation((s) => ({ ...defaultSettings, ...s }))
    mockGetTabSizeForFiles.mockReturnValue({})
    mockGetUntrackedFilePaths.mockReturnValue([])
    mockIsSafePath.mockReturnValue(true)
    mockGetProjectStorageDir.mockReturnValue('/tmp/test-project-storage')
    mockGetRepoRoot.mockReturnValue('/tmp/test-repo')
    mockExistsSync.mockImplementation((p) => originalExistsSync(p))

    // Setup async mocks
    mockGetRepoRootAsync.mockResolvedValue('/tmp/test-repo')
    mockGetBranchNameAsync.mockResolvedValue('main')
    mockGetUntrackedFilePathsAsync.mockResolvedValue([])
    mockGetGitDiffAsync.mockResolvedValue('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n')
    mockGetCustomGitDiffAsync.mockResolvedValue('custom')
  })

  describe('createApp', () => {
    beforeEach(async () => {
      const { createApp } = await import('../server.js')
      app = createApp(clientDir, undefined, mockStore)
    })

    describe('GET /api/diff', () => {
      it('returns diff with repo metadata', async () => {
        mockGetGitDiffAsync.mockResolvedValue('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n')
        const res = await app.fetch(new Request('http://localhost/api/diff?staged=true&untracked=true'))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.patch).toContain('diff --git')
        expect(body.repoName).toBe('test-repo')
        expect(body.branch).toBe('main')
        expect(body.customMode).toBe(false)
      })

      it('forwards staged/untracked params', async () => {
        mockGetGitDiffAsync.mockResolvedValue('')
        await app.fetch(new Request('http://localhost/api/diff?staged=false&untracked=false'))
        expect(mockGetGitDiffAsync).toHaveBeenCalledWith({ staged: false, untracked: false })
      })

      it('uses custom diff in custom mode', async () => {
        const { createApp } = await import('../server.js')
        const custom = createApp(clientDir, ['HEAD~3'], mockStore)
        mockGetCustomGitDiffAsync.mockResolvedValue('custom')
        mockGetRepoRootAsync.mockResolvedValue('/tmp/test')
        mockGetBranchNameAsync.mockResolvedValue('main')

        const res = await custom.fetch(new Request('http://localhost/api/diff'))
        const body = await res.json()
        expect(body.customMode).toBe(true)
        expect(mockGetCustomGitDiffAsync).toHaveBeenCalledWith(['HEAD~3'])
      })

      it('detects binary files in patch', async () => {
        mockGetGitDiffAsync.mockResolvedValue(
          'diff --git a/img.png b/img.png\nnew file mode 100644\nindex 000..001\nBinary files /dev/null and b/img.png differ\n',
        )
        const res = await app.fetch(new Request('http://localhost/api/diff'))
        const body = await res.json()
        expect(body.binaryFiles).toEqual([{ path: 'img.png', type: 'added' }])
      })
    })

    describe('GET /api/file-content', () => {
      it('returns 400 when params missing', async () => {
        expect((await app.fetch(new Request('http://localhost/api/file-content'))).status).toBe(400)
        expect((await app.fetch(new Request('http://localhost/api/file-content?path=x.ts'))).status).toBe(400)
      })

      it('returns 404 when file not found', async () => {
        mockGetFileContent.mockReturnValue(null)
        const res = await app.fetch(new Request('http://localhost/api/file-content?path=x.ts&version=new'))
        expect(res.status).toBe(404)
      })

      it('returns file with MIME type', async () => {
        mockGetFileContent.mockReturnValue(Buffer.from('content'))
        const res = await app.fetch(new Request('http://localhost/api/file-content?path=app.js&version=new'))
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('application/javascript')
        expect(await res.text()).toBe('content')
      })
    })

    describe('GET /api/settings', () => {
      it('returns current settings', async () => {
        const res = await app.fetch(new Request('http://localhost/api/settings'))
        expect(await res.json()).toEqual(defaultSettings)
      })
    })

    describe('PUT /api/settings', () => {
      it('persists settings', async () => {
        await app.fetch(new Request('http://localhost/api/settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staged: false }),
        }))
        expect(mockSaveSettings).toHaveBeenCalledWith({ staged: false })
      })
    })

    describe('viewed files', () => {
      it('starts empty', async () => {
        expect(await (await app.fetch(new Request('http://localhost/api/viewed'))).json()).toEqual([])
      })

      it('tracks viewed state', async () => {
        await app.fetch(new Request('http://localhost/api/viewed', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: 'src/index.ts', viewed: true }),
        }))
        expect(await (await app.fetch(new Request('http://localhost/api/viewed'))).json()).toEqual(['src/index.ts'])
      })
    })

    describe('CRUD /api/comments', () => {
      it('POST creates comment with 201', async () => {
        const res = await app.fetch(new Request('http://localhost/api/comments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: 'f.ts', side: 'additions', lineNumber: 1, lineContent: 'x', body: 'nice' }),
        }))
        expect(res.status).toBe(201)
        const body = await res.json()
        expect(body.filePath).toBe('f.ts')
        expect(body.status).toBe('open')
        expect(body.id).toBeDefined()
        expect(body.replies).toEqual([])
      })

      it('PUT updates existing comment', async () => {
        const { createApp } = await import('../server.js')
        const s = new MockCommentStore()
        const a = createApp(clientDir, undefined, s)
        await s.add({ id: 'c1', filePath: 'f.ts', side: 'additions', lineNumber: 1, lineContent: 'x', body: 'orig', status: 'open', createdAt: 0, replies: [] })

        const res = await a.fetch(new Request('http://localhost/api/comments/c1', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'updated', status: 'resolved' }),
        }))
        expect(res.status).toBe(200)
        expect((await res.json()).body).toBe('updated')
      })

      it('PUT returns 404 for missing comment', async () => {
        const res = await app.fetch(new Request('http://localhost/api/comments/no', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'x' }),
        }))
        expect(res.status).toBe(404)
      })

      it('DELETE removes comment', async () => {
        const { createApp } = await import('../server.js')
        const s = new MockCommentStore()
        const a = createApp(clientDir, undefined, s)
        await s.add({ id: 'c1', filePath: 'f.ts', side: 'additions', lineNumber: 1, lineContent: 'x', body: 'x', status: 'open', createdAt: 0, replies: [] })

        expect((await a.fetch(new Request('http://localhost/api/comments/c1', { method: 'DELETE' }))).status).toBe(200)
        expect(await (await a.fetch(new Request('http://localhost/api/comments'))).json()).toEqual([])
      })

      it('DELETE returns 404 for missing', async () => {
        const res = await app.fetch(new Request('http://localhost/api/comments/no', { method: 'DELETE' }))
        expect(res.status).toBe(404)
      })

      it('POST reply to comment', async () => {
        const { createApp } = await import('../server.js')
        const s = new MockCommentStore()
        const a = createApp(clientDir, undefined, s)
        await s.add({ id: 'c1', filePath: 'f.ts', side: 'additions', lineNumber: 1, lineContent: 'x', body: 'x', status: 'open', createdAt: 0, replies: [] })

        const res = await a.fetch(new Request('http://localhost/api/comments/c1/replies', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'reply text' }),
        }))
        expect((await res.json()).replies).toHaveLength(1)
      })

      it('POST reply returns 404 for missing comment', async () => {
        const res = await app.fetch(new Request('http://localhost/api/comments/no/replies', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'x' }),
        }))
        expect(res.status).toBe(404)
      })
    })

    describe('static file serving', () => {
      it('returns 403 for path traversal', async () => {
        mockIsSafePath.mockReturnValue(false)
        const res = await app.fetch(new Request('http://localhost/../etc/passwd'))
        expect(res.status).toBe(403)
      })

      it('falls back to index.html for missing files', async () => {
        const { readFile } = await import('node:fs/promises')
        vi.mocked(readFile)
          .mockRejectedValueOnce(new Error('ENOENT'))
          .mockResolvedValueOnce(Buffer.from('<html>SPA</html>'))
        mockIsSafePath.mockReturnValue(true)
        const res = await app.fetch(new Request('http://localhost/'))
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('text/html')
      })
    })

    describe('GET /api/live', () => {
      it('returns event stream', async () => {
        const res = await app.fetch(new Request('http://localhost/api/live'))
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toContain('text/event-stream')
        expect(res.body).toBeDefined()
        const reader = res.body?.getReader()
        if (reader) {
          await reader.cancel()
        }
      })
    })
    describe('GET /api/attachments/:filename', () => {
      it('serves file with correct MIME type', async () => {
        mockGetProjectStorageDir.mockReturnValue('/tmp/test-project-storage')
        mockReadFile.mockResolvedValue(Buffer.from('my-image-data'))

        const res = await app.fetch(new Request('http://localhost/api/attachments/test-img.png'))
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('image/png')
        expect(await res.text()).toBe('my-image-data')
      })

      it('returns 403 on path traversal attempt', async () => {
        mockGetProjectStorageDir.mockReturnValue('/tmp/test-project-storage')
        const res = await app.fetch(new Request('http://localhost/api/attachments/..%2F..%2Fetc%2Fpasswd'))
        expect(res.status).toBe(403)
      })

      it('returns 404 if file reading fails', async () => {
        mockGetProjectStorageDir.mockReturnValue('/tmp/test-project-storage')
        mockReadFile.mockRejectedValue(new Error('ENOENT'))
        const res = await app.fetch(new Request('http://localhost/api/attachments/missing.png'))
        expect(res.status).toBe(404)
      })
    })

    describe('POST /api/attachments', () => {
      it('saves pasted/uploaded image', async () => {
        mockGetProjectStorageDir.mockReturnValue('/tmp/test-project-storage')
        mockGetRepoRoot.mockReturnValue('/tmp/test-repo')
        mockMkdir.mockResolvedValue(undefined)
        mockWriteFile.mockResolvedValue(undefined)

        const formData = new FormData()
        formData.append('file', new File(['content'], 'screenshot.png', { type: 'image/png' }))

        const res = await app.fetch(new Request('http://localhost/api/attachments', {
          method: 'POST',
          body: formData,
        }))

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.url).toContain('/api/attachments/pasted_image_')
        expect(mockMkdir).toHaveBeenCalledWith('/tmp/test-project-storage/attachments', { recursive: true })
        expect(mockWriteFile).toHaveBeenCalledWith('/tmp/test-project-storage/repo_path.txt', '/tmp/test-repo', 'utf-8')
      })

      it('returns 400 if no file uploaded', async () => {
        const res = await app.fetch(new Request('http://localhost/api/attachments', {
          method: 'POST',
          body: new FormData(),
        }))
        expect(res.status).toBe(400)
      })
    })
  })

  describe('parseBinaryFiles', () => {
    it('classifies added binary', async () => {
      mockGetGitDiffAsync.mockResolvedValue(
        'diff --git a/i.png b/i.png\nnew file mode 100644\nBinary files /dev/null and b/i.png differ\n',
      )
      const res = await app.fetch(new Request('http://localhost/api/diff'))
      expect((await res.json()).binaryFiles[0].type).toBe('added')
    })

    it('classifies deleted binary', async () => {
      mockGetGitDiffAsync.mockResolvedValue(
        'diff --git a/i.png b/i.png\ndeleted file mode 100644\nBinary files a/i.png and /dev/null differ\n',
      )
      const res = await app.fetch(new Request('http://localhost/api/diff'))
      expect((await res.json()).binaryFiles[0].type).toBe('deleted')
    })

    it('classifies untracked binary', async () => {
      mockGetGitDiffAsync.mockResolvedValue(
        'diff --git a/n.png b/n.png\nnew file mode 100644\nBinary files /dev/null and b/n.png differ\n',
      )
      mockGetUntrackedFilePathsAsync.mockResolvedValue(['n.png'])
      const res = await app.fetch(new Request('http://localhost/api/diff?staged=true&untracked=true'))
      expect((await res.json()).binaryFiles[0].type).toBe('untracked')
    })
  })

  describe('cleanupStaleProjects', () => {
    it('deletes project directory when the original repository no longer exists (dead project)', async () => {
      const { cleanupStaleProjects } = await import('../server.js')

      // Mock base directory existence
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('.diffit')) return true
        if (p.endsWith('repo_path.txt')) return true
        if (p.endsWith('comments.json')) return false
        if (p === '/tmp/deleted-repo') return false // original repo is deleted!
        return false
      })

      mockReaddir.mockResolvedValue([
        { name: 'dead-repo-hash', isDirectory: () => true },
      ] as any)

      mockReadFile.mockImplementation(async (p: string) => {
        if (p.endsWith('repo_path.txt')) {
          return '/tmp/deleted-repo'
        }
        throw new Error('ENOENT')
      })

      await cleanupStaleProjects()

      expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('dead-repo-hash'), {
        recursive: true,
        force: true,
      })
    })

    it('deletes project directory when comments.json has not been modified for 14 days (stale project)', async () => {
      const { cleanupStaleProjects } = await import('../server.js')

      // Mock base directory and file existence
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('.diffit')) return true
        if (p.endsWith('repo_path.txt')) return true
        if (p.endsWith('comments.json')) return true
        if (p === '/tmp/active-repo') return true // original repo still exists!
        return false
      })

      mockReaddir.mockResolvedValue([
        { name: 'stale-repo-hash', isDirectory: () => true },
      ] as any)

      mockReadFile.mockImplementation(async (p: string) => {
        if (p.endsWith('repo_path.txt')) {
          return '/tmp/active-repo'
        }
        throw new Error('ENOENT')
      })

      // mock stats: last modified 15 days ago
      mockStat.mockResolvedValue({
        mtimeMs: Date.now() - 15 * 24 * 60 * 60 * 1000,
      } as any)

      await cleanupStaleProjects()

      expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('stale-repo-hash'), {
        recursive: true,
        force: true,
      })
    })

    it('keeps project directory when repository exists and comments are fresh', async () => {
      const { cleanupStaleProjects } = await import('../server.js')

      // Reset mockRm calls
      mockRm.mockClear()

      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('.diffit')) return true
        if (p.endsWith('repo_path.txt')) return true
        if (p.endsWith('comments.json')) return true
        if (p === '/tmp/active-repo') return true
        return false
      })

      mockReaddir.mockResolvedValue([
        { name: 'fresh-repo-hash', isDirectory: () => true },
      ] as any)

      mockReadFile.mockImplementation(async (p: string) => {
        if (p.endsWith('repo_path.txt')) {
          return '/tmp/active-repo'
        }
        throw new Error('ENOENT')
      })

      // mock stats: last modified just now
      mockStat.mockResolvedValue({
        mtimeMs: Date.now(),
      } as any)

      await cleanupStaleProjects()

      expect(mockRm).not.toHaveBeenCalled()
    })
  })
})
