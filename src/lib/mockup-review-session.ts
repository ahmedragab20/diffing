import type { Mockup, MockupDecision, MockupMode } from './mockup-types.js'

export interface MockupReviewPayload {
  round: number
  sentAt: number
  mockupId: string
  decision: MockupDecision
  decisionComment?: string
  reviewXml: string
  openCommentCount: number
  mockup: Mockup
  mode: MockupMode
}

export type MockupAwaitResult =
  | { status: 'released'; payload: MockupReviewPayload }
  | { status: 'keep-waiting'; round: number }

export interface MockupReviewSessionSnapshot {
  round: number
  waiters: number
  lastDecidedAt: number | null
}

interface Waiter {
  resolve: (result: MockupAwaitResult) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

export class MockupReviewSession {
  private round = 0
  private lastDecidedAt: number | null = null
  private lastPayload: MockupReviewPayload | null = null
  private waiters = new Set<Waiter>()
  private onStatusChange?: (snapshot: MockupReviewSessionSnapshot) => void

  constructor(
    onStatusChange?: (snapshot: MockupReviewSessionSnapshot) => void,
  ) {
    this.onStatusChange = onStatusChange
  }

  await(opts: {
    sinceRound?: number
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<MockupAwaitResult> {
    const { sinceRound, timeoutMs, signal } = opts

    if (
      sinceRound !== undefined &&
      sinceRound < this.round &&
      this.lastPayload
    ) {
      return Promise.resolve({ status: 'released', payload: this.lastPayload })
    }

    if (signal?.aborted) {
      return Promise.resolve({ status: 'keep-waiting', round: this.round })
    }

    return new Promise<MockupAwaitResult>((resolve) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          this.removeWaiter(waiter)
          resolve({ status: 'keep-waiting', round: this.round })
        }, timeoutMs),
        cleanup: () => {},
      }

      if (signal) {
        const onAbort = () => {
          this.removeWaiter(waiter)
          resolve({ status: 'keep-waiting', round: this.round })
        }
        signal.addEventListener('abort', onAbort, { once: true })
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort)
      }

      this.waiters.add(waiter)
      this.emitStatus()
    })
  }

  decide(input: {
    mockup: Mockup
    decision: MockupDecision
    decisionComment?: string
    reviewXml: string
    openCommentCount: number
    mode?: MockupMode
  }): MockupReviewPayload {
    this.round += 1
    this.lastDecidedAt = Date.now()
    const payload: MockupReviewPayload = {
      round: this.round,
      sentAt: this.lastDecidedAt,
      mockupId: input.mockup.id,
      decision: input.decision,
      decisionComment: input.decisionComment,
      reviewXml: input.reviewXml,
      openCommentCount: input.openCommentCount,
      mockup: input.mockup,
      mode: input.mode ?? 'standard',
    }
    this.lastPayload = payload
    for (const waiter of [...this.waiters]) {
      this.removeWaiter(waiter)
      waiter.resolve({ status: 'released', payload })
    }
    this.emitStatus()
    return payload
  }

  snapshot(): MockupReviewSessionSnapshot {
    return {
      round: this.round,
      waiters: this.waiters.size,
      lastDecidedAt: this.lastDecidedAt,
    }
  }

  private removeWaiter(waiter: Waiter): void {
    clearTimeout(waiter.timer)
    waiter.cleanup()
    this.waiters.delete(waiter)
    this.emitStatus()
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.snapshot())
  }
}
