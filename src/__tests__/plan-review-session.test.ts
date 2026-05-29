// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { PlanReviewSession } from '../lib/plan-review-session.js'
import type { Plan } from '../lib/plan-types.js'

const plan: Plan = {
  id: 'p1',
  title: 'Plan',
  body: '# Plan',
  createdAt: 0,
  updatedAt: 0,
  version: 1,
  decision: 'pending',
  comments: [],
}

function decideInput(overrides: Partial<Parameters<PlanReviewSession['decide']>[0]> = {}) {
  return {
    sentAt: 1000,
    planId: 'p1',
    decision: 'approved' as const,
    decisionComment: undefined,
    reviewXml: '<plan-review></plan-review>',
    openCommentCount: 0,
    plan,
    ...overrides,
  }
}

describe('PlanReviewSession', () => {
  it('releases a blocked waiter when decide() fires', async () => {
    const session = new PlanReviewSession()
    const pending = session.await({ timeoutMs: 5000 })
    const payload = session.decide(decideInput({ decision: 'changes-requested', openCommentCount: 2 }))
    const result = await pending
    expect(result.status).toBe('released')
    if (result.status === 'released') {
      expect(result.payload.round).toBe(1)
      expect(result.payload.decision).toBe('changes-requested')
      expect(result.payload.openCommentCount).toBe(2)
      expect(result.payload).toEqual(payload)
    }
  })

  it('releases every concurrent waiter from one decision', async () => {
    const session = new PlanReviewSession()
    const a = session.await({ timeoutMs: 5000 })
    const b = session.await({ timeoutMs: 5000 })
    expect(session.snapshot().waiters).toBe(2)
    session.decide(decideInput())
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.status).toBe('released')
    expect(rb.status).toBe('released')
    expect(session.snapshot().waiters).toBe(0)
  })

  it('resolves immediately when sinceRound is behind (race guard)', async () => {
    const session = new PlanReviewSession()
    session.decide(decideInput()) // round is now 1, no one was waiting
    const result = await session.await({ sinceRound: 0, timeoutMs: 5000 })
    expect(result.status).toBe('released')
    if (result.status === 'released') expect(result.payload.round).toBe(1)
  })

  it('returns keep-waiting after the timeout elapses', async () => {
    const session = new PlanReviewSession()
    const result = await session.await({ timeoutMs: 20 })
    expect(result).toEqual({ status: 'keep-waiting', round: 0 })
    expect(session.snapshot().waiters).toBe(0)
  })

  it('decrements the waiter count and notifies on abort', async () => {
    const onStatus = vi.fn()
    const session = new PlanReviewSession(onStatus)
    const controller = new AbortController()
    const pending = session.await({ timeoutMs: 5000, signal: controller.signal })
    expect(session.snapshot().waiters).toBe(1)
    controller.abort()
    const result = await pending
    expect(result.status).toBe('keep-waiting')
    expect(session.snapshot().waiters).toBe(0)
    expect(onStatus).toHaveBeenCalled()
  })

  it('emits status changes on register and decide', () => {
    const onStatus = vi.fn()
    const session = new PlanReviewSession(onStatus)
    session.await({ timeoutMs: 5000 })
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ waiters: 1 }))
    session.decide(decideInput())
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ waiters: 0, round: 1 }))
  })
})
