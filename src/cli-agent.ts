import { parseArgs } from 'node:util'
import { readServerLock, isLockAlive } from './lib/server-lock.js'
import { formatComments } from './lib/comment-format.js'
import type { ReviewComment } from './lib/types.js'

/**
 * Agent-facing `diffit` subcommands. These make the user→agent handoff
 * port-agnostic: each resolves the running server via the per-repo lockfile
 * (`server.json`) so any agent with a shell — or a human — can drive the loop
 * without being told a port.
 *
 *   diffit await-review   block until the human clicks "Send to agent"
 *   diffit reply <id>     post an agent reply to a comment
 *   diffit resolve <id>   mark a comment resolved
 *   diffit comments       dump the current comments (XML or JSON)
 */

const EXIT_OK = 0
const EXIT_AWAIT_TIMEOUT = 2
const EXIT_NO_SERVER = 3
const EXIT_NOT_FOUND = 4
const EXIT_USAGE = 5

/** Resolve the running server's base URL from the lockfile, or exit cleanly. */
function baseUrl(): string {
  const lock = readServerLock()
  if (!lock || !isLockAlive(lock)) {
    console.error('No diffit server running for this repo. Start one with `diffit`.')
    process.exit(EXIT_NO_SERVER)
  }
  // Always connect over loopback even when the server bound 0.0.0.0, so the
  // CLI never traverses the network.
  const host = lock.host === '0.0.0.0' || lock.host === '::' ? '127.0.0.1' : lock.host
  return `http://${host}:${lock.port}`
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

async function awaitReview(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      timeout: { type: 'string', short: 't' },
      since: { type: 'string' },
    },
    allowPositionals: false,
  })
  const totalBudgetMs = (values.timeout ? Number(values.timeout) : 570) * 1000
  const base = baseUrl()

  // Seed the round cursor so we only react to sends that happen from now on.
  let sinceRound = 0
  try {
    const status = await fetch(`${base}/api/review/status`).then((r) => r.json())
    sinceRound = status.round ?? 0
  } catch {
    // fall through; the await loop will surface a connection error
  }

  const deadline = Date.now() + totalBudgetMs
  while (Date.now() < deadline) {
    let res: Response
    try {
      res = await fetch(
        `${base}/api/review/await?timeoutMs=25000&sinceRound=${sinceRound}`,
        { signal: AbortSignal.timeout(30000) },
      )
    } catch (err: any) {
      if (err?.name === 'TimeoutError') continue
      console.error(`Failed to reach diffit server: ${err?.message ?? err}`)
      return EXIT_NO_SERVER
    }
    const result = await res.json()
    if (result.status === 'released') {
      process.stdout.write(result.payload.commentXml + '\n')
      console.error(`DIFFIT_REVIEW_ROUND=${result.payload.round}`)
      return EXIT_OK
    }
    sinceRound = result.round ?? sinceRound
  }

  console.error('DIFFIT_AWAIT_TIMEOUT')
  console.error('No review sent within the timeout. Run `diffit await-review` again to keep waiting.')
  return EXIT_AWAIT_TIMEOUT
}

async function reply(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      body: { type: 'string', short: 'b' },
      model: { type: 'string', short: 'm' },
    },
    allowPositionals: true,
  })
  const commentId = positionals[0]
  if (!commentId) {
    console.error('Usage: diffit reply <commentId> --body <text> [--model <name>]')
    return EXIT_USAGE
  }
  let body = values.body
  if (body === '-' || body === undefined) body = (await readStdin()).trim()
  if (!body) {
    console.error('A reply body is required (--body <text> or pipe via stdin).')
    return EXIT_USAGE
  }

  const res = await fetch(`${baseUrl()}/api/comments/${commentId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, role: 'agent', model: values.model }),
  })
  if (res.status === 404) {
    console.error(`Comment ${commentId} not found.`)
    return EXIT_NOT_FOUND
  }
  if (!res.ok) {
    console.error(`Failed to reply: HTTP ${res.status}`)
    return 1
  }
  console.error(`Replied to ${commentId}.`)
  return EXIT_OK
}

async function resolve(args: string[]): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} })
  const commentId = positionals[0]
  if (!commentId) {
    console.error('Usage: diffit resolve <commentId>')
    return EXIT_USAGE
  }
  const res = await fetch(`${baseUrl()}/api/comments/${commentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' }),
  })
  if (res.status === 404) {
    console.error(`Comment ${commentId} not found.`)
    return EXIT_NOT_FOUND
  }
  if (!res.ok) {
    console.error(`Failed to resolve: HTTP ${res.status}`)
    return 1
  }
  console.error(`Resolved ${commentId}.`)
  return EXIT_OK
}

async function url(): Promise<number> {
  process.stdout.write(baseUrl() + '\n')
  return EXIT_OK
}

async function comments(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { open: { type: 'boolean' }, json: { type: 'boolean' } },
    allowPositionals: false,
  })
  const all: ReviewComment[] = await fetch(`${baseUrl()}/api/comments`).then((r) => r.json())
  const selected = values.open ? all.filter((c) => c.status === 'open') : all
  if (values.json) {
    process.stdout.write(JSON.stringify(selected, null, 2) + '\n')
  } else {
    process.stdout.write(formatComments(selected) + '\n')
  }
  return EXIT_OK
}

export async function runSubcommand(name: string, args: string[]): Promise<number> {
  switch (name) {
    case 'await-review':
      return awaitReview(args)
    case 'reply':
      return reply(args)
    case 'resolve':
      return resolve(args)
    case 'comments':
      return comments(args)
    case 'url':
      return url()
    default:
      console.error(`Unknown subcommand: ${name}`)
      return EXIT_USAGE
  }
}
