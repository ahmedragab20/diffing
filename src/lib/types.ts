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
