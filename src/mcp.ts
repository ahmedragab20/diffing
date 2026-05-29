import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readServerLock, isLockAlive } from './lib/server-lock.js'
import { formatComments } from './lib/comment-format.js'
import type { ReviewComment } from './lib/types.js'

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

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
