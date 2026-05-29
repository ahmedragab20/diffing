import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readServerLock, isLockAlive } from './lib/server-lock.js'
import { formatComments } from './lib/comment-format.js'
import { formatPlanReview } from './lib/plan-format.js'
import type { ReviewComment } from './lib/types.js'
import type { Plan } from './lib/plan-types.js'

/**
 * MCP server exposing diffing's review handoff as cross-vendor tools, so any
 * MCP-capable agent (Claude, Cursor, Codex, Gemini, …) can drive the same loop
 * the CLI does. Launched via `diffing mcp` over stdio. The port is discovered
 * per call from the per-repo lockfile, so the MCP server works whether it
 * starts before or after the diffing web server.
 *
 * Client config (no port needed):
 *   { "mcpServers": { "diffing": { "command": "diffing", "args": ["mcp"] } } }
 */

/** Resolve the running server's base URL, throwing a tool-friendly error. */
function baseUrl(): string {
  const lock = readServerLock()
  if (!lock || !isLockAlive(lock)) {
    throw new Error('No diffing server running for this repo. Start one with `diffing` in the repository, then retry.')
  }
  const host = lock.host === '0.0.0.0' || lock.host === '::' ? '127.0.0.1' : lock.host
  return `http://${host}:${lock.port}`
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  }
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: 'diffing', version: '0.1.0' })

  server.registerTool(
    'await_review',
    {
      title: 'Await review',
      description:
        'Block until the human clicks "Send to agent" in the diffing UI, then return the review comments as XML. Re-poll-safe: returns the next review batch.',
      inputSchema: { timeoutSeconds: z.number().optional() },
    },
    async ({ timeoutSeconds }, extra) => {
      const base = baseUrl()
      const totalBudgetMs = (timeoutSeconds ?? 570) * 1000
      const progressToken = extra?._meta?.progressToken

      let sinceRound = 0
      try {
        const status = await fetch(`${base}/api/review/status`).then((r) => r.json())
        sinceRound = status.round ?? 0
      } catch {
        // surfaced by the loop below
      }

      const deadline = Date.now() + totalBudgetMs
      let cycle = 0
      while (Date.now() < deadline) {
        const res = await fetch(
          `${base}/api/review/await?timeoutMs=25000&sinceRound=${sinceRound}`,
          { signal: extra?.signal },
        )
        const result = await res.json()
        if (result.status === 'released') {
          return textResult(result.payload.commentXml, {
            round: result.payload.round,
            openCount: result.payload.openCount,
            comments: result.payload.comments,
          })
        }
        sinceRound = result.round ?? sinceRound
        cycle += 1
        if (progressToken !== undefined) {
          await extra?.sendNotification?.({
            method: 'notifications/progress',
            params: { progressToken, progress: cycle, message: 'Waiting for the human to send their review…' },
          }).catch(() => {})
        }
      }
      return textResult('No review was sent within the timeout. Call await_review again to keep waiting.')
    },
  )

  server.registerTool(
    'list_comments',
    {
      title: 'List comments',
      description: 'Fetch the current review comments as XML (and structured data). Set openOnly to skip resolved comments.',
      inputSchema: { openOnly: z.boolean().optional() },
    },
    async ({ openOnly }) => {
      const all: ReviewComment[] = await fetch(`${baseUrl()}/api/comments`).then((r) => r.json())
      const selected = openOnly ? all.filter((c) => c.status === 'open') : all
      return textResult(formatComments(selected), { comments: selected })
    },
  )

  server.registerTool(
    'reply_to_comment',
    {
      title: 'Reply to comment',
      description: 'Post an agent reply to a review comment. Shows up in the diffing UI in real time.',
      inputSchema: { commentId: z.string(), body: z.string(), model: z.string().optional() },
    },
    async ({ commentId, body, model }) => {
      const res = await fetch(`${baseUrl()}/api/comments/${commentId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, role: 'agent', model }),
      })
      if (res.status === 404) throw new Error(`Comment ${commentId} not found.`)
      if (!res.ok) throw new Error(`Failed to reply: HTTP ${res.status}`)
      return textResult(`Replied to ${commentId}.`)
    },
  )

  server.registerTool(
    'resolve_comment',
    {
      title: 'Resolve comment',
      description: 'Mark a review comment as resolved.',
      inputSchema: { commentId: z.string() },
    },
    async ({ commentId }) => {
      const res = await fetch(`${baseUrl()}/api/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      })
      if (res.status === 404) throw new Error(`Comment ${commentId} not found.`)
      if (!res.ok) throw new Error(`Failed to resolve: HTTP ${res.status}`)
      return textResult(`Resolved ${commentId}.`)
    },
  )

  // ── Plan review tools ─────────────────────────────────────────────────────
  // The plan-side twins of the comment-review tools above: submit a markdown
  // plan, block until the human decides, and reply/resolve inline comments.

  server.registerTool(
    'submit_plan',
    {
      title: 'Submit plan for review',
      description:
        'Submit a markdown plan for the human to review in the diffing UI. Returns the plan id and review URL. Pass an existing planId to resubmit a revised version for another review round.',
      inputSchema: {
        title: z.string().optional(),
        body: z.string(),
        source: z.string().optional(),
        model: z.string().optional(),
        planId: z.string().optional(),
      },
    },
    async ({ title, body, source, model, planId }) => {
      const base = baseUrl()
      const res = await fetch(`${base}/api/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: planId, title, body, source, model }),
      })
      if (!res.ok) throw new Error(`Failed to submit plan: HTTP ${res.status}`)
      const plan = (await res.json()) as Plan
      return textResult(
        `Submitted plan ${plan.id} (v${plan.version}). The human can review it at ${base}/plan/${plan.id}. Call await_plan_review to block until they decide.`,
        { planId: plan.id, version: plan.version, url: `${base}/plan/${plan.id}` },
      )
    },
  )

  server.registerTool(
    'await_plan_review',
    {
      title: 'Await plan review',
      description:
        'Block until the human approves, rejects, or requests changes on a plan in the diffing UI, then return the verdict and inline comments as XML. Re-poll-safe.',
      inputSchema: { timeoutSeconds: z.number().optional() },
    },
    async ({ timeoutSeconds }, extra) => {
      const base = baseUrl()
      const totalBudgetMs = (timeoutSeconds ?? 570) * 1000
      const progressToken = extra?._meta?.progressToken

      let sinceRound = 0
      try {
        const status = await fetch(`${base}/api/plan-review/status`).then((r) => r.json())
        sinceRound = status.round ?? 0
      } catch {
        // surfaced by the loop below
      }

      const deadline = Date.now() + totalBudgetMs
      let cycle = 0
      while (Date.now() < deadline) {
        const res = await fetch(
          `${base}/api/plan-review/await?timeoutMs=25000&sinceRound=${sinceRound}`,
          { signal: extra?.signal },
        )
        const result = await res.json()
        if (result.status === 'released') {
          return textResult(result.payload.reviewXml, {
            round: result.payload.round,
            planId: result.payload.planId,
            decision: result.payload.decision,
            decisionComment: result.payload.decisionComment,
            openCommentCount: result.payload.openCommentCount,
            plan: result.payload.plan,
          })
        }
        sinceRound = result.round ?? sinceRound
        cycle += 1
        if (progressToken !== undefined) {
          await extra?.sendNotification?.({
            method: 'notifications/progress',
            params: { progressToken, progress: cycle, message: 'Waiting for the human to review the plan…' },
          }).catch(() => {})
        }
      }
      return textResult('No plan decision within the timeout. Call await_plan_review again to keep waiting.')
    },
  )

  server.registerTool(
    'list_plans',
    {
      title: 'List plans',
      description: 'Fetch all submitted plans with their current decision and open-comment counts.',
      inputSchema: {},
    },
    async () => {
      const all: Plan[] = await fetch(`${baseUrl()}/api/plans`).then((r) => r.json())
      const summary = all
        .map((p) => {
          const open = (p.comments ?? []).filter((c) => c.status === 'open').length
          return `${p.id} [${p.decision}] v${p.version} — ${open} open comment(s) — ${p.title}`
        })
        .join('\n')
      return textResult(summary || 'No plans submitted yet.', { plans: all })
    },
  )

  server.registerTool(
    'get_plan',
    {
      title: 'Get plan',
      description: 'Fetch a single plan as the <plan-review> XML (and structured data), including its decision and inline comments.',
      inputSchema: { planId: z.string() },
    },
    async ({ planId }) => {
      const res = await fetch(`${baseUrl()}/api/plans/${planId}`)
      if (res.status === 404) throw new Error(`Plan ${planId} not found.`)
      if (!res.ok) throw new Error(`Failed to fetch plan: HTTP ${res.status}`)
      const plan = (await res.json()) as Plan
      return textResult(formatPlanReview(plan), { plan })
    },
  )

  /** Resolve which plan owns a comment id, for the reply/resolve tools. */
  async function findPlanForComment(base: string, commentId: string): Promise<Plan | null> {
    const all: Plan[] = await fetch(`${base}/api/plans`).then((r) => r.json())
    return all.find((p) => (p.comments ?? []).some((c) => c.id === commentId)) ?? null
  }

  server.registerTool(
    'reply_to_plan_comment',
    {
      title: 'Reply to plan comment',
      description: 'Post an agent reply to a plan review comment. Shows up in the diffing UI in real time.',
      inputSchema: { commentId: z.string(), body: z.string(), model: z.string().optional() },
    },
    async ({ commentId, body, model }) => {
      const base = baseUrl()
      const plan = await findPlanForComment(base, commentId)
      if (!plan) throw new Error(`Plan comment ${commentId} not found.`)
      const res = await fetch(`${base}/api/plans/${plan.id}/comments/${commentId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, role: 'agent', model }),
      })
      if (!res.ok) throw new Error(`Failed to reply: HTTP ${res.status}`)
      return textResult(`Replied to plan comment ${commentId}.`)
    },
  )

  server.registerTool(
    'resolve_plan_comment',
    {
      title: 'Resolve plan comment',
      description: 'Mark a plan review comment as resolved.',
      inputSchema: { commentId: z.string() },
    },
    async ({ commentId }) => {
      const base = baseUrl()
      const plan = await findPlanForComment(base, commentId)
      if (!plan) throw new Error(`Plan comment ${commentId} not found.`)
      const res = await fetch(`${base}/api/plans/${plan.id}/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      })
      if (!res.ok) throw new Error(`Failed to resolve: HTTP ${res.status}`)
      return textResult(`Resolved plan comment ${commentId}.`)
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
