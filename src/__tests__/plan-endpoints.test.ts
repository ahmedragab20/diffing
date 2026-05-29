// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'
import type { CommentStore } from '../lib/comments.js'
import { InMemoryPlanStore } from '../lib/plans.js'

// The server module imports git helpers at load time; stub them like server.test.ts.
vi.mock('../lib/git.js', () => ({
  getGitDiff: vi.fn(),
  getCustomGitDiff: vi.fn(),
  getRepoName: vi.fn(() => 'test-repo'),
  getBranchName: vi.fn(() => 'main'),
  getFileContent: vi.fn(),
  getTabSizeForFiles: vi.fn(() => ({})),
  getUntrackedFilePaths: vi.fn(() => []),
  getGitDiffAsync: vi.fn(async () => ''),
  getCustomGitDiffAsync: vi.fn(async () => ''),
  getRepoRootAsync: vi.fn(async () => '/tmp/test-repo'),
  getBranchNameAsync: vi.fn(async () => 'main'),
  getUntrackedFilePathsAsync: vi.fn(async () => []),
  getRepoRoot: vi.fn(() => '/tmp/test-repo'),
  getProjectStorageDir: vi.fn(() => '/tmp/test-project-storage'),
}))

vi.mock('../lib/settings.js', () => ({
  loadSettings: vi.fn(() => ({})),
  saveSettings: vi.fn((s: any) => s),
}))

vi.mock('../lib/path.js', () => ({ isSafePath: vi.fn(() => true) }))

// A no-op comment store so createApp skips the filesystem watcher.
class MockCommentStore implements CommentStore {
  async getAll() { return [] }
  async add(c: any) { return c }
  async update() { return null }
  async remove() { return false }
  async addReply() { return null }
  async removeReply() { return null }
  async updateReply() { return null }
}

const clientDir = '/tmp/test-client'

async function makeApp(planStore: InMemoryPlanStore): Promise<Hono> {
  const { createApp } = await import('../server.js')
  const { DEFAULTS } = await import('../lib/diff-options.js')
  return createApp(clientDir, DEFAULTS, new MockCommentStore(), planStore)
}

const PLAN_BODY = '# Title\n\n## Phase 1\nDo the first thing\n'

async function postPlan(app: Hono, body: Record<string, unknown>) {
  return app.fetch(new Request('http://localhost/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('plan endpoints', () => {
  let app: Hono
  let store: InMemoryPlanStore

  beforeEach(async () => {
    vi.clearAllMocks()
    store = new InMemoryPlanStore()
    app = await makeApp(store)
  })

  it('GET /api/plans starts empty', async () => {
    expect(await (await app.fetch(new Request('http://localhost/api/plans'))).json()).toEqual([])
  })

  it('POST /api/plans creates a plan (201)', async () => {
    const res = await postPlan(app, { title: 'P', body: PLAN_BODY, source: 'cli', model: 'opus' })
    expect(res.status).toBe(201)
    const plan = await res.json()
    expect(plan.title).toBe('P')
    expect(plan.version).toBe(1)
    expect(plan.decision).toBe('pending')
    expect(plan.id).toBeDefined()
  })

  it('POST /api/plans requires a body', async () => {
    expect((await postPlan(app, { title: 'P' })).status).toBe(400)
    expect((await postPlan(app, { title: 'P', body: '   ' })).status).toBe(400)
  })

  it('POST /api/plans with an existing id revises (version bump, pending)', async () => {
    const first = await (await postPlan(app, { title: 'P', body: PLAN_BODY })).json()
    await app.fetch(new Request(`http://localhost/api/plans/${first.id}/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    }))
    const revised = await (await postPlan(app, { id: first.id, title: 'P2', body: PLAN_BODY + 'more\n' })).json()
    expect(revised.id).toBe(first.id)
    expect(revised.version).toBe(2)
    expect(revised.decision).toBe('pending')
    expect(await store.getAll()).toHaveLength(1)
  })

  it('GET /api/plans/:id returns the plan or 404', async () => {
    const plan = await (await postPlan(app, { title: 'P', body: PLAN_BODY })).json()
    expect((await app.fetch(new Request(`http://localhost/api/plans/${plan.id}`))).status).toBe(200)
    expect((await app.fetch(new Request('http://localhost/api/plans/nope'))).status).toBe(404)
  })

  it('POST comment auto-derives section title and line content from the body', async () => {
    const plan = await (await postPlan(app, { title: 'P', body: PLAN_BODY })).json()
    const res = await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineNumber: 4, body: 'Clarify' }),
    }))
    expect(res.status).toBe(201)
    const updated = await res.json()
    const comment = updated.comments[0]
    expect(comment.sectionTitle).toBe('Phase 1')
    expect(comment.lineContent).toBe('Do the first thing')
    expect(comment.status).toBe('open')
  })

  it('POST comment to a missing plan returns 404', async () => {
    const res = await app.fetch(new Request('http://localhost/api/plans/nope/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineNumber: 1, body: 'x' }),
    }))
    expect(res.status).toBe(404)
  })

  it('updates / deletes comments and manages replies', async () => {
    const plan = await (await postPlan(app, { title: 'P', body: PLAN_BODY })).json()
    const withComment = await (await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineNumber: 4, body: 'Clarify' }),
    }))).json()
    const cid = withComment.comments[0].id

    // resolve
    const resolved = await (await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/comments/${cid}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    }))).json()
    expect(resolved.comments[0].status).toBe('resolved')

    // reply (model => agent role)
    const replied = await (await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/comments/${cid}/replies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Done', model: 'opus' }),
    }))).json()
    expect(replied.comments[0].replies[0].role).toBe('agent')
    expect(replied.comments[0].replies[0].model).toBe('opus')
    const rid = replied.comments[0].replies[0].id

    // delete reply
    const afterDelReply = await (await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/comments/${cid}/replies/${rid}`, { method: 'DELETE' }))).json()
    expect(afterDelReply.comments[0].replies).toHaveLength(0)

    // delete comment
    const afterDel = await (await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/comments/${cid}`, { method: 'DELETE' }))).json()
    expect(afterDel.comments).toHaveLength(0)
  })

  describe('decision handoff /api/plans/:id/decision + /api/plan-review/*', () => {
    it('rejects an invalid decision', async () => {
      const plan = await (await postPlan(app, { title: 'P', body: PLAN_BODY })).json()
      const res = await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'maybe' }),
      }))
      expect(res.status).toBe(400)
    })

    it('returns 404 for a decision on a missing plan', async () => {
      const res = await app.fetch(new Request('http://localhost/api/plans/nope/decision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }))
      expect(res.status).toBe(404)
    })

    it('records the verdict, reports the open-comment count, and bumps the round', async () => {
      const plan = await (await postPlan(app, { title: 'P', body: PLAN_BODY })).json()
      await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineNumber: 4, body: 'Clarify' }),
      }))
      const res = await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'changes-requested', decisionComment: 'tweak it' }),
      }))
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, round: 1, decision: 'changes-requested', openCommentCount: 1 })
      expect((await store.get(plan.id))?.decision).toBe('changes-requested')
    })

    it('GET /api/plan-review/status starts at round 0; await times out to keep-waiting', async () => {
      expect(await (await app.fetch(new Request('http://localhost/api/plan-review/status'))).json()).toEqual({ round: 0, waiters: 0, lastDecidedAt: null })
      const res = await app.fetch(new Request('http://localhost/api/plan-review/await?timeoutMs=1000'))
      expect(await res.json()).toEqual({ status: 'keep-waiting', round: 0 })
    })

    it('releases a blocked await when a decision arrives', async () => {
      const plan = await (await postPlan(app, { title: 'P', body: PLAN_BODY })).json()
      const pending = app.fetch(new Request('http://localhost/api/plan-review/await?timeoutMs=5000'))
      await new Promise((r) => setTimeout(r, 10)) // let the await register
      await app.fetch(new Request(`http://localhost/api/plans/${plan.id}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', decisionComment: 'go' }),
      }))
      const result = await (await pending).json()
      expect(result.status).toBe('released')
      expect(result.payload.decision).toBe('approved')
      expect(result.payload.planId).toBe(plan.id)
      expect(result.payload.reviewXml).toContain('<plan-review>')
      expect(result.payload.reviewXml).toContain('decision="approved"')
    })
  })
})
