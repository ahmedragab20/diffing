/**
 * The headline verdict a reviewer attaches when sending a diff review back to
 * the agent — the diff-side twin of {@link import('./plan-types').PlanDecision}
 * (minus `pending`, since a review only exists once it is submitted).
 */
export type ReviewDecision = 'approved' | 'changes-requested' | 'rejected'

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
}
