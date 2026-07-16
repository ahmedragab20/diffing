import type { ReviewComment, ReviewDecision, ReviewMode } from './types.js'

/**
 * In-process state machine for the "agent waits, the human releases it"
 * handoff. One instance lives per server process (scoped to one repo).
 *
 * Flow:
 *   - An agent blocks on `GET /api/review/await` (long-poll) → `await()`.
 *   - The human clicks "Send to agent" → `POST /api/review/send` → `send()`,
 *     which snapshots the current comments and releases every blocked waiter.
 *   - Repeated rounds are supported via a monotonic `round` counter; clients
 *     pass the round they last saw (`sinceRound`) so a send that lands between
 *     two long-polls is delivered immediately rather than lost.
 */

export interface ReviewPayload {
  /** Monotonic counter, incremented on every send. */
  round: number
  /** Epoch ms the send happened. Stamped by the caller (Date.now lives outside). */
  sentAt: number
  /** The `<code-review-comments>` XML for the snapshotted comments. */
  commentXml: string
  /** How many of the snapshotted comments are still open. */
  openCount: number
  /** Raw comments at send time, for structured (MCP) consumers. */
  comments: ReviewComment[]
  /** The reviewer's headline verdict, when they chose one. */
  decision?: ReviewDecision
  /** Mode controlling agent behavior: 'standard' (default) or 'comment-only'. */
  mode: ReviewMode
}

export type AwaitResult =
  | { status: 'released'; payload: ReviewPayload }
  | { status: 'keep-waiting'; round: number }

export interface ReviewSessionSnapshot {
  round: number
  /** Number of agents currently blocked on await(). */
  waiters: number
  lastSentAt: number | null
  /** Headline of the most recent send, if any. */
  lastDecision?: ReviewDecision
  lastOpenCount?: number
}

/** Lightweight round summary kept for the UI history / "since last handoff" banner. */
export interface ReviewRoundSummary {
  round: number
  sentAt: number
  openCount: number
  decision?: ReviewDecision
  mode: ReviewMode
  filePaths: string[]
}

interface Waiter {
  resolve: (result: AwaitResult) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

const MAX_ROUND_HISTORY = 20

export class ReviewSession {
  private round = 0
  private lastSentAt: number | null = null
  private lastPayload: ReviewPayload | null = null
  private history: ReviewRoundSummary[] = []
  private waiters = new Set<Waiter>()
  private onStatusChange?: (snapshot: ReviewSessionSnapshot) => void

  constructor(onStatusChange?: (snapshot: ReviewSessionSnapshot) => void) {
    this.onStatusChange = onStatusChange
  }

  /**
   * Block until the next `send()` or until `timeoutMs` elapses.
   *
   * If `sinceRound` is provided and is behind the current round, a send already
   * happened since the client last checked → resolve immediately with the
   * cached payload (the race guard). Otherwise register a waiter.
   */
  await(opts: {
    sinceRound?: number
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<AwaitResult> {
    const { sinceRound, timeoutMs, signal } = opts

    if (sinceRound !== undefined && sinceRound < this.round && this.lastPayload) {
      return Promise.resolve({ status: 'released', payload: this.lastPayload })
    }

    if (signal?.aborted) {
      return Promise.resolve({ status: 'keep-waiting', round: this.round })
    }

    return new Promise<AwaitResult>((resolve) => {
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

  /** Capture a review batch and release every blocked waiter. */
  send(input: { sentAt: number; commentXml: string; openCount: number; comments: ReviewComment[]; decision?: ReviewDecision; mode?: ReviewMode }): ReviewPayload {
    this.round += 1
    this.lastSentAt = input.sentAt
    const mode = input.mode ?? 'standard'
    const payload: ReviewPayload = {
      round: this.round,
      sentAt: input.sentAt,
      commentXml: input.commentXml,
      openCount: input.openCount,
      comments: input.comments,
      decision: input.decision,
      mode,
    }
    this.lastPayload = payload

    const filePaths = [...new Set(input.comments.map((c) => c.filePath))].sort()
    this.history.push({
      round: this.round,
      sentAt: input.sentAt,
      openCount: input.openCount,
      decision: input.decision,
      mode,
      filePaths,
    })
    if (this.history.length > MAX_ROUND_HISTORY) {
      this.history.splice(0, this.history.length - MAX_ROUND_HISTORY)
    }

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

  snapshot(): ReviewSessionSnapshot {
    const last = this.history[this.history.length - 1]
    return {
      round: this.round,
      waiters: this.waiters.size,
      lastSentAt: this.lastSentAt,
      lastDecision: last?.decision,
      lastOpenCount: last?.openCount,
    }
  }

  /** Newest-first round summaries for the UI timeline. */
  getHistory(): ReviewRoundSummary[] {
    return [...this.history].reverse()
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
