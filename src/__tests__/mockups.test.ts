// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryMockupStore } from '../lib/mockups.js'
import type { MockupComment } from '../lib/mockup-types.js'

function comment(id: string): MockupComment {
  return {
    id,
    screenId: 'main',
    kind: 'block',
    selector: '.x',
    body: 'b',
    status: 'open',
    createdAt: 0,
    createdAtMockupVersion: 1,
    replies: [],
  }
}

function screens() {
  return [{ id: 'main', label: 'Main', html: '<h1>Hi</h1>' }]
}

describe('InMemoryMockupStore', () => {
  let store: InMemoryMockupStore

  beforeEach(() => {
    store = new InMemoryMockupStore()
  })

  it('creates a mockup with version 1 and pending decision from html-less screens', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    expect(mockup.id).toBeTruthy()
    expect(mockup.version).toBe(1)
    expect(mockup.decision).toBe('pending')
    expect(mockup.comments).toEqual([])
    expect(mockup.screens[0].id).toBe('main')
    expect(mockup.screens[0].html).toBe('<h1>Hi</h1>')
    expect(await store.getAll()).toHaveLength(1)
  })

  it('resubmits the same id: bumps version, resets the decision, keeps the id, not duplicated', async () => {
    const created = await store.upsert({ title: 'M', screens: screens() })
    await store.setDecision(created.id, 'changes-requested', 'fix it')
    const revised = await store.upsert({
      id: created.id,
      title: 'M v2',
      screens: screens(),
    })
    expect(revised.id).toBe(created.id)
    expect(revised.version).toBe(2)
    expect(revised.title).toBe('M v2')
    expect(revised.decision).toBe('pending')
    expect(revised.decisionComment).toBeUndefined()
    expect(revised.decidedAt).toBeUndefined()
    expect(await store.getAll()).toHaveLength(1) // not duplicated
  })

  it('creates a new mockup when upsert id does not exist', async () => {
    const mockup = await store.upsert({
      id: 'does-not-exist',
      title: 'M',
      screens: screens(),
    })
    expect(mockup.id).toBe('does-not-exist')
    expect(mockup.version).toBe(1)
  })

  it('records a decision and trims the comment', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    const decided = await store.setDecision(
      mockup.id,
      'approved',
      '  proceed  ',
    )
    expect(decided?.decision).toBe('approved')
    expect(decided?.decisionComment).toBe('proceed')
    expect(decided?.decidedAt).toBeTypeOf('number')
    expect(await store.setDecision('nope', 'approved')).toBeNull()
  })

  it('adds, updates, and removes comments', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    await store.addComment(mockup.id, comment('c1'))
    expect((await store.get(mockup.id))?.comments).toHaveLength(1)

    await store.updateComment(mockup.id, 'c1', {
      status: 'resolved',
      body: 'edited',
    })
    const after = (await store.get(mockup.id))?.comments[0]
    expect(after?.status).toBe('resolved')
    expect(after?.body).toBe('edited')

    await store.removeComment(mockup.id, 'c1')
    expect((await store.get(mockup.id))?.comments).toHaveLength(0)
  })

  it('returns null when commenting on a missing mockup', async () => {
    expect(await store.addComment('nope', comment('c1'))).toBeNull()
    expect(await store.updateComment('nope', 'c1', { body: 'x' })).toBeNull()
    expect(await store.removeComment('nope', 'c1')).toBeNull()
  })

  it('adds, edits, and removes replies', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    await store.addComment(mockup.id, comment('c1'))
    await store.addReply(mockup.id, 'c1', {
      id: 'r1',
      body: 'hi',
      createdAt: 0,
      role: 'agent',
      model: 'opus',
    })
    expect((await store.get(mockup.id))?.comments[0].replies).toHaveLength(1)

    await store.updateReply(mockup.id, 'c1', 'r1', 'edited')
    expect((await store.get(mockup.id))?.comments[0].replies[0].body).toBe(
      'edited',
    )

    await store.removeReply(mockup.id, 'c1', 'r1')
    expect((await store.get(mockup.id))?.comments[0].replies).toHaveLength(0)
  })

  it('removes a mockup', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    expect(await store.remove(mockup.id)).toBe(true)
    expect(await store.remove(mockup.id)).toBe(false)
    expect(await store.getAll()).toHaveLength(0)
  })
})

describe('InMemoryMockupStore one-screen ops', () => {
  let store: InMemoryMockupStore

  beforeEach(() => {
    store = new InMemoryMockupStore()
  })

  it('upserts a new screen: version bump + snapshot records the new screens', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    const res = await store.upsertScreen(mockup.id, {
      id: 'checkout',
      label: 'Checkout',
      html: '<p>pay</p>',
    })
    expect(res.mockup?.version).toBe(2)
    expect(res.mockup?.screens.map((s) => s.id)).toEqual(['main', 'checkout'])
    expect(res.mockup?.screens[1].label).toBe('Checkout')
    expect(res.mockup?.screens[1].html).toBe('<p>pay</p>')
    const v2 = await store.getVersion(mockup.id, 2)
    expect(v2?.screens.map((s) => s.id)).toEqual(['main', 'checkout'])
  })

  it('upsert replaces an existing screen in place and bumps the version', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    const res = await store.upsertScreen(mockup.id, {
      id: 'main',
      html: '<h1>New</h1>',
    })
    expect(res.mockup?.version).toBe(2)
    const main = res.mockup?.screens.find((s) => s.id === 'main')
    expect(main?.html).toBe('<h1>New</h1>')
    // label is kept when the upsert does not supply one
    expect(main?.label).toBe('Main')
    expect(res.mockup?.screens).toHaveLength(1)
  })

  it('upsertScreen aborts on expectedVersion mismatch without mutating', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    const res = await store.upsertScreen(
      mockup.id,
      { id: 'checkout', html: '<p>x</p>' },
      { expectedVersion: 2 },
    )
    expect(res.mockup).toBeNull()
    expect(res.versionMismatch).toEqual({
      expectedVersion: 2,
      currentVersion: 1,
    })
    const after = await store.get(mockup.id)
    expect(after?.version).toBe(1)
    expect(after?.screens).toHaveLength(1)
  })

  it('upsertScreen on a missing mockup returns an error', async () => {
    const res = await store.upsertScreen('nope', {
      id: 'main',
      html: '<p>x</p>',
    })
    expect(res.mockup).toBeNull()
    expect(res.error).toBe('Mockup not found')
  })

  it('removeScreen deletes the screen and bumps the version', async () => {
    const mockup = await store.upsert({
      title: 'M',
      screens: [
        { id: 'main', label: 'Main', html: '<p>a</p>' },
        { id: 'b', label: 'B', html: '<p>b</p>' },
      ],
    })
    const res = await store.removeScreen(mockup.id, 'b')
    expect(res.mockup?.version).toBe(2)
    expect(res.mockup?.screens.map((s) => s.id)).toEqual(['main'])
    expect(res.mockup?.screens[0].html).toBe('<p>a</p>')
  })

  it('removeScreen rejects removing the last screen', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    const res = await store.removeScreen(mockup.id, 'main')
    expect(res.mockup).toBeNull()
    expect(res.error).toBe('Cannot remove the last screen')
    expect((await store.get(mockup.id))?.version).toBe(1)
  })

  it('removeScreen rejects a missing screen and a version mismatch', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    const missing = await store.removeScreen(mockup.id, 'nope')
    expect(missing.mockup).toBeNull()
    expect(missing.error).toBe('Screen nope not found')
    const vm = await store.removeScreen(mockup.id, 'main', {
      expectedVersion: 5,
    })
    expect(vm.versionMismatch).toEqual({
      expectedVersion: 5,
      currentVersion: 1,
    })
    expect((await store.get(mockup.id))?.screens).toHaveLength(1)
  })

  it('patchScreen replaces the first exact occurrence and reports how many matched', async () => {
    const mockup = await store.upsert({
      title: 'M',
      screens: [
        { id: 'main', label: 'Main', html: '<p>Pay now</p><p>Pay later</p>' },
      ],
    })
    const res = await store.patchScreen(mockup.id, 'main', {
      expectedText: 'Pay',
      replacement: 'Buy',
    })
    expect(res.occurrences).toBe(2)
    expect(res.mockup?.version).toBe(2)
    expect(res.mockup?.screens[0].html).toBe('<p>Buy now</p><p>Pay later</p>')
  })

  it('patchScreen errors never mutate or bump the version', async () => {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    expect(
      (
        await store.patchScreen(mockup.id, 'main', {
          expectedText: 'zzz',
          replacement: 'x',
        })
      ).error,
    ).toBe('Exact text not found')
    expect(
      (
        await store.patchScreen(mockup.id, 'main', {
          expectedText: '',
          replacement: 'x',
        })
      ).error,
    ).toBe('expectedText is required')
    expect(
      (
        await store.patchScreen(mockup.id, 'main', {
          expectedText: '<h1>',
          replacement: undefined as any,
        })
      ).error,
    ).toBe('replacement is required')
    expect(
      (
        await store.patchScreen(mockup.id, 'nope', {
          expectedText: '<h1>',
          replacement: 'x',
        })
      ).error,
    ).toBe('Screen nope not found')
    const vm = await store.patchScreen(
      mockup.id,
      'main',
      { expectedText: '<h1>', replacement: 'x' },
      { expectedVersion: 9 },
    )
    expect(vm.versionMismatch).toEqual({
      expectedVersion: 9,
      currentVersion: 1,
    })
    const after = await store.get(mockup.id)
    expect(after?.version).toBe(1)
    expect(after?.screens[0].html).toBe('<h1>Hi</h1>')
  })
})

describe('InMemoryMockupStore atomic thread batch', () => {
  let store: InMemoryMockupStore

  beforeEach(() => {
    store = new InMemoryMockupStore()
  })

  async function mockupWithComment() {
    const mockup = await store.upsert({ title: 'M', screens: screens() })
    await store.addComment(mockup.id, comment('c1'))
    return mockup
  }

  it('applies every op and never bumps the mockup version', async () => {
    const mockup = await mockupWithComment()
    const res = await store.applyThreadBatch(mockup.id, [
      {
        op: 'reply',
        commentId: 'c1',
        body: 'fixed',
        role: 'agent',
        model: 'opus',
      },
      { op: 'resolve', commentId: 'c1' },
    ])
    expect(res.error).toBeUndefined()
    expect(res.results).toHaveLength(2)
    expect(res.results[0]).toMatchObject({
      op: 'reply',
      commentId: 'c1',
      ok: true,
    })
    expect(res.results[1]).toEqual({ op: 'resolve', commentId: 'c1', ok: true })
    const after = await store.get(mockup.id)
    expect(after?.comments[0].replies).toHaveLength(1)
    expect(after?.comments[0].replies[0].body).toBe('fixed')
    expect(after?.comments[0].replies[0].role).toBe('agent')
    expect(after?.comments[0].status).toBe('resolved')
    expect(after?.version).toBe(1)
  })

  it('validates every op before applying any — one bad op aborts the whole batch', async () => {
    const mockup = await mockupWithComment()
    const res = await store.applyThreadBatch(mockup.id, [
      { op: 'reply', commentId: 'c1', body: 'ok' },
      { op: 'delete', commentId: 'ghost' },
    ])
    expect(res.mockup).toBeNull()
    expect(res.error).toBe('operations[1]: comment ghost not found')
    expect(res.results).toEqual([])
    const after = await store.get(mockup.id)
    expect(after?.comments).toHaveLength(1)
    expect(after?.comments[0].replies).toHaveLength(0)
  })

  it('validates reply targets for edit/delete ops', async () => {
    const mockup = await mockupWithComment()
    const res = await store.applyThreadBatch(mockup.id, [
      { op: 'edit', commentId: 'c1', replyId: 'nope', body: 'x' },
    ])
    expect(res.error).toBe('operations[0]: reply nope not found on comment c1')
    expect(res.results).toEqual([])
  })

  it('supports edit/delete/unresolve across comments and replies', async () => {
    const mockup = await mockupWithComment()
    await store.addReply(mockup.id, 'c1', {
      id: 'r1',
      body: 'old',
      createdAt: 0,
      role: 'user',
    })
    const res = await store.applyThreadBatch(mockup.id, [
      { op: 'edit', commentId: 'c1', body: 'edited body' },
      { op: 'edit', commentId: 'c1', replyId: 'r1', body: 'edited reply' },
      { op: 'delete', commentId: 'c1', replyId: 'r1' },
      { op: 'unresolve', commentId: 'c1' },
    ])
    expect(res.error).toBeUndefined()
    expect(res.results.map((r) => r.op)).toEqual([
      'edit',
      'edit',
      'delete',
      'unresolve',
    ])
    const after = await store.get(mockup.id)
    expect(after?.comments[0].body).toBe('edited body')
    expect(after?.comments[0].replies).toHaveLength(0)
    expect(after?.comments[0].status).toBe('open')
  })

  it('returns an error for a missing mockup', async () => {
    const res = await store.applyThreadBatch('nope', [
      { op: 'resolve', commentId: 'c1' },
    ])
    expect(res.mockup).toBeNull()
    expect(res.error).toBe('Mockup not found')
    expect(res.results).toEqual([])
  })

  it('normalizeThreadOperations validates op shapes with indices', async () => {
    const { normalizeThreadOperations } = await import('../lib/mockups.js')
    expect(normalizeThreadOperations(undefined)).toMatchObject({
      ok: false,
      error: 'operations[] is required',
    })
    expect(normalizeThreadOperations([])).toMatchObject({
      ok: false,
      error: 'operations[] is required',
    })
    expect(
      normalizeThreadOperations([{ op: 'nuke', commentId: 'c1' }]),
    ).toMatchObject({ ok: false, index: 0 })
    expect(
      normalizeThreadOperations([{ op: 'reply', commentId: 'c1', body: '' }]),
    ).toMatchObject({ ok: false, index: 0 })
    expect(
      normalizeThreadOperations([{ op: 'reply', body: 'hi' }]),
    ).toMatchObject({ ok: false, index: 0 })
    const ok = normalizeThreadOperations([
      { op: 'reply', commentId: 'c1', body: 'hi' },
      { op: 'delete', commentId: 'c1', replyId: 'r1' },
    ])
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.ops).toEqual([
        {
          op: 'reply',
          commentId: 'c1',
          body: 'hi',
          role: undefined,
          model: undefined,
        },
        { op: 'delete', commentId: 'c1', replyId: 'r1' },
      ])
    }
  })
})

describe('FileMockupStore source mirror', () => {
  it('writes mockup-sources/<id>/<screen>.html and stamps sourcePath to the dir', async () => {
    const { mkdtempSync, readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { FileMockupStore } = await import('../lib/mockups.js')
    const dir = mkdtempSync(join(tmpdir(), 'diffing-mockups-'))
    const store = new FileMockupStore(dir)
    const mockup = await store.upsert({
      title: 'M',
      screens: [{ id: 'main', label: 'Main', html: '<h1>Hi</h1>' }],
    })
    expect(mockup.sourcePath).toBe(join(dir, 'mockup-sources', mockup.id))
    expect(existsSync(join(mockup.sourcePath!, 'main.html'))).toBe(true)
    expect(readFileSync(join(mockup.sourcePath!, 'main.html'), 'utf-8')).toBe(
      '<h1>Hi</h1>',
    )
    const reloaded = await store.get(mockup.id)
    expect(reloaded?.sourcePath).toBe(mockup.sourcePath)
  })

  it('remove() cleans up the mockup-sources/<id> mirror dir', async () => {
    const { mkdtempSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { FileMockupStore, mockupSourceDir } = await import(
      '../lib/mockups.js'
    )
    const dir = mkdtempSync(join(tmpdir(), 'diffing-mockups-'))
    const store = new FileMockupStore(dir)
    const mockup = await store.upsert({
      title: 'M',
      screens: [{ id: 'main', label: 'Main', html: '<h1>Hi</h1>' }],
    })
    const mirror = mockupSourceDir(dir, mockup.id)
    expect(existsSync(mirror)).toBe(true)
    expect(await store.remove(mockup.id)).toBe(true)
    expect(existsSync(mirror)).toBe(false)
    expect(await store.getAll()).toHaveLength(0)
  })

  it('removeScreen() unlinks only that screen file from the mirror', async () => {
    const { mkdtempSync, existsSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { FileMockupStore } = await import('../lib/mockups.js')
    const dir = mkdtempSync(join(tmpdir(), 'diffing-mockups-'))
    const store = new FileMockupStore(dir)
    const mockup = await store.upsert({
      title: 'M',
      screens: [
        { id: 'main', label: 'Main', html: '<p>a</p>' },
        { id: 'b', label: 'B', html: '<p>b</p>' },
      ],
    })
    const mirror = mockup.sourcePath!
    expect(existsSync(join(mirror, 'b.html'))).toBe(true)
    const res = await store.removeScreen(mockup.id, 'b')
    expect(res.mockup?.version).toBe(2)
    expect(existsSync(join(mirror, 'b.html'))).toBe(false)
    expect(existsSync(join(mirror, 'main.html'))).toBe(true)
    expect(readFileSync(join(mirror, 'main.html'), 'utf-8')).toBe('<p>a</p>')
  })

  it('upsertScreen() and patchScreen() rewrite the mirror files', async () => {
    const { mkdtempSync, existsSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { FileMockupStore } = await import('../lib/mockups.js')
    const dir = mkdtempSync(join(tmpdir(), 'diffing-mockups-'))
    const store = new FileMockupStore(dir)
    const mockup = await store.upsert({
      title: 'M',
      screens: [{ id: 'main', label: 'Main', html: '<h1>Hi</h1>' }],
    })
    const mirror = mockup.sourcePath!
    const up = await store.upsertScreen(mockup.id, {
      id: 'checkout',
      label: 'Checkout',
      html: '<p>pay</p>',
    })
    expect(up.mockup?.version).toBe(2)
    expect(existsSync(join(mirror, 'checkout.html'))).toBe(true)
    expect(readFileSync(join(mirror, 'checkout.html'), 'utf-8')).toBe(
      '<p>pay</p>',
    )
    const patched = await store.patchScreen(mockup.id, 'main', {
      expectedText: '<h1>Hi</h1>',
      replacement: '<h1>Bye</h1>',
    })
    expect(patched.mockup?.version).toBe(3)
    expect(readFileSync(join(mirror, 'main.html'), 'utf-8')).toBe(
      '<h1>Bye</h1>',
    )
  })
})
