import { parseArgs } from 'node:util'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readServerLock, isLockAlive } from './lib/server-lock.js'
import { getProjectStorageDir } from './lib/git.js'
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

let activeCapability: string | undefined

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
  activeCapability = lock.mode === 'tui' ? lock.capability : undefined
  return `http://${host}:${lock.port}`
}

/** Attach the per-session TUI capability while preserving ordinary web calls. */
function apiFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (activeCapability) headers.set('X-Diffing-Capability', activeCapability)
  return fetch(input, { ...init, headers })
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
      model: { type: 'string', short: 'm' },
      label: { type: 'string' },
      'agent-id': { type: 'string' },
    },
    allowPositionals: false,
  })
  const totalBudgetMs = (values.timeout ? Number(values.timeout) : 570) * 1000
  const base = baseUrl()

  // Register identity so the human UI can show multi-agent waiting chips.
  let agentId: string | undefined =
    typeof values['agent-id'] === 'string' ? values['agent-id'] : undefined
  try {
    const reg = await apiFetch(`${base}/api/agent/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        model: values.model,
        label: values.label ?? values.model,
      }),
    })
    if (reg.ok) {
      const body = (await reg.json()) as { agentId?: string }
      agentId = body.agentId ?? agentId
    }
  } catch {
    // Identity is best-effort; await still works without it.
  }

  // Seed the round cursor so we only react to sends that happen from now on.
  let sinceRound = 0
  try {
    const status = await apiFetch(`${base}/api/review/status`).then((r) => r.json())
    sinceRound = status.round ?? 0
  } catch {
    // fall through; the await loop will surface a connection error
  }

  const unregister = async () => {
    if (!agentId) return
    try {
      await apiFetch(`${base}/api/agent/register/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
      })
    } catch {
      /* ignore */
    }
  }

  const deadline = Date.now() + totalBudgetMs
  while (Date.now() < deadline) {
    let res: Response
    try {
      res = await apiFetch(
        `${base}/api/review/await?timeoutMs=25000&sinceRound=${sinceRound}`,
        { signal: AbortSignal.timeout(30000) },
      )
    } catch (err: any) {
      if (err?.name === 'TimeoutError') continue
      console.error(`Failed to reach diffing server: ${err?.message ?? err}`)
      await unregister()
      return EXIT_NO_SERVER
    }
    const result = await res.json()
    if (result.status === 'released') {
      process.stdout.write(result.payload.commentXml + '\n')
      console.error(`DIFFING_REVIEW_ROUND=${result.payload.round}`)
      await unregister()
      return EXIT_OK
    }
    sinceRound = result.round ?? sinceRound
  }

  console.error('DIFFING_AWAIT_TIMEOUT')
  console.error('No review sent within the timeout. Run `diffing await-review` again to keep waiting.')
  await unregister()
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

  const res = await apiFetch(`${baseUrl()}/api/comments/${commentId}/replies`, {
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
  const res = await apiFetch(`${baseUrl()}/api/comments/${commentId}`, {
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

async function unresolve(args: string[]): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} })
  const commentId = positionals[0]
  if (!commentId) {
    console.error('Usage: diffing unresolve <commentId>')
    return EXIT_USAGE
  }
  const res = await apiFetch(`${baseUrl()}/api/comments/${commentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'open' }),
  })
  if (res.status === 404) {
    console.error(`Comment ${commentId} not found.`)
    return EXIT_NOT_FOUND
  }
  if (!res.ok) {
    console.error(`Failed to unresolve: HTTP ${res.status}`)
    return 1
  }
  console.error(`Re-opened ${commentId}.`)
  return EXIT_OK
}

async function commentEdit(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { body: { type: 'string', short: 'b' } },
    allowPositionals: true,
  })
  const commentId = positionals[0]
  if (!commentId) {
    console.error('Usage: diffing comment edit <commentId> --body <text>')
    return EXIT_USAGE
  }
  let body = values.body as string | undefined
  if (body === '-' || body === undefined) body = (await readStdin()).trim()
  if (!body) {
    console.error('A body is required (--body <text> or stdin).')
    return EXIT_USAGE
  }
  const res = await apiFetch(`${baseUrl()}/api/comments/${commentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  if (res.status === 404) {
    console.error(`Comment ${commentId} not found.`)
    return EXIT_NOT_FOUND
  }
  if (!res.ok) {
    console.error(`Failed to edit: HTTP ${res.status}`)
    return 1
  }
  console.error(`Edited ${commentId}.`)
  return EXIT_OK
}

async function commentDelete(args: string[]): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} })
  const commentId = positionals[0]
  if (!commentId) {
    console.error('Usage: diffing comment delete <commentId>')
    return EXIT_USAGE
  }
  const res = await apiFetch(`${baseUrl()}/api/comments/${commentId}`, {
    method: 'DELETE',
  })
  if (res.status === 404) {
    console.error(`Comment ${commentId} not found.`)
    return EXIT_NOT_FOUND
  }
  if (!res.ok) {
    console.error(`Failed to delete: HTTP ${res.status}`)
    return 1
  }
  console.error(`Deleted ${commentId}.`)
  return EXIT_OK
}

async function commentCmd(args: string[]): Promise<number> {
  const action = args[0]
  const rest = args.slice(1)
  switch (action) {
    case 'edit':
      return commentEdit(rest)
    case 'delete':
      return commentDelete(rest)
    default:
      console.error('Usage: diffing comment <edit|delete> ...')
      return EXIT_USAGE
  }
}

async function url(): Promise<number> {
  process.stdout.write(baseUrl() + '\n')
  return EXIT_OK
}

async function comments(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      open: { type: 'boolean' },
      json: { type: 'boolean' },
      format: { type: 'string' },
    },
    allowPositionals: false,
  })
  const all: ReviewComment[] = await apiFetch(`${baseUrl()}/api/comments`).then((r) => r.json())
  const selected = values.open ? all.filter((c) => c.status === 'open') : all
  const format = (values.format as string | undefined)?.toLowerCase()
  if (values.json || format === 'json') {
    process.stdout.write(JSON.stringify(selected, null, 2) + '\n')
  } else if (format === 'markdown' || format === 'md') {
    const { formatCommentsMarkdown } = await import('./lib/review-export.js')
    process.stdout.write(formatCommentsMarkdown(selected) + '\n')
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
      const status = await apiFetch(`${base}/api/plan-review/status`).then((r) => r.json())
      sinceRound = status.round ?? 0
    } catch {
      // fall through; the await loop will surface a connection error
    }
  }

  const deadline = Date.now() + totalBudgetMs
  while (Date.now() < deadline) {
    let res: Response
    try {
      res = await apiFetch(
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
      saveSource: { type: 'boolean', short: 'S' },
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
  // Prefer an explicit --source; otherwise stamp the absolute path of the
  // input file so reviewers can copy it from the UI for agent handoff.
  let source = values.source
  if (!source && file && file !== '-') {
    try {
      const { resolve } = await import('node:path')
      source = resolve(file)
    } catch {
      source = file
    }
  }

  // Capture the current round so --wait only reacts to decisions after submit.
  let sinceRound = 0
  if (values.wait) {
    try {
      const status = await apiFetch(`${base}/api/plan-review/status`).then((r) => r.json())
      sinceRound = status.round ?? 0
    } catch {
      // surfaced by the poll loop below
    }
  }

  const res = await apiFetch(`${base}/api/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: values.id, title, body, source, model: values.model }),
  })
  if (!res.ok) {
    console.error(`Failed to submit plan: HTTP ${res.status}`)
    return 1
  }
  const plan = (await res.json()) as Plan
  console.error(`Submitted plan ${plan.id} (v${plan.version}) — review at ${base}/plan/${plan.id}`)
  if (plan.sourcePath) {
    console.error(`Source path: ${plan.sourcePath}`)
  }

  // Optional extra mirror next to the input file (--saveSource). Server always
  // writes ~/.diffing/.../plan-sources/<id>.md as sourcePath.
  if (values.saveSource) {
    try {
      const sourcesDir = join(getProjectStorageDir(), 'plan-sources')
      await mkdir(sourcesDir, { recursive: true })
      const sourcePath = join(sourcesDir, `${plan.id}.md`)
      await writeFile(sourcePath, body, 'utf-8')
      console.error(`Saved source to ${sourcePath}`)
    } catch (err: any) {
      console.error(`Failed to save plan source: ${err?.message ?? err}`)
    }
  }

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
  const all: Plan[] = await apiFetch(`${baseUrl()}/api/plans`).then((r) => r.json())
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
  const { values, positionals } = parseArgs({
    args,
    options: { json: { type: 'boolean' }, version: { type: 'string' } },
    allowPositionals: true,
  })
  const base = baseUrl()
  let planId = positionals[0]
  if (!planId) {
    const all: Plan[] = await apiFetch(`${base}/api/plans`).then((r) => r.json())
    if (all.length === 0) {
      console.error('No plans submitted yet.')
      return EXIT_NOT_FOUND
    }
    planId = all[all.length - 1].id
  }
  const res = await apiFetch(`${base}/api/plans/${planId}`)
  if (res.status === 404) {
    console.error(`Plan ${planId} not found.`)
    return EXIT_NOT_FOUND
  }
  const plan = (await res.json()) as Plan
  const requestedVersion = values.version !== undefined ? Number(values.version) : undefined
  if (requestedVersion !== undefined && (!Number.isFinite(requestedVersion) || requestedVersion < 1)) {
    console.error(`--version must be a positive integer.`)
    return EXIT_USAGE
  }
  if (requestedVersion !== undefined && requestedVersion !== plan.version) {
    const ver = (plan.versions ?? []).find((v) => v.version === requestedVersion)
    if (!ver) {
      console.error(`Version ${requestedVersion} not found for plan ${planId} (current: v${plan.version}).`)
      return EXIT_NOT_FOUND
    }
  }
  if (values.json) {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n')
  } else {
    process.stdout.write(formatPlanReview(plan, { viewingVersion: requestedVersion }) + '\n')
  }
  return EXIT_OK
}

async function planVersions(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { json: { type: 'boolean' } },
    allowPositionals: true,
  })
  const base = baseUrl()
  let planId = positionals[0]
  if (!planId) {
    console.error('Usage: diffing plan versions <id> [--json]')
    return EXIT_USAGE
  }
  const planRes = await apiFetch(`${base}/api/plans/${planId}`)
  if (planRes.status === 404) {
    console.error(`Plan ${planId} not found.`)
    return EXIT_NOT_FOUND
  }
  const plan = (await planRes.json()) as Plan
  const versions = plan.versions ?? []
  if (values.json) {
    process.stdout.write(JSON.stringify(versions, null, 2) + '\n')
    return EXIT_OK
  }
  if (versions.length === 0) {
    console.error('This plan has no recorded versions.')
    return EXIT_OK
  }
  for (const v of versions) {
    const marker = v.version === plan.version ? '*' : ' '
    const date = new Date(v.createdAt).toISOString().slice(0, 16).replace('T', ' ')
    process.stdout.write(`${marker} v${v.version}\t${date}\t${v.title}\n`)
  }
  return EXIT_OK
}

/** Locate which plan owns a given comment id (comment ids are globally unique). */
async function findCommentPlan(base: string, commentId: string): Promise<Plan | null> {
  const all: Plan[] = await apiFetch(`${base}/api/plans`).then((r) => r.json())
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
  const res = await apiFetch(`${base}/api/plans/${plan.id}/comments/${commentId}/replies`, {
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
  const res = await apiFetch(`${base}/api/plans/${plan.id}/comments/${commentId}`, {
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
    case 'versions':
      return planVersions(rest)
    case 'reply':
      return planReply(rest)
    case 'resolve':
      return planResolve(rest)
    default:
      console.error('Usage: diffing plan <submit|await|list|show|versions|reply|resolve> [...]')
      return EXIT_USAGE
  }
}

async function doctor(): Promise<number> {
  const { runDoctor, formatDoctorReport } = await import('./lib/doctor.js')
  const report = await runDoctor({ cwd: process.cwd(), cliImportMetaUrl: import.meta.url })
  process.stdout.write(formatDoctorReport(report) + '\n')
  return report.ok ? EXIT_OK : 1
}

async function completion(args: string[]): Promise<number> {
  const shell = args[0]
  if (!shell || args.includes('--help') || args.includes('-h')) {
    console.error('Usage: diffing completion <bash|zsh|fish>')
    console.error('  # Install examples:')
    console.error('  #   diffing completion bash >> ~/.bashrc')
    console.error('  #   diffing completion zsh  > ~/.zfunc/_diffing')
    console.error('  #   diffing completion fish > ~/.config/fish/completions/diffing.fish')
    return EXIT_USAGE
  }
  const { completionFor } = await import('./lib/completions.js')
  const script = completionFor(shell)
  if (!script) {
    console.error(`Unknown shell: ${shell}. Use bash, zsh, or fish.`)
    return EXIT_USAGE
  }
  process.stdout.write(script)
  return EXIT_OK
}

async function progress(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      message: { type: 'string', short: 'm' },
      model: { type: 'string' },
      'agent-id': { type: 'string' },
      pct: { type: 'string' },
      'comment-id': { type: 'string' },
    },
    allowPositionals: true,
  })
  const message =
    (values.message as string | undefined) ||
    (args.find((a) => !a.startsWith('-')) ?? '')
  if (!message) {
    console.error('Usage: diffing progress --message "Working on comment…" [--model M] [--pct N]')
    return EXIT_USAGE
  }
  const base = baseUrl()
  const res = await apiFetch(`${base}/api/agent/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      model: values.model,
      agentId: values['agent-id'],
      commentId: values['comment-id'],
      pct: values.pct != null ? Number(values.pct) : undefined,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error((err as any).error ?? res.statusText)
    return 1
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
    case 'unresolve':
      return unresolve(args)
    case 'comment':
      return commentCmd(args)
    case 'comments':
      return comments(args)
    case 'url':
      return url()
    case 'plan':
      return plan(args)
    case 'update':
      const { runUpdateCommand } = await import('./lib/update-check.js')
      return runUpdateCommand()
    case 'gh':
      const { runGhSubcommand } = await import('./cli-gh.js')
      return runGhSubcommand(args)
    case 'doctor':
      return doctor()
    case 'completion':
      return completion(args)
    case 'progress':
      return progress(args)
    default:
      console.error(`Unknown subcommand: ${name}`)
      return EXIT_USAGE
  }
}
