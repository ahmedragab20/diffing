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
}))

vi.mock('../settings.js', () => ({
  loadSettings: mockLoadSettings,
  saveSettings: mockSaveSettings,
}))

vi.mock('../path.js', () => ({
  isSafePath: mockIsSafePath,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, readFile: vi.fn() }
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
})
