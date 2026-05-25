import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { InMemoryCommentStore, FileCommentStore, type CommentStore } from '../lib/comments.js'
import type { ReviewComment, CommentReply } from '../lib/types.js'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    filePath: 'src/index.ts',
    side: 'additions',
    lineNumber: 10,
    lineContent: 'const x = 1',
    body: 'Nice work',
    status: 'open',
    createdAt: Date.now(),
    replies: [],
    ...overrides,
  }
}

function makeReply(overrides: Partial<CommentReply> = {}): CommentReply {
  return {
    id: 'r1',
    body: 'Thanks!',
    createdAt: Date.now(),
    ...overrides,
  }
}

const tempDir = join(process.cwd(), 'src/__tests__/temp_comments_test')

const suites = [
  {
    name: 'InMemoryCommentStore',
    create: () => new InMemoryCommentStore(),
    cleanup: async () => {},
  },
  {
    name: 'FileCommentStore',
    create: () => new FileCommentStore(tempDir),
    cleanup: async () => {
      try {
        await rm(tempDir, { recursive: true, force: true })
      } catch {}
    },
  },
]

for (const suite of suites) {
  describe(suite.name, () => {
    let store: CommentStore

    beforeEach(async () => {
      await suite.cleanup()
      store = suite.create()
    })

    afterEach(async () => {
      await suite.cleanup()
    })

    describe('getAll', () => {
      it('returns an empty array when no comments exist', async () => {
        const comments = await store.getAll()
        expect(comments).toEqual([])
      })

      it('returns all added comments', async () => {
        await store.add(makeComment({ id: 'c1' }))
        await store.add(makeComment({ id: 'c2' }))
        const comments = await store.getAll()
        expect(comments).toHaveLength(2)
        expect(comments.map((c) => c.id)).toEqual(['c1', 'c2'])
      })
    })

    describe('add', () => {
      it('adds a comment to the store', async () => {
        const comment = makeComment()
        const result = await store.add(comment)
        expect(result.id).toBe(comment.id)
        const all = await store.getAll()
        expect(all[0].id).toBe(comment.id)
      })

      it('stores comments with startLineNumber range correctly', async () => {
        const comment = makeComment({ id: 'c3', lineNumber: 15, startLineNumber: 12 })
        const result = await store.add(comment)
        expect(result.startLineNumber).toBe(12)
        const all = await store.getAll()
        const found = all.find((c) => c.id === 'c3')
        expect(found).toBeDefined()
        expect(found!.startLineNumber).toBe(12)
      })

      it('stores multiple comments independently', async () => {
        const c1 = makeComment({ id: 'c1', lineNumber: 5 })
        const c2 = makeComment({ id: 'c2', lineNumber: 15 })
        await store.add(c1)
        await store.add(c2)
        const all = await store.getAll()
        expect(all).toHaveLength(2)
      })
    })

    describe('update', () => {
      it('updates the body of an existing comment', async () => {
        const comment = makeComment()
        await store.add(comment)
        const updated = await store.update('c1', { body: 'Updated body' })
        expect(updated).not.toBeNull()
        expect(updated!.body).toBe('Updated body')
        expect(updated!.status).toBe('open')
      })

      it('updates the status of an existing comment', async () => {
        await store.add(makeComment())
        const updated = await store.update('c1', { status: 'resolved' })
        expect(updated!.status).toBe('resolved')
      })

      it('updates both body and status', async () => {
        await store.add(makeComment())
        const updated = await store.update('c1', { body: 'New', status: 'resolved' })
        expect(updated!.body).toBe('New')
        expect(updated!.status).toBe('resolved')
      })

      it('returns null for a non-existent comment', async () => {
        const result = await store.update('non-existent', { body: 'x' })
        expect(result).toBeNull()
      })

      it('does not change fields not provided', async () => {
        await store.add(makeComment({ body: 'Original', status: 'open' }))
        await store.update('c1', { body: 'Only body changed' })
        const comment = (await store.getAll())[0]
        expect(comment.body).toBe('Only body changed')
        expect(comment.status).toBe('open')
      })
    })

    describe('remove', () => {
      it('removes an existing comment', async () => {
        await store.add(makeComment())
        const result = await store.remove('c1')
        expect(result).toBe(true)
        const all = await store.getAll()
        expect(all).toHaveLength(0)
      })

      it('returns false for a non-existent comment', async () => {
        const result = await store.remove('non-existent')
        expect(result).toBe(false)
      })

      it('does not remove other comments', async () => {
        await store.add(makeComment({ id: 'c1' }))
        await store.add(makeComment({ id: 'c2' }))
        await store.remove('c1')
        const all = await store.getAll()
        expect(all).toHaveLength(1)
        expect(all[0].id).toBe('c2')
      })
    })

    describe('addReply', () => {
      it('adds a reply to an existing comment', async () => {
        await store.add(makeComment())
        const reply = makeReply()
        const updated = await store.addReply('c1', reply)
        expect(updated).not.toBeNull()
        expect(updated!.replies).toHaveLength(1)
        expect(updated!.replies[0].id).toBe(reply.id)
      })

      it('appends replies in order', async () => {
        await store.add(makeComment())
        await store.addReply('c1', makeReply({ id: 'r1', body: 'First' }))
        await store.addReply('c1', makeReply({ id: 'r2', body: 'Second' }))
        const comment = (await store.getAll())[0]
        expect(comment.replies).toHaveLength(2)
        expect(comment.replies[0].body).toBe('First')
        expect(comment.replies[1].body).toBe('Second')
      })

      it('returns null for a non-existent comment', async () => {
        const result = await store.addReply('non-existent', makeReply())
        expect(result).toBeNull()
      })
    })
  })
}
