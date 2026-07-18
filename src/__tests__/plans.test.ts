// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryPlanStore } from '../lib/plans.js'

function comment(id: string, lineNumber = 1) {
  return { id, lineNumber, lineContent: 'x', body: 'b', status: 'open' as const, createdAt: 0, createdAtPlanVersion: 1, replies: [] }
}

describe('InMemoryPlanStore', () => {
  let store: InMemoryPlanStore

  beforeEach(() => {
    store = new InMemoryPlanStore()
  })

  it('creates a plan with version 1 and pending decision', async () => {
    const plan = await store.upsert({ title: 'P', body: '# P', source: 'cli', model: 'opus' })
    expect(plan.id).toBeTruthy()
    expect(plan.version).toBe(1)
    expect(plan.decision).toBe('pending')
    expect(plan.comments).toEqual([])
    expect(await store.getAll()).toHaveLength(1)
  })

  it('revises an existing plan: bumps version, resets the verdict, keeps the id', async () => {
    const created = await store.upsert({ title: 'P', body: '# P' })
    await store.setDecision(created.id, 'changes-requested', 'fix it')
    const revised = await store.upsert({ id: created.id, title: 'P v2', body: '# P v2' })
    expect(revised.id).toBe(created.id)
    expect(revised.version).toBe(2)
    expect(revised.title).toBe('P v2')
    expect(revised.body).toBe('# P v2')
    expect(revised.decision).toBe('pending')
    expect(revised.decisionComment).toBeUndefined()
    expect(revised.decidedAt).toBeUndefined()
    expect(await store.getAll()).toHaveLength(1) // not duplicated
  })

  it('creates a new plan when upsert id does not exist', async () => {
    const plan = await store.upsert({ id: 'does-not-exist', title: 'P', body: '# P' })
    expect(plan.id).toBe('does-not-exist')
    expect(plan.version).toBe(1)
  })

  it('records a decision', async () => {
    const plan = await store.upsert({ title: 'P', body: '# P' })
    const decided = await store.setDecision(plan.id, 'approved', '  proceed  ')
    expect(decided?.decision).toBe('approved')
    expect(decided?.decisionComment).toBe('proceed')
    expect(decided?.decidedAt).toBeTypeOf('number')
    expect(await store.setDecision('nope', 'approved')).toBeNull()
  })

  it('adds, updates, and removes comments', async () => {
    const plan = await store.upsert({ title: 'P', body: '# P' })
    await store.addComment(plan.id, comment('c1'))
    expect((await store.get(plan.id))?.comments).toHaveLength(1)

    await store.updateComment(plan.id, 'c1', { status: 'resolved', body: 'edited' })
    const after = (await store.get(plan.id))?.comments[0]
    expect(after?.status).toBe('resolved')
    expect(after?.body).toBe('edited')

    await store.removeComment(plan.id, 'c1')
    expect((await store.get(plan.id))?.comments).toHaveLength(0)
  })

  it('returns null when commenting on a missing plan', async () => {
    expect(await store.addComment('nope', comment('c1'))).toBeNull()
    expect(await store.updateComment('nope', 'c1', { body: 'x' })).toBeNull()
  })

  it('adds, edits, and removes replies', async () => {
    const plan = await store.upsert({ title: 'P', body: '# P' })
    await store.addComment(plan.id, comment('c1'))
    await store.addReply(plan.id, 'c1', { id: 'r1', body: 'hi', createdAt: 0, role: 'agent', model: 'opus' })
    expect((await store.get(plan.id))?.comments[0].replies).toHaveLength(1)

    await store.updateReply(plan.id, 'c1', 'r1', 'edited')
    expect((await store.get(plan.id))?.comments[0].replies[0].body).toBe('edited')

    await store.removeReply(plan.id, 'c1', 'r1')
    expect((await store.get(plan.id))?.comments[0].replies).toHaveLength(0)
  })

  it('removes a plan', async () => {
    const plan = await store.upsert({ title: 'P', body: '# P' })
    expect(await store.remove(plan.id)).toBe(true)
    expect(await store.remove(plan.id)).toBe(false)
    expect(await store.getAll()).toHaveLength(0)
  })
})

describe('FilePlanStore source mirror', () => {
  it('writes plan-sources/<id>.md and stamps sourcePath on upsert', async () => {
    const { mkdtempSync, readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { FilePlanStore } = await import('../lib/plans.js')
    const dir = mkdtempSync(join(tmpdir(), 'diffing-plans-'))
    const store = new FilePlanStore(dir)
    const plan = await store.upsert({ title: 'P', body: '# Hello plan\n' })
    expect(plan.sourcePath).toBe(join(dir, 'plan-sources', `${plan.id}.md`))
    expect(existsSync(plan.sourcePath!)).toBe(true)
    expect(readFileSync(plan.sourcePath!, 'utf-8')).toBe('# Hello plan\n')
    const reloaded = await store.get(plan.id)
    expect(reloaded?.sourcePath).toBe(plan.sourcePath)
  })
})
