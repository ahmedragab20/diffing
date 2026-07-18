/**
 * The headline verdict a reviewer attaches when sending a diff review back to
 * the agent — the diff-side twin of {@link import('./plan-types').PlanDecision}
 * (minus `pending`, since a review only exists once it is submitted).
 */
export type ReviewDecision = 'approved' | 'changes-requested' | 'rejected' | 'comment-only'

/**
 * Mode controlling agent behavior on review handoff.
 * - `standard`: Agent addresses comments and applies edits (default).
 * - `comment-only`: Agent MUST NOT edit files; only replies to comments.
 */
export type ReviewMode = 'standard' | 'comment-only'

export interface CommentReply {
  id: string
  body: string
  createdAt: number
  role?: 'user' | 'agent'
  model?: string
  /**
   * `plan.version` at the time the parent comment was created. Inherited by
   * replies on plan comments so a thread is uniformly anchored to one
   * version. Unused on diff-comment replies.
   */
  createdAtPlanVersion?: number
}

/** Reviewer intent label for triage (optional; missing = none). */
export type CommentSeverity = 'blocking' | 'nit' | 'question' | 'praise' | 'none'

export interface ReviewComment {
  id: string
  filePath: string
  side: 'deletions' | 'additions'
  lineNumber: number
  startLineNumber?: number
  lineContent: string
  body: string
  status: 'open' | 'resolved'
  createdAt: number
  replies: CommentReply[]
  /**
   * Optional triage severity. Agents and the comment tracker can filter on this.
   * Absent on legacy comments → treat as `'none'`.
   */
  severity?: CommentSeverity
  /**
   * True when the anchored line content no longer matches the live diff
   * (badge-only v1 — no auto-remap). Set by the client/server on refresh.
   */
  outdated?: boolean
}
