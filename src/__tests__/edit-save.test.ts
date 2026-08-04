// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Hono } from 'hono'
import type { CommentStore } from '../lib/comments.js'

// --- Mocked modules (hoisted vi.mock factories, per server.test.ts pattern) ---

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
const mockToSafeRelativePath = vi.fn((filePath: string) => filePath)
const mockGetRepoRoot = vi.fn()
const mockGetProjectStorageDir = vi.fn()

const mockGetGitDiffAsync = vi.fn()
const mockGetCustomGitDiffAsync = vi.fn()
const mockGetRepoRootAsync = vi.fn()
const mockGetBranchNameAsync = vi.fn()
const mockGetRepoMetadataAsync = vi.fn()
const mockGetUntrackedFilePathsAsync = vi.fn()
const mockGetShowDiff = vi.fn()
const mockGetCommitSeriesSummary = vi.fn()
const mockGetMergeStatus = vi.fn()
const mockGitAddFile = vi.fn()
const mockListRepoFiles = vi.fn()
const mockRevertHunk = vi.fn()
const mockGetHunkHistory = vi.fn()
const mockIsImageFile = vi.fn()

vi.mock('../lib/git.js', () => ({
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
  getRepoMetadataAsync: mockGetRepoMetadataAsync,
  getUntrackedFilePathsAsync: mockGetUntrackedFilePathsAsync,
  getRepoRoot: mockGetRepoRoot,
  getProjectStorageDir: mockGetProjectStorageDir,
  getShowDiff: mockGetShowDiff,
  getCommitSeriesSummary: mockGetCommitSeriesSummary,
  getMergeStatus: mockGetMergeStatus,
  gitAddFile: mockGitAddFile,
  listRepoFiles: mockListRepoFiles,
  revertHunk: mockRevertHunk,
  getHunkHistory: mockGetHunkHistory,
  isImageFile: mockIsImageFile,
}))

vi.mock('../lib/settings.js', () => ({
  loadSettings: mockLoadSettings,
  saveSettings: mockSaveSettings,
}))

vi.mock('../lib/path.js', () => ({
  isSafePath: mockIsSafePath,
  toSafeRelativePath: mockToSafeRelativePath,
}))

// Real fs is used for all disk assertions (atomic write, conflict check,
// temp-file leftovers) — node:fs / node:fs/promises are NOT mocked here.

// --- Comment store with an `update` spy (per gh-pr.test.ts lines 58-100) ---

class MockCommentStore implements CommentStore {
  update = vi.fn(async (_id: string, fields: any) => ({ id: _id, ...fields }))
  async getAll() {
    return []
  }
  async add(c: any) {
    return c
  }
  async remove(_id: string) {
    return false
  }
  async resolveAllOpen() {
    return 0
  }
  async addReply(_commentId: string, _reply: any) {
    return null
  }
  async removeReply(_commentId: string, _replyId: string) {
    return null
  }
  async updateReply(_commentId: string, _replyId: string, _body: string) {
    return null
  }
}

const clientDir = '/tmp/diffing-edit-client'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

function postSave(app: Hono, body: unknown) {
  return app.fetch(new Request('http://localhost/api/edit-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('POST /api/edit-save', () => {
  let app: Hono
  let mockStore: MockCommentStore
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'diffing-edit-'))
    vi.clearAllMocks()
    mockGetRepoRoot.mockReturnValue(repoRoot)
    mockGetProjectStorageDir.mockReturnValue(join(tmpdir(), 'diffing-edit-test-store'))
    mockToSafeRelativePath.mockImplementation((filePath: string) => filePath)
    mockIsSafePath.mockReturnValue(true)
    mockGetRepoName.mockReturnValue('test-repo')
    mockGetBranchName.mockReturnValue('main')
    mockLoadSettings.mockReturnValue({})
    mockSaveSettings.mockImplementation((s: any) => s)
    mockGetTabSizeForFiles.mockReturnValue({})
    mockGetUntrackedFilePaths.mockReturnValue([])
    mockGetGitDiffAsync.mockResolvedValue('')
    mockGetCustomGitDiffAsync.mockResolvedValue('')
    mockGetRepoRootAsync.mockResolvedValue(repoRoot)
    mockGetBranchNameAsync.mockResolvedValue('main')
    mockGetRepoMetadataAsync.mockResolvedValue({ repoName: 'test-repo', branch: 'main' })
    mockGetUntrackedFilePathsAsync.mockResolvedValue([])
    mockGetCommitSeriesSummary.mockResolvedValue({
      commitCount: 0,
      truncated: 0,
      subjects: [],
      authors: [],
      fromDate: '2026-01-01T00:00:00+00:00',
      toDate: '2026-02-01T00:00:00+00:00',
    })
    mockStore = new MockCommentStore()
    const { DEFAULTS } = await import('../lib/diff-options.js')
    const { createApp } = await import('../server.js')
    app = createApp(clientDir, DEFAULTS, mockStore)
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('400 when filePath is missing', async () => {
    const res = await postSave(app, { content: 'hello\n' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing filePath or content' })
  })

  it('400 when content is missing', async () => {
    const res = await postSave(app, { filePath: 'sub/file.txt' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing filePath or content' })
  })

  it('403 in PR mode', async () => {
    const { DEFAULTS } = await import('../lib/diff-options.js')
    const { createApp } = await import('../server.js')
    const prApp = createApp(clientDir, DEFAULTS, mockStore, undefined, undefined, true)
    const res = await postSave(prApp, { filePath: 'sub/file.txt', content: 'hello\n' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Editing is not available in this review scope' })
  })

  it('403 in custom mode (revisions set)', async () => {
    const { DEFAULTS } = await import('../lib/diff-options.js')
    const { createApp } = await import('../server.js')
    const customApp = createApp(clientDir, { ...DEFAULTS, revisions: ['HEAD~1'] }, mockStore)
    const res = await postSave(customApp, { filePath: 'sub/file.txt', content: 'hello\n' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Editing is not available in this review scope' })
  })

  it('403 when toSafeRelativePath returns null', async () => {
    mockToSafeRelativePath.mockReturnValue(null)
    const res = await postSave(app, { filePath: '../etc/passwd', content: 'hello\n' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden file path' })
  })

  it('200 writes atomically: file on disk, hash matches, no temp leftovers', async () => {
    const subDir = join(repoRoot, 'sub')
    mkdirSync(subDir, { recursive: true })
    const content = 'hello\n'

    const res = await postSave(app, { filePath: 'sub/file.txt', content })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.hash).toBe('string')
    expect(body.hash).toBe(sha256(content))

    const diskPath = join(subDir, 'file.txt')
    expect(await readFile(diskPath, 'utf-8')).toBe(content)

    // Temp file never survives: nothing named .diffing-edit-*.tmp remains.
    const entries = readdirSync(repoRoot, { recursive: true })
    expect(entries.filter((e) => String(e).includes('.diffing-edit-'))).toHaveLength(0)
    expect(entries).toContain(join('sub', 'file.txt'))
  })

  it('409 on base-hash conflict leaves the disk file untouched, then 200 with the right hash', async () => {
    const subDir = join(repoRoot, 'sub')
    mkdirSync(subDir, { recursive: true })
    const diskPath = join(subDir, 'file.txt')
    writeFileSync(diskPath, 'original\n')
    const correctHash = sha256('original\n')

    const conflict = await postSave(app, {
      filePath: 'sub/file.txt',
      content: 'clobber\n',
      baseHash: 'wrong-hash',
    })
    expect(conflict.status).toBe(409)
    const conflictBody = await conflict.json()
    expect(conflictBody.conflict).toBe(true)
    expect(conflictBody.error).toContain('changed on disk')
    // Disk is unchanged.
    expect(readFileSync(diskPath, 'utf-8')).toBe('original\n')

    const ok = await postSave(app, {
      filePath: 'sub/file.txt',
      content: 'clobber\n',
      baseHash: correctHash,
    })
    expect(ok.status).toBe(200)
    expect((await ok.json()).ok).toBe(true)
    expect(readFileSync(diskPath, 'utf-8')).toBe('clobber\n')
  })

  it('writes without a conflict check when baseHash is absent', async () => {
    const subDir = join(repoRoot, 'sub')
    mkdirSync(subDir, { recursive: true })
    const diskPath = join(subDir, 'file.txt')
    writeFileSync(diskPath, 'seeded\n')

    const res = await postSave(app, { filePath: 'sub/file.txt', content: 'replaced\n' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(readFileSync(diskPath, 'utf-8')).toBe('replaced\n')
  })

  it('applies anchorUpdates: valid anchors call store.update, invalid anchors are skipped', async () => {
    const res = await postSave(app, {
      filePath: 'f.txt',
      content: 'x\n',
      anchorUpdates: [
        { id: 'a', side: 'additions', lineNumber: 5 },
        { id: 'b', side: 'deletions', lineNumber: 3, startLineNumber: 1 },
        { id: 'no-line' },
        { lineNumber: 9 },
      ],
    })
    expect(res.status).toBe(200)

    expect(mockStore.update).toHaveBeenCalledTimes(2)
    expect(mockStore.update).toHaveBeenNthCalledWith(1, 'a', {
      side: 'additions',
      lineNumber: 5,
      startLineNumber: undefined,
    })
    expect(mockStore.update).toHaveBeenNthCalledWith(2, 'b', {
      side: 'deletions',
      lineNumber: 3,
      startLineNumber: 1,
    })
  })

  it('SSE: broadcasts a `change` event after a successful edit-save', async () => {
    const subDir = join(repoRoot, 'sub')
    mkdirSync(subDir, { recursive: true })

    const res = await app.fetch(new Request('http://localhost/api/live'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No body stream on /api/live')
    const decoder = new TextDecoder()

    const readUntil = (predicate: (chunk: string) => boolean, timeoutMs: number) =>
      new Promise<'match' | 'timeout' | 'done' | 'error'>((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), timeoutMs)
        const pump = async () => {
          try {
            const { done, value } = await reader.read()
            if (done) {
              clearTimeout(timer)
              resolve('done')
              return
            }
            const text = decoder.decode(value, { stream: true })
            if (predicate(text)) {
              clearTimeout(timer)
              resolve('match')
              return
            }
            pump()
          } catch (e) {
            clearTimeout(timer)
            resolve('error')
          }
        }
        pump()
      })

    // Confirm the connection is registered (heartbeat arrives on open).
    const heartbeat = await readUntil((t) => t.includes('event: heartbeat'), 3000)
    expect(heartbeat).toBe('match')

    // Now mutate the watched tree through the API; the repo watcher should
    // broadcast `change` (200ms debounce) shortly after the atomic write.
    const save = await postSave(app, { filePath: 'sub/file.txt', content: 'sse\n' })
    expect(save.status).toBe(200)

    const change = await readUntil((t) => t.includes('event: change'), 3000)
    expect(change).toBe('match')

    await reader.cancel()
  })
})
