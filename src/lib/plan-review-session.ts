import type { Plan, PlanDecision } from './plan-types.js'

/**
 * In-process state machine for the plan-review handoff — the plan-side twin of
 * {@link ReviewSession}. An agent blocks on `GET /api/plan-review/await`; the
 * human approving/rejecting/requesting-changes (`POST /api/plans/:id/decision`)
 * snapshots the verdict and releases every blocked waiter. A monotonic `round`
 * counter plus the `sinceRound` cursor make a decision that lands between two
 * long-polls delivered immediately rather than lost.
 */

export interface PlanReviewPayload {
  /** Monotonic counter, incremented on every decision. */
  round: number
  /** Epoch ms the decision happened. Stamped by the caller. */
  sentAt: number
  planId: string
  decision: PlanDecision
  decisionComment?: string
  /** The `<plan-review>` XML for the decided plan. */
  reviewXml: string
  /** How many of the plan's comments are still open. */
  openCommentCount: number
  /** Raw plan at decision time, for structured (MCP) consumers. */
  plan: Plan
}

export type PlanAwaitResult =
  | { status: 'released'; payload: PlanReviewPayload }
  | { status: 'keep-waiting'; round: number }

export interface PlanReviewSessionSnapshot {
  round: number
  /** Number of agents currently blocked on await(). */
  waiters: number
  lastDecidedAt: number | null
}

interface Waiter {
  resolve: (result: PlanAwaitResult) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

export class PlanReviewSession {
  private round = 0
  private lastDecidedAt: number | null = null
  private lastPayload: PlanReviewPayload | null = null
  private waiters = new Set<Waiter>()
  private onStatusChange?: (snapshot: PlanReviewSessionSnapshot) => void

  constructor(onStatusChange?: (snapshot: PlanReviewSessionSnapshot) => void) {
    this.onStatusChange = onStatusChange
  }

  /** Block until the next `decide()` or until `timeoutMs` elapses. */
  await(opts: { sinceRound?: number; timeoutMs: number; signal?: AbortSignal }): Promise<PlanAwaitResult> {
    const { sinceRound, timeoutMs, signal } = opts

    if (sinceRound !== undefined && sinceRound < this.round && this.lastPayload) {
      return Promise.resolve({ status: 'released', payload: this.lastPayload })
    }

    if (signal?.aborted) {
      return Promise.resolve({ status: 'keep-waiting', round: this.round })
    }

    return new Promise<PlanAwaitResult>((resolve) => {
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

  /** Capture a decision and release every blocked waiter. */
  decide(input: {
    sentAt: number
    planId: string
    decision: PlanDecision
    decisionComment?: string
    reviewXml: string
    openCommentCount: number
    plan: Plan
  }): PlanReviewPayload {
    this.round += 1
    this.lastDecidedAt = input.sentAt
    const payload: PlanReviewPayload = {
      round: this.round,
      sentAt: input.sentAt,
      planId: input.planId,
      decision: input.decision,
      decisionComment: input.decisionComment,
      reviewXml: input.reviewXml,
      openCommentCount: input.openCommentCount,
      plan: input.plan,
    }
    this.lastPayload = payload

    const waiters = [...this.waiters]
    this.waiters.clear()
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.cleanup()
      waiter.resolve({ status: 'released', payload })
    }
    this.emitStatus()
    return payload
  }

  snapshot(): PlanReviewSessionSnapshot {
    return { round: this.round, waiters: this.waiters.size, lastDecidedAt: this.lastDecidedAt }
  }

  private removeWaiter(waiter: Waiter): void {
    if (!this.waiters.delete(waiter)) return
    clearTimeout(waiter.timer)
    waiter.cleanup()
    this.emitStatus()
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.snapshot())
  }
}
