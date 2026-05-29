import type { CommentReply } from './types.js'

/**
 * Plan review data model. A "plan" is any markdown document an AI agent emits
 * before doing work (a step-by-step implementation plan, a design proposal,
 * etc.). diffing renders it line-addressably so a human can comment on specific
 * lines/sections and approve, reject, or request changes — then hands the
 * structured decision back to the waiting agent, mirroring the diff-review
 * handoff.
 */

/** The human's verdict on a plan. `pending` until they submit a review. */
export type PlanDecision = 'pending' | 'approved' | 'rejected' | 'changes-requested'

export interface PlanComment {
  id: string
  /**
   * 1-based line in the plan body the comment is anchored to. `0` marks a
   * whole-plan ("general") comment with no specific line.
   */
  lineNumber: number
  /** Start of a multi-line selection (inclusive). Omitted for single lines. */
  startLineNumber?: number
  /** Snapshot of the anchored plan text, for context in the handoff XML. */
  lineContent: string
  /** Nearest preceding markdown heading, captured so the agent knows the section. */
  sectionTitle?: string
  body: string
  status: 'open' | 'resolved'
  createdAt: number
  replies: CommentReply[]
}

export interface Plan {
  id: string
  title: string
  /** Raw markdown source of the plan. */
  body: string
  /** Free-form origin label, e.g. an agent/tool name or a file path. */
  source?: string
  /** The model that authored the plan, when known. */
  model?: string
  createdAt: number
  updatedAt: number
  /** Bumped each time the agent resubmits a revised body for the same plan id. */
  version: number
  decision: PlanDecision
  /** The overall note the human attached to their approve/reject/changes verdict. */
  decisionComment?: string
  /** Epoch ms the human submitted the decision. */
  decidedAt?: number
  comments: PlanComment[]
}
