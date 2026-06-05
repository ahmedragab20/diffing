import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { getRepoRoot, getProjectStorageDir } from './git.js'
import type { Plan, PlanComment, PlanDecision, PlanVersion } from './plan-types.js'
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

  /** Returns the body/title snapshot of a specific historical version, or null if not found. */
  getVersion(id: string, version: number): Promise<PlanVersion | null>
}

function newId(): string {
  return crypto.randomUUID()
}

/**
 * Backfill / repair a plan loaded from disk so it matches the current schema.
 * Older persisted plans may be missing `versions` and `createdAtPlanVersion`;
 * we synthesize sensible values so callers can always rely on the new fields.
 */
function backfillPlan(plan: Plan): void {
  if (!plan.versions || plan.versions.length === 0) {
    plan.versions = [
      {
        version: plan.version ?? 1,
        body: plan.body,
        title: plan.title,
        source: plan.source,
        model: plan.model,
        createdAt: plan.updatedAt ?? plan.createdAt ?? Date.now(),
      },
    ]
  }
  if (plan.comments) {
    for (const c of plan.comments) {
      if (typeof c.createdAtPlanVersion !== 'number') {
        c.createdAtPlanVersion = plan.version ?? 1
      }
    }
  }
  if (!plan.comments) {
    plan.comments = []
  }
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
      // Bump the version and mutate the current fields. The previous version
      // is already captured as `versions[last]` (invariant: the tail of
      // `versions[]` always equals the current state), so we just append the
      // new current snapshot to keep the invariant.
      existing.title = input.title
      existing.body = input.body
      if (input.source !== undefined) existing.source = input.source
      if (input.model !== undefined) existing.model = input.model
      existing.version += 1
      existing.updatedAt = now
      if (!existing.versions) existing.versions = []
      existing.versions.push({
        version: existing.version,
        body: existing.body,
        title: existing.title,
        source: existing.source,
        model: existing.model,
        createdAt: now,
      })
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
    versions: [
      {
        version: 1,
        body: input.body,
        title: input.title,
        source: input.source,
        model: input.model,
        createdAt: now,
      },
    ],
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

/**
 * Keep the most-recent `PlanVersion` snapshot in sync with the current `Plan`
 * fields after a non-resubmit edit (PUT). Doesn't add a new entry — that only
 * happens via `upsert` (the resubmit flow).
 */
function syncCurrentVersion(plan: Plan): void {
  if (!plan.versions || plan.versions.length === 0) {
    plan.versions = []
  }
  if (plan.versions.length === 0) {
    plan.versions.push({
      version: plan.version,
      body: plan.body,
      title: plan.title,
      source: plan.source,
      model: plan.model,
      createdAt: plan.updatedAt,
    })
    return
  }
  const last = plan.versions[plan.versions.length - 1]
  last.body = plan.body
  last.title = plan.title
  last.source = plan.source
  last.model = plan.model
}

export class InMemoryPlanStore implements PlanStore {
  private plans: Plan[] = []

  async getAll(): Promise<Plan[]> {
    return this.plans
  }

  async get(id: string): Promise<Plan | null> {
    const plan = this.plans.find((p) => p.id === id) ?? null
    if (plan) backfillPlan(plan)
    return plan
  }

  async getVersion(id: string, version: number): Promise<PlanVersion | null> {
    const plan = this.plans.find((p) => p.id === id)
    if (!plan) return null
    backfillPlan(plan)
    return plan.versions.find((v) => v.version === version) ?? null
  }

  async upsert(input: { id?: string; title: string; body: string; source?: string; model?: string }): Promise<Plan> {
    const plan = applyUpsert(this.plans, input, Date.now())
    backfillPlan(plan)
    return plan
  }

  async update(id: string, fields: { title?: string; body?: string; source?: string; model?: string }): Promise<Plan | null> {
    const plan = this.plans.find((p) => p.id === id)
    if (!plan) return null
    if (fields.title !== undefined) plan.title = fields.title
    if (fields.body !== undefined) plan.body = fields.body
    if (fields.source !== undefined) plan.source = fields.source
    if (fields.model !== undefined) plan.model = fields.model
    plan.updatedAt = Date.now()
    syncCurrentVersion(plan)
    backfillPlan(plan)
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
      if (typeof comment.createdAtPlanVersion !== 'number') {
        comment.createdAtPlanVersion = plan.version ?? 1
      }
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
      // Inherit the parent's version stamp so the reply stays anchored to the
      // same version the parent comment is anchored to.
      if (typeof c.createdAtPlanVersion === 'number' && typeof reply.createdAtPlanVersion !== 'number') {
        reply.createdAtPlanVersion = c.createdAtPlanVersion
      }
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

  /**
   * @param storageDir Absolute directory to persist `plans.json` in. Defaults
   *   to the per-repo storage dir under `~/.diffing`, the same place comments
   *   and media live — plans are NEVER written inside the reviewed (consumer)
   *   repo, so a consumer project stays free of any diffing-specific artifacts.
   *   The override exists only so tests can point at a throwaway temp dir.
   */
  constructor(storageDir?: string) {
    this.dirPath = storageDir ?? getProjectStorageDir()
    this.filePath = join(this.dirPath, 'plans.json')
  }

  async getAll(): Promise<Plan[]> {
    try {
      const data = await readFile(this.filePath, 'utf-8')
      const plans: Plan[] = JSON.parse(data)
      for (const p of plans) backfillPlan(p)
      return plans
    } catch {
      return []
    }
  }

  async get(id: string): Promise<Plan | null> {
    return (await this.getAll()).find((p) => p.id === id) ?? null
  }

  async getVersion(id: string, version: number): Promise<PlanVersion | null> {
    const plan = await this.get(id)
    if (!plan) return null
    return plan.versions.find((v) => v.version === version) ?? null
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
    backfillPlan(plan)
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
    syncCurrentVersion(plan)
    backfillPlan(plan)
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
    backfillPlan(plan)
    await this.save(plans)
    return plan
  }

  async addComment(planId: string, comment: PlanComment): Promise<Plan | null> {
    return this.mutate(planId, (plan) => {
      if (typeof comment.createdAtPlanVersion !== 'number') {
        comment.createdAtPlanVersion = plan.version ?? 1
      }
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
      // Inherit the parent's version stamp so the reply stays anchored to the
      // same version the parent comment is anchored to.
      if (typeof c.createdAtPlanVersion === 'number' && typeof reply.createdAtPlanVersion !== 'number') {
        reply.createdAtPlanVersion = c.createdAtPlanVersion
      }
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
