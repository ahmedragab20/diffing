import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { getRepoRoot, getProjectStorageDir } from './git.js'
import type { Plan, PlanComment, PlanDecision } from './plan-types.js'
import type { CommentReply } from './types.js'

/**
 * Persistence for plan reviews. Mirrors {@link CommentStore}: an in-memory
 * implementation for tests and a file-backed one that writes `plans.json` into
 * the per-repo storage dir, where the server's watcher picks up external writes
 * (e.g. an agent submitting a plan via the CLI) and broadcasts them live.
 */
export interface PlanStore {
  getAll(): Promise<Plan[]>
  get(id: string): Promise<Plan | null>
  /** Create a plan, or revise an existing one when `input.id` already exists. */
  upsert(input: {
    id?: string
    title: string
    body: string
    source?: string
    model?: string
  }): Promise<Plan>
  update(id: string, fields: { title?: string; body?: string; source?: string; model?: string }): Promise<Plan | null>
  remove(id: string): Promise<boolean>
  setDecision(id: string, decision: PlanDecision, decisionComment?: string): Promise<Plan | null>

  addComment(planId: string, comment: PlanComment): Promise<Plan | null>
  updateComment(planId: string, commentId: string, fields: { body?: string; status?: PlanComment['status'] }): Promise<Plan | null>
  removeComment(planId: string, commentId: string): Promise<Plan | null>

  addReply(planId: string, commentId: string, reply: CommentReply): Promise<Plan | null>
  removeReply(planId: string, commentId: string, replyId: string): Promise<Plan | null>
  updateReply(planId: string, commentId: string, replyId: string, body: string): Promise<Plan | null>
}

function newId(): string {
  return crypto.randomUUID()
}

/** Shared mutation helpers so both stores behave identically. */
function applyUpsert(
  plans: Plan[],
  input: { id?: string; title: string; body: string; source?: string; model?: string },
  now: number,
): Plan {
  if (input.id) {
    const existing = plans.find((p) => p.id === input.id)
    if (existing) {
      existing.title = input.title
      existing.body = input.body
      if (input.source !== undefined) existing.source = input.source
      if (input.model !== undefined) existing.model = input.model
      existing.version += 1
      existing.updatedAt = now
      // A revised body invalidates the previous verdict — re-open for review.
      existing.decision = 'pending'
      existing.decisionComment = undefined
      existing.decidedAt = undefined
      return existing
    }
  }
  const plan: Plan = {
    id: input.id || newId(),
    title: input.title,
    body: input.body,
    source: input.source,
    model: input.model,
    createdAt: now,
    updatedAt: now,
    version: 1,
    decision: 'pending',
    comments: [],
  }
  plans.push(plan)
  return plan
}

function applyComment<T>(plans: Plan[], planId: string, fn: (plan: Plan) => T | null): T | null {
  const plan = plans.find((p) => p.id === planId)
  if (!plan) return null
  if (!plan.comments) plan.comments = []
  return fn(plan)
}

export class InMemoryPlanStore implements PlanStore {
  private plans: Plan[] = []

  async getAll(): Promise<Plan[]> {
    return this.plans
  }

  async get(id: string): Promise<Plan | null> {
    return this.plans.find((p) => p.id === id) ?? null
  }

  async upsert(input: { id?: string; title: string; body: string; source?: string; model?: string }): Promise<Plan> {
    return applyUpsert(this.plans, input, Date.now())
  }

  async update(id: string, fields: { title?: string; body?: string; source?: string; model?: string }): Promise<Plan | null> {
    const plan = this.plans.find((p) => p.id === id)
    if (!plan) return null
    if (fields.title !== undefined) plan.title = fields.title
    if (fields.body !== undefined) plan.body = fields.body
    if (fields.source !== undefined) plan.source = fields.source
    if (fields.model !== undefined) plan.model = fields.model
    plan.updatedAt = Date.now()
    return plan
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.plans.findIndex((p) => p.id === id)
    if (idx === -1) return false
    this.plans.splice(idx, 1)
    return true
  }

  async setDecision(id: string, decision: PlanDecision, decisionComment?: string): Promise<Plan | null> {
    const plan = this.plans.find((p) => p.id === id)
    if (!plan) return null
    plan.decision = decision
    plan.decisionComment = decisionComment?.trim() || undefined
    plan.decidedAt = Date.now()
    plan.updatedAt = plan.decidedAt
    return plan
  }

  async addComment(planId: string, comment: PlanComment): Promise<Plan | null> {
    return applyComment(this.plans, planId, (plan) => {
      plan.comments.push(comment)
      return plan
    })
  }

  async updateComment(planId: string, commentId: string, fields: { body?: string; status?: PlanComment['status'] }): Promise<Plan | null> {
    return applyComment(this.plans, planId, (plan) => {
      const c = plan.comments.find((x) => x.id === commentId)
      if (!c) return null
      if (fields.body !== undefined) c.body = fields.body
      if (fields.status !== undefined) c.status = fields.status
      return plan
    })
  }

  async removeComment(planId: string, commentId: string): Promise<Plan | null> {
    return applyComment(this.plans, planId, (plan) => {
      const idx = plan.comments.findIndex((x) => x.id === commentId)
      if (idx === -1) return null
      plan.comments.splice(idx, 1)
      return plan
    })
  }

  async addReply(planId: string, commentId: string, reply: CommentReply): Promise<Plan | null> {
    return applyComment(this.plans, planId, (plan) => {
      const c = plan.comments.find((x) => x.id === commentId)
      if (!c) return null
      if (!c.replies) c.replies = []
      c.replies.push(reply)
      return plan
    })
  }

  async removeReply(planId: string, commentId: string, replyId: string): Promise<Plan | null> {
    return applyComment(this.plans, planId, (plan) => {
      const c = plan.comments.find((x) => x.id === commentId)
      if (!c) return null
      const idx = c.replies.findIndex((r) => r.id === replyId)
      if (idx === -1) return null
      c.replies.splice(idx, 1)
      return plan
    })
  }

  async updateReply(planId: string, commentId: string, replyId: string, body: string): Promise<Plan | null> {
    return applyComment(this.plans, planId, (plan) => {
      const c = plan.comments.find((x) => x.id === commentId)
      if (!c) return null
      const reply = c.replies.find((r) => r.id === replyId)
      if (!reply) return null
      reply.body = body
      return plan
    })
  }
}

export class FilePlanStore implements PlanStore {
  private dirPath: string
  private filePath: string

  constructor(customRepoRoot?: string) {
    if (customRepoRoot) {
      this.dirPath = join(customRepoRoot, '.diffing')
    } else {
      this.dirPath = getProjectStorageDir()
    }
    this.filePath = join(this.dirPath, 'plans.json')
  }

  async getAll(): Promise<Plan[]> {
    try {
      const data = await readFile(this.filePath, 'utf-8')
      return JSON.parse(data)
    } catch {
      return []
    }
  }

  async get(id: string): Promise<Plan | null> {
    return (await this.getAll()).find((p) => p.id === id) ?? null
  }

  private async save(plans: Plan[]): Promise<void> {
    try {
      await mkdir(this.dirPath, { recursive: true })
      try {
        const repoRoot = getRepoRoot()
        await writeFile(join(this.dirPath, 'repo_path.txt'), repoRoot, 'utf-8')
      } catch {
        // Ignore if outside git repo or in mock sandboxes
      }
      await writeFile(this.filePath, JSON.stringify(plans, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save plans to file:', err)
    }
  }

  async upsert(input: { id?: string; title: string; body: string; source?: string; model?: string }): Promise<Plan> {
    const plans = await this.getAll()
    const plan = applyUpsert(plans, input, Date.now())
    await this.save(plans)
    return plan
  }

  async update(id: string, fields: { title?: string; body?: string; source?: string; model?: string }): Promise<Plan | null> {
    const plans = await this.getAll()
    const plan = plans.find((p) => p.id === id)
    if (!plan) return null
    if (fields.title !== undefined) plan.title = fields.title
    if (fields.body !== undefined) plan.body = fields.body
    if (fields.source !== undefined) plan.source = fields.source
    if (fields.model !== undefined) plan.model = fields.model
    plan.updatedAt = Date.now()
    await this.save(plans)
    return plan
  }

  async remove(id: string): Promise<boolean> {
    const plans = await this.getAll()
    const idx = plans.findIndex((p) => p.id === id)
    if (idx === -1) return false
    plans.splice(idx, 1)
    await this.save(plans)
    return true
  }

  async setDecision(id: string, decision: PlanDecision, decisionComment?: string): Promise<Plan | null> {
    const plans = await this.getAll()
    const plan = plans.find((p) => p.id === id)
    if (!plan) return null
    plan.decision = decision
    plan.decisionComment = decisionComment?.trim() || undefined
    plan.decidedAt = Date.now()
    plan.updatedAt = plan.decidedAt
    await this.save(plans)
    return plan
  }

  private async mutate(planId: string, fn: (plan: Plan) => boolean): Promise<Plan | null> {
    const plans = await this.getAll()
    const plan = plans.find((p) => p.id === planId)
    if (!plan) return null
    if (!plan.comments) plan.comments = []
    const ok = fn(plan)
    if (!ok) return null
    await this.save(plans)
    return plan
  }

  async addComment(planId: string, comment: PlanComment): Promise<Plan | null> {
    return this.mutate(planId, (plan) => {
      plan.comments.push(comment)
      return true
    })
  }

  async updateComment(planId: string, commentId: string, fields: { body?: string; status?: PlanComment['status'] }): Promise<Plan | null> {
    return this.mutate(planId, (plan) => {
      const c = plan.comments.find((x) => x.id === commentId)
      if (!c) return false
      if (fields.body !== undefined) c.body = fields.body
      if (fields.status !== undefined) c.status = fields.status
      return true
    })
  }

  async removeComment(planId: string, commentId: string): Promise<Plan | null> {
    return this.mutate(planId, (plan) => {
      const idx = plan.comments.findIndex((x) => x.id === commentId)
      if (idx === -1) return false
      plan.comments.splice(idx, 1)
      return true
    })
  }

  async addReply(planId: string, commentId: string, reply: CommentReply): Promise<Plan | null> {
    return this.mutate(planId, (plan) => {
      const c = plan.comments.find((x) => x.id === commentId)
      if (!c) return false
      if (!c.replies) c.replies = []
      c.replies.push(reply)
      return true
    })
  }

  async removeReply(planId: string, commentId: string, replyId: string): Promise<Plan | null> {
    return this.mutate(planId, (plan) => {
      const c = plan.comments.find((x) => x.id === commentId)
      if (!c) return false
      const idx = c.replies.findIndex((r) => r.id === replyId)
      if (idx === -1) return false
      c.replies.splice(idx, 1)
      return true
    })
  }

  async updateReply(planId: string, commentId: string, replyId: string, body: string): Promise<Plan | null> {
    return this.mutate(planId, (plan) => {
      const c = plan.comments.find((x) => x.id === commentId)
      if (!c) return false
      const reply = c.replies.find((r) => r.id === replyId)
      if (!reply) return false
      reply.body = body
      return true
    })
  }
}
