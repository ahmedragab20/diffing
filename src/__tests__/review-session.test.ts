// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { ReviewSession } from '../lib/review-session.js'

function sendInput(overrides: Partial<{ openCount: number; commentXml: string; comments: any[] }> = {}) {
  return {
    sentAt: 1000,
    commentXml: '<code-review-comments></code-review-comments>',
    openCount: 1,
    comments: [],
    ...overrides,
  }
}

describe('ReviewSession', () => {
  it('releases a blocked waiter when send() fires', async () => {
    const session = new ReviewSession()
    const pending = session.await({ timeoutMs: 5000 })
    const payload = session.send(sendInput({ openCount: 3 }))
    const result = await pending
    expect(result.status).toBe('released')
    if (result.status === 'released') {
      expect(result.payload.round).toBe(1)
      expect(result.payload.openCount).toBe(3)
      expect(result.payload).toEqual(payload)
    }
  })

  it('releases every concurrent waiter from one send', async () => {
    const session = new ReviewSession()
    const a = session.await({ timeoutMs: 5000 })
    const b = session.await({ timeoutMs: 5000 })
    expect(session.snapshot().waiters).toBe(2)
    session.send(sendInput())
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.status).toBe('released')
    expect(rb.status).toBe('released')
    expect(session.snapshot().waiters).toBe(0)
  })

  it('resolves immediately when sinceRound is behind (race guard)', async () => {
    const session = new ReviewSession()
    session.send(sendInput()) // round is now 1, no one was waiting
    const result = await session.await({ sinceRound: 0, timeoutMs: 5000 })
    expect(result.status).toBe('released')
    if (result.status === 'released') expect(result.payload.round).toBe(1)
  })

  it('returns keep-waiting after the timeout elapses', async () => {
    const session = new ReviewSession()
    const result = await session.await({ timeoutMs: 20 })
    expect(result).toEqual({ status: 'keep-waiting', round: 0 })
    expect(session.snapshot().waiters).toBe(0)
  })

  it('decrements the waiter count and notifies on abort', async () => {
    const onStatus = vi.fn()
    const session = new ReviewSession(onStatus)
    const controller = new AbortController()
    const pending = session.await({ timeoutMs: 5000, signal: controller.signal })
    expect(session.snapshot().waiters).toBe(1)
    controller.abort()
    const result = await pending
    expect(result.status).toBe('keep-waiting')
    expect(session.snapshot().waiters).toBe(0)
    expect(onStatus).toHaveBeenCalled()
  })

  it('emits status changes on register and send', () => {
    const onStatus = vi.fn()
    const session = new ReviewSession(onStatus)
    session.await({ timeoutMs: 5000 })
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ waiters: 1 }))
    session.send(sendInput())
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ waiters: 0, round: 1 }))
  })

  describe('getHistory', () => {
    it('returns the rounds newest-first with file paths, decision, and mode', () => {
      const session = new ReviewSession()
      session.send({
        ...sendInput({
          comments: [
            { id: 'c1', filePath: 'src/z.ts' },
            { id: 'c2', filePath: 'src/a.ts' },
          ],
        }),
        sentAt: 1000,
        decision: 'changes-requested',
        mode: 'comment-only',
      })
      session.send({
        ...sendInput({ comments: [{ id: 'c3', filePath: 'src/m.ts' }] }),
        sentAt: 2000,
        decision: 'approved',
      })
      const rounds = session.getHistory()
      expect(rounds).toHaveLength(2)
      // Newest first since the UI shows "since last handoff" with current at the top.
      expect(rounds[0].round).toBe(2)
      expect(rounds[0].decision).toBe('approved')
      expect(rounds[0].mode).toBe('standard')
      expect(rounds[1].round).toBe(1)
      expect(rounds[1].decision).toBe('changes-requested')
      expect(rounds[1].mode).toBe('comment-only')
      // File paths are deduplicated and sorted alphabetically.
      expect(rounds[1].filePaths).toEqual(['src/a.ts', 'src/z.ts'])
    })

    it('caps history at 20 rounds and drops the oldest (newest still first)', () => {
      const session = new ReviewSession()
      for (let i = 1; i <= 25; i++) {
        session.send({ ...sendInput(), sentAt: i * 1000 })
      }
      const rounds = session.getHistory()
      expect(rounds).toHaveLength(20)
      expect(rounds[0].round).toBe(25)
      expect(rounds[rounds.length - 1].round).toBe(6)
    })

    it('returns an empty array before the first send', () => {
      const session = new ReviewSession()
      expect(session.getHistory()).toEqual([])
    })

    it('stores diff fingerprints for since-last baseline', () => {
      const session = new ReviewSession()
      session.send({
        ...sendInput(),
        diffFingerprints: { 'src/a.ts': 'aaaa', 'src/b.ts': 'bbbb' },
      })
      expect(session.getLastDiffFingerprints()).toEqual({
        'src/a.ts': 'aaaa',
        'src/b.ts': 'bbbb',
      })
      expect(session.snapshot().hasSinceLastBaseline).toBe(true)
      expect(session.getHistory()[0].diffFingerprints).toEqual({
        'src/a.ts': 'aaaa',
        'src/b.ts': 'bbbb',
      })
    })

    it('snapshot exposes the last decision and open count of the most recent round', () => {
      const session = new ReviewSession()
      session.send({ ...sendInput({ openCount: 3 }), decision: 'approved' })
      const snap = session.snapshot()
      expect(snap.lastDecision).toBe('approved')
      expect(snap.lastOpenCount).toBe(3)
    })
  })
})
