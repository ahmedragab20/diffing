import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { readServerLock, isLockAlive } from './lib/server-lock.js'
import { formatComments } from './lib/comment-format.js'
import { formatPlanReview } from './lib/plan-format.js'
import type { ReviewComment } from './lib/types.js'
import type { Plan } from './lib/plan-types.js'

/**
 * Agent-facing `diffing` subcommands. These make the user→agent handoff
 * port-agnostic: each resolves the running server via the per-repo lockfile
 * (`server.json`) so any agent with a shell — or a human — can drive the loop
 * without being told a port.
 *
 *   diffing await-review   block until the human clicks "Send to agent"
 *   diffing reply <id>     post an agent reply to a comment
 *   diffing resolve <id>   mark a comment resolved
 *   diffing comments       dump the current comments (XML or JSON)
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
    console.error('No diffing server running for this repo. Start one with `diffing`.')
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
      console.error(`Failed to reach diffing server: ${err?.message ?? err}`)
      return EXIT_NO_SERVER
    }
    const result = await res.json()
    if (result.status === 'released') {
      process.stdout.write(result.payload.commentXml + '\n')
      console.error(`DIFFING_REVIEW_ROUND=${result.payload.round}`)
      return EXIT_OK
    }
    sinceRound = result.round ?? sinceRound
  }

  console.error('DIFFING_AWAIT_TIMEOUT')
  console.error('No review sent within the timeout. Run `diffing await-review` again to keep waiting.')
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
    console.error('Usage: diffing reply <commentId> --body <text> [--model <name>]')
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
    console.error('Usage: diffing resolve <commentId>')
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

// ── Plan review subcommands ─────────────────────────────────────────────────
// `diffing plan <action>` drives the plan-review handoff: submit a markdown plan
// for review, block until the human approves/rejects/requests-changes, and
// reply/resolve the inline comments — all port-agnostic via the lockfile.

/** Derive a human title from a plan's first heading or non-empty line. */
function deriveTitle(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    return (heading ? heading[1] : line).slice(0, 120)
  }
  return 'Untitled plan'
}

/** Long-poll the plan-review handoff until a decision arrives or time runs out. */
async function pollPlanDecision(base: string, totalBudgetMs: number, seedSince?: number): Promise<number> {
  let sinceRound = seedSince ?? 0
  if (seedSince === undefined) {
    try {
      const status = await fetch(`${base}/api/plan-review/status`).then((r) => r.json())
      sinceRound = status.round ?? 0
    } catch {
      // fall through; the await loop will surface a connection error
    }
  }

  const deadline = Date.now() + totalBudgetMs
  while (Date.now() < deadline) {
    let res: Response
    try {
      res = await fetch(
        `${base}/api/plan-review/await?timeoutMs=25000&sinceRound=${sinceRound}`,
        { signal: AbortSignal.timeout(30000) },
      )
    } catch (err: any) {
      if (err?.name === 'TimeoutError') continue
      console.error(`Failed to reach diffing server: ${err?.message ?? err}`)
      return EXIT_NO_SERVER
    }
    const result = await res.json()
    if (result.status === 'released') {
      process.stdout.write(result.payload.reviewXml + '\n')
      console.error(`DIFFING_PLAN_DECISION=${result.payload.decision}`)
      console.error(`DIFFING_PLAN_ROUND=${result.payload.round}`)
      return EXIT_OK
    }
    sinceRound = result.round ?? sinceRound
  }

  console.error('DIFFING_PLAN_AWAIT_TIMEOUT')
  console.error('No plan decision within the timeout. Run `diffing plan await` again to keep waiting.')
  return EXIT_AWAIT_TIMEOUT
}

async function planSubmit(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      title: { type: 'string' },
      source: { type: 'string', short: 's' },
      model: { type: 'string', short: 'm' },
      id: { type: 'string' },
      wait: { type: 'boolean', short: 'w' },
      timeout: { type: 'string', short: 't' },
    },
    allowPositionals: true,
  })

  const file = positionals[0]
  let body: string
  if (!file || file === '-') {
    body = await readStdin()
  } else {
    try {
      body = await readFile(file, 'utf-8')
    } catch (err: any) {
      console.error(`Failed to read plan file ${file}: ${err?.message ?? err}`)
      return EXIT_USAGE
    }
  }
  body = body.replace(/\r\n/g, '\n')
  if (!body.trim()) {
    console.error('A plan body is required (pass a markdown file path or pipe via stdin).')
    return EXIT_USAGE
  }

  const title = values.title || deriveTitle(body)
  const base = baseUrl()

  // Capture the current round so --wait only reacts to decisions after submit.
  let sinceRound = 0
  if (values.wait) {
    try {
      const status = await fetch(`${base}/api/plan-review/status`).then((r) => r.json())
      sinceRound = status.round ?? 0
    } catch {
      // surfaced by the poll loop below
    }
  }

  const res = await fetch(`${base}/api/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: values.id, title, body, source: values.source, model: values.model }),
  })
  if (!res.ok) {
    console.error(`Failed to submit plan: HTTP ${res.status}`)
    return 1
  }
  const plan = (await res.json()) as Plan
  console.error(`Submitted plan ${plan.id} (v${plan.version}) — review at ${base}/plan/${plan.id}`)

  if (!values.wait) {
    process.stdout.write(plan.id + '\n')
    return EXIT_OK
  }
  const totalBudgetMs = (values.timeout ? Number(values.timeout) : 570) * 1000
  return pollPlanDecision(base, totalBudgetMs, sinceRound)
}

async function planAwait(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { timeout: { type: 'string', short: 't' } },
    allowPositionals: false,
  })
  const totalBudgetMs = (values.timeout ? Number(values.timeout) : 570) * 1000
  return pollPlanDecision(baseUrl(), totalBudgetMs)
}

async function planList(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' } }, allowPositionals: false })
  const all: Plan[] = await fetch(`${baseUrl()}/api/plans`).then((r) => r.json())
  if (values.json) {
    process.stdout.write(JSON.stringify(all, null, 2) + '\n')
    return EXIT_OK
  }
  if (all.length === 0) {
    console.error('No plans submitted yet.')
    return EXIT_OK
  }
  for (const p of all) {
    const open = (p.comments ?? []).filter((c) => c.status === 'open').length
    process.stdout.write(`${p.id}\t[${p.decision}]\tv${p.version}\t${open} open comment(s)\t${p.title}\n`)
  }
  return EXIT_OK
}

async function planShow(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, options: { json: { type: 'boolean' } }, allowPositionals: true })
  const base = baseUrl()
  let planId = positionals[0]
  if (!planId) {
    const all: Plan[] = await fetch(`${base}/api/plans`).then((r) => r.json())
    if (all.length === 0) {
      console.error('No plans submitted yet.')
      return EXIT_NOT_FOUND
    }
    planId = all[all.length - 1].id
  }
  const res = await fetch(`${base}/api/plans/${planId}`)
  if (res.status === 404) {
    console.error(`Plan ${planId} not found.`)
    return EXIT_NOT_FOUND
  }
  const plan = (await res.json()) as Plan
  if (values.json) {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n')
  } else {
    process.stdout.write(formatPlanReview(plan) + '\n')
  }
  return EXIT_OK
}

/** Locate which plan owns a given comment id (comment ids are globally unique). */
async function findCommentPlan(base: string, commentId: string): Promise<Plan | null> {
  const all: Plan[] = await fetch(`${base}/api/plans`).then((r) => r.json())
  return all.find((p) => (p.comments ?? []).some((c) => c.id === commentId)) ?? null
}

async function planReply(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { body: { type: 'string', short: 'b' }, model: { type: 'string', short: 'm' } },
    allowPositionals: true,
  })
  const commentId = positionals[0]
  if (!commentId) {
    console.error('Usage: diffing plan reply <commentId> --body <text> [--model <name>]')
    return EXIT_USAGE
  }
  let body = values.body
  if (body === '-' || body === undefined) body = (await readStdin()).trim()
  if (!body) {
    console.error('A reply body is required (--body <text> or pipe via stdin).')
    return EXIT_USAGE
  }
  const base = baseUrl()
  const plan = await findCommentPlan(base, commentId)
  if (!plan) {
    console.error(`Plan comment ${commentId} not found.`)
    return EXIT_NOT_FOUND
  }
  const res = await fetch(`${base}/api/plans/${plan.id}/comments/${commentId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, role: 'agent', model: values.model }),
  })
  if (!res.ok) {
    console.error(`Failed to reply: HTTP ${res.status}`)
    return 1
  }
  console.error(`Replied to plan comment ${commentId}.`)
  return EXIT_OK
}

async function planResolve(args: string[]): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} })
  const commentId = positionals[0]
  if (!commentId) {
    console.error('Usage: diffing plan resolve <commentId>')
    return EXIT_USAGE
  }
  const base = baseUrl()
  const plan = await findCommentPlan(base, commentId)
  if (!plan) {
    console.error(`Plan comment ${commentId} not found.`)
    return EXIT_NOT_FOUND
  }
  const res = await fetch(`${base}/api/plans/${plan.id}/comments/${commentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' }),
  })
  if (!res.ok) {
    console.error(`Failed to resolve: HTTP ${res.status}`)
    return 1
  }
  console.error(`Resolved plan comment ${commentId}.`)
  return EXIT_OK
}

async function plan(args: string[]): Promise<number> {
  const action = args[0]
  const rest = args.slice(1)
  switch (action) {
    case 'submit':
      return planSubmit(rest)
    case 'await':
      return planAwait(rest)
    case 'list':
      return planList(rest)
    case 'show':
      return planShow(rest)
    case 'reply':
      return planReply(rest)
    case 'resolve':
      return planResolve(rest)
    default:
      console.error('Usage: diffing plan <submit|await|list|show|reply|resolve> [...]')
      return EXIT_USAGE
  }
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
    case 'plan':
      return plan(args)
    case 'update':
      const { runUpdateCommand } = await import('./lib/update-check.js')
      return runUpdateCommand()
    default:
      console.error(`Unknown subcommand: ${name}`)
      return EXIT_USAGE
  }
}
