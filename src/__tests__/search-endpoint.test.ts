// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the native fff-backed search lib so these tests exercise only the HTTP
// routing / dispatch / error-wrapping in server.ts — never the native addon.
// `vi.hoisted` lets the mock factory (which is hoisted above normal code)
// reference these fns safely.
const search = vi.hoisted(() => ({
  searchFiles: vi.fn(),
  searchContent: vi.fn(),
  searchSymbols: vi.fn(),
  searchAll: vi.fn(),
  getSearchStatus: vi.fn(),
  trackSelection: vi.fn(),
}))

vi.mock('../lib/search.js', () => search)

// Pure-literal git mock so createApp's construction is inert. getRepoRoot
// returns a non-existent path; the repo watcher's error is swallowed by the
// try/catch in createApp, which is exactly what we want for a unit test.
vi.mock('../lib/git.js', () => ({
  getRepoRoot: () => '/tmp/__diffit_search_test__',
  getProjectStorageDir: () => '/tmp/__diffit_search_test__',
  getFileContent: () => null,
  isImageFile: () => false,
  getMergeStatus: () => ({}),
  gitAddFile: () => {},
  listRepoFiles: () => [],
  revertHunk: () => {},
}))

import { createApp } from '../server.js'
import { InMemoryCommentStore } from '../lib/comments.js'

function makeApp() {
  return createApp('/tmp/__diffit_search_test__', undefined, new InMemoryCommentStore())
}

function postSearch(app: ReturnType<typeof makeApp>, body: unknown) {
  return app.request('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dispatches the files scope', async () => {
    search.searchFiles.mockResolvedValue({ scope: 'files', items: [{ path: 'a.ts' }], total: 1, indexing: false })
    const res = await postSearch(makeApp(), { scope: 'files', query: 'a' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.scope).toBe('files')
    expect(json.items[0].path).toBe('a.ts')
    expect(search.searchFiles).toHaveBeenCalledWith('a', { limit: undefined, paths: undefined })
  })

  it('forwards regex + limit to the text scope', async () => {
    search.searchContent.mockResolvedValue({ scope: 'text', items: [], total: 0, indexing: false })
    await postSearch(makeApp(), { scope: 'text', query: 'foo', regex: true, limit: 10 })
    expect(search.searchContent).toHaveBeenCalledWith('foo', { limit: 10, regex: true, paths: undefined })
  })

  it('forwards queries to searchAll for all scope', async () => {
    search.searchAll.mockResolvedValue({ scope: 'all', items: [], total: 0, indexing: false })
    await postSearch(makeApp(), { scope: 'all', query: 'bar', limit: 15 })
    expect(search.searchAll).toHaveBeenCalledWith('bar', { limit: 15, regex: false, paths: undefined })
  })

  it('passes changedPaths through for the Changed-only mode', async () => {
    search.searchSymbols.mockResolvedValue({ scope: 'symbols', items: [], total: 0, indexing: false })
    await postSearch(makeApp(), { scope: 'symbols', query: 'x', changedPaths: ['a.ts', 'b.ts'] })
    expect(search.searchSymbols).toHaveBeenCalledWith('x', { limit: undefined, paths: ['a.ts', 'b.ts'] })
  })

  it('defaults to the files scope when none is given', async () => {
    search.searchFiles.mockResolvedValue({ scope: 'files', items: [], total: 0, indexing: false })
    await postSearch(makeApp(), { query: '' })
    expect(search.searchFiles).toHaveBeenCalled()
  })

  it('surfaces an engine error in the body without a 5xx crash', async () => {
    search.searchFiles.mockResolvedValue({ scope: 'files', items: [], total: 0, indexing: false, error: 'Search unavailable' })
    const res = await postSearch(makeApp(), { scope: 'files', query: 'a' })
    expect(res.status).toBe(200)
    expect((await res.json()).error).toBe('Search unavailable')
  })

  it('wraps a thrown error as a 500 with an error body', async () => {
    search.searchContent.mockRejectedValue(new Error('boom'))
    const res = await postSearch(makeApp(), { scope: 'text', query: 'a' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })
})

describe('GET /api/search/status', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the engine status', async () => {
    search.getSearchStatus.mockResolvedValue({ available: true, indexing: false, indexedFiles: 5 })
    const res = await makeApp().request('/api/search/status')
    expect((await res.json()).indexedFiles).toBe(5)
  })
})

describe('POST /api/search/track', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards the selected path to the frecency tracker', async () => {
    await makeApp().request('/api/search/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'q', path: 'a.ts' }),
    })
    expect(search.trackSelection).toHaveBeenCalledWith('q', 'a.ts')
  })

  it('is a no-op when no path is given', async () => {
    await makeApp().request('/api/search/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'q' }),
    })
    expect(search.trackSelection).not.toHaveBeenCalled()
  })
})
