import { parseArgs } from 'node:util'
import { readServerLock, isLockAlive } from './lib/server-lock.js'
import { formatComments } from './lib/comment-format.js'
import type { ReviewComment } from './lib/types.js'
import type { PrSession } from './lib/pr-session.js'
import type { PrOverviewPayload } from './lib/pr-agent-format.js'

/**
 * `diffing gh …` — the headless / port-agnostic surface for the PR review
 * mode. Mirrors the shape of the local review CLI: each subcommand resolves
 * the running server from the per-repo lockfile and talks to it via
 * localhost HTTP. No port ever leaves the lockfile.
 *
 *   diffing gh status                   → slim one-line summary (overview)
 *   diffing gh overview [--json]        → compact PR metadata (no patch/threads)
 *   diffing gh threads […]             → paged published threads (xml|json)
 *   diffing gh reviews […]             → paged submitted reviews (xml|json)
 *   diffing gh pr-fetch <ref>           → refresh / init PR session
 *   diffing gh pr-review                → POST /api/gh/submit (authorized mutation)
 *   diffing gh pr-list-comments         → local draft comments as XML
 */

const EXIT_OK = 0
const EXIT_NO_SERVER = 3
const EXIT_NOT_FOUND = 4
const EXIT_USAGE = 5

function baseUrl(): string {
  const lock = readServerLock()
  if (!lock || !isLockAlive(lock)) {
    console.error('No diffing server running for this repo. Start one with `diffing "gh pr <ref>"`.')
    process.exit(EXIT_NO_SERVER)
  }
  const host = lock.host === '0.0.0.0' || lock.host === '::' ? '127.0.0.1' : lock.host
  return `http://${host}:${lock.port}`
}

async function fetchJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${baseUrl()}${path}`)
  if (res.status === 404) {
    return { ok: false, status: 404, error: 'No active PR session. Start one with `diffing "gh pr <ref>"`.' }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { ok: false, status: res.status, error: (err as any).error ?? res.statusText }
  }
  return { ok: true, data: (await res.json()) as T }
}

async function ghOverview(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { json: { type: 'boolean' } },
    allowPositionals: false,
  })
  const result = await fetchJson<PrOverviewPayload & { prMode?: boolean }>('/api/gh/overview')
  if (!result.ok) {
    console.error(result.error)
    return result.status === 404 ? EXIT_NOT_FOUND : 1
  }
  const s = result.data
  if (values.json) {
    process.stdout.write(JSON.stringify(s, null, 2) + '\n')
    return EXIT_OK
  }
  const submittedLine = s.submittedAt
    ? `submitted at ${new Date(s.submittedAt).toISOString()} → ${s.submittedReviewUrl ?? '(no url)'}`
    : 'not submitted yet'
  console.log(`${s.owner}/${s.repo}#${s.pullNumber}  ${s.title}`)
  console.log(`  url:        ${s.url}`)
  console.log(`  author:     ${s.author?.login ?? '(unknown)'}`)
  console.log(`  +${s.additions} -${s.deletions}  (${s.changedFiles} files)  patchBytes=${s.patchBytes}`)
  console.log(`  head:       ${s.headSha.slice(0, 7)}`)
  console.log(`  base:       ${s.baseSha.slice(0, 7)}`)
  console.log(
    `  threads:    ${s.counts.publishedThreads} published (${s.counts.unresolvedThreads} unresolved, ${s.counts.outdatedThreads} outdated)`,
  )
  console.log(`  reviews:    ${s.counts.reviews} submitted review events`)
  console.log(`  drafts:     ${s.counts.localDrafts} local (${s.counts.openDrafts} open)`)
  console.log(`  status:     ${submittedLine}`)
  return EXIT_OK
}

async function ghStatus(): Promise<number> {
  // Prefer slim overview; fall back to fat session for older servers.
  const overview = await fetch(`${baseUrl()}/api/gh/overview`)
  if (overview.ok) {
    const session = (await overview.json()) as PrOverviewPayload
    const submitted = session.submittedAt
      ? `submitted ${new Date(session.submittedAt).toISOString()}`
      : 'not submitted'
    console.log(
      `PR #${session.pullNumber} ${session.owner}/${session.repo} ` +
      `[${session.headSha.slice(0, 7)}] — ${session.counts.localDrafts} local draft(s), ` +
      `${session.counts.unresolvedThreads} unresolved thread(s) — ${submitted}`,
    )
    return EXIT_OK
  }
  const res = await fetch(`${baseUrl()}/api/gh/session`)
  if (res.status === 404) {
    console.error('No active PR session. Start one with `diffing "gh pr <ref>"`.')
    return EXIT_NOT_FOUND
  }
  const s = (await res.json()) as PrSession & { prMode: boolean }
  if (!s.prMode) {
    console.error('No active PR session. Start one with `diffing "gh pr <ref>"`.')
    return EXIT_NOT_FOUND
  }
  const submittedLine = s.submittedAt
    ? `submitted at ${new Date(s.submittedAt).toISOString()} → ${s.submittedReviewUrl ?? '(no url)'}`
    : 'not submitted yet'
  console.log(`${s.owner}/${s.repo}#${s.pullNumber}  ${s.title}`)
  console.log(`  url:        ${s.url}`)
  console.log(`  author:     ${s.author?.login ?? '(unknown)'}`)
  console.log(`  +${s.additions} -${s.deletions}  (${s.changedFiles} files)`)
  console.log(`  head:       ${s.headSha.slice(0, 7)}`)
  console.log(`  base:       ${s.baseSha.slice(0, 7)}`)
  console.log(`  threads:    ${s.existingComments?.length ?? 0} published conversations`)
  console.log(`  reviews:    ${s.existingReviews?.length ?? 0} submitted review events`)
  console.log(`  new:        ${s.comments?.length ?? 0} comments in this session`)
  console.log(`  status:     ${submittedLine}`)
  return EXIT_OK
}

async function ghThreads(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      unresolved: { type: 'boolean' },
      path: { type: 'string' },
      author: { type: 'string' },
      cursor: { type: 'string' },
      limit: { type: 'string' },
      format: { type: 'string' },
      'full-body': { type: 'boolean' },
      'body-max': { type: 'string' },
      json: { type: 'boolean' },
    },
    allowPositionals: false,
  })
  const params = new URLSearchParams()
  if (values.unresolved) params.set('unresolvedOnly', 'true')
  if (values.path) params.set('path', values.path)
  if (values.author) params.set('author', values.author)
  if (values.cursor) params.set('cursor', values.cursor)
  if (values.limit) params.set('limit', values.limit)
  if (values['full-body']) params.set('fullBody', 'true')
  if (values['body-max']) params.set('bodyMaxChars', values['body-max'])
  const format = values.json ? 'json' : (values.format ?? 'xml')
  if (format !== 'xml' && format !== 'json') {
    console.error('diffing gh threads: --format must be xml or json')
    return EXIT_USAGE
  }
  params.set('format', format)

  const res = await fetch(`${baseUrl()}/api/gh/threads?${params}`)
  if (res.status === 404) {
    console.error('No active PR session.')
    return EXIT_NOT_FOUND
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error((err as any).error ?? res.statusText)
    return 1
  }
  if (format === 'xml') {
    process.stdout.write((await res.text()) + '\n')
  } else {
    const body = await res.json()
    process.stdout.write(JSON.stringify(body, null, values.json ? 2 : undefined) + '\n')
  }
  return EXIT_OK
}

async function ghReviews(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      cursor: { type: 'string' },
      limit: { type: 'string' },
      format: { type: 'string' },
      state: { type: 'string' },
      'full-body': { type: 'boolean' },
      'body-max': { type: 'string' },
      json: { type: 'boolean' },
    },
    allowPositionals: false,
  })
  const params = new URLSearchParams()
  if (values.cursor) params.set('cursor', values.cursor)
  if (values.limit) params.set('limit', values.limit)
  if (values.state) params.set('state', values.state)
  if (values['full-body']) params.set('fullBody', 'true')
  if (values['body-max']) params.set('bodyMaxChars', values['body-max'])
  const format = values.json ? 'json' : (values.format ?? 'xml')
  if (format !== 'xml' && format !== 'json') {
    console.error('diffing gh reviews: --format must be xml or json')
    return EXIT_USAGE
  }
  params.set('format', format)

  const res = await fetch(`${baseUrl()}/api/gh/reviews?${params}`)
  if (res.status === 404) {
    console.error('No active PR session.')
    return EXIT_NOT_FOUND
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error((err as any).error ?? res.statusText)
    return 1
  }
  if (format === 'xml') {
    process.stdout.write((await res.text()) + '\n')
  } else {
    const body = await res.json()
    process.stdout.write(JSON.stringify(body, null, values.json ? 2 : undefined) + '\n')
  }
  return EXIT_OK
}

async function ghPrFetch(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  })
  const ref = positionals[0]
  if (!ref) {
    console.error('Usage: diffing gh pr-fetch <ref> [--json]')
    return EXIT_USAGE
  }
  const base = baseUrl()
  // Prefer refresh so in-progress draft comments are preserved. Fall back to
  // init only when no session is active (refresh 404s).
  let res = await fetch(`${base}/api/gh/pr/refresh`, { method: 'POST' })
  if (res.status === 404) {
    res = await fetch(`${base}/api/gh/pr/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref }),
    })
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error(`Failed to fetch PR: ${(err as any).error ?? res.statusText}`)
    return 1
  }
  // Prefer slim overview after refresh to avoid dumping full session JSON.
  const overviewRes = await fetch(`${base}/api/gh/overview`)
  if (overviewRes.ok) {
    const result = (await overviewRes.json()) as Record<string, unknown>
    if (values.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      console.log(`${result.owner}/${result.repo}#${result.pullNumber}  ${result.url}`)
    }
    return EXIT_OK
  }
  const sessionRes = await fetch(`${base}/api/gh/session`)
  const result = sessionRes.ok
    ? ((await sessionRes.json()) as Record<string, unknown>)
    : ((await res.json()) as Record<string, unknown>)
  if (values.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    console.log(`${result.owner}/${result.repo}#${result.pullNumber}  ${result.url}`)
  }
  return EXIT_OK
}

async function ghPrListComments(): Promise<number> {
  const base = baseUrl()
  const res = await fetch(`${base}/api/gh/pr-session/comments`)
  if (res.status === 404) {
    console.error('No active PR session.')
    return EXIT_NOT_FOUND
  }
  const comments = (await res.json()) as ReviewComment[]
  // Re-use the local review XML format so the output is consistent across modes.
  process.stdout.write(formatComments(comments) + '\n')
  return EXIT_OK
}

async function ghPrReview(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      decision: { type: 'string', short: 'd' },
      body: { type: 'string', short: 'b' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: false,
  })
  const decision = values.decision
  if (
    decision !== 'approve' &&
    decision !== 'comment' &&
    decision !== 'request-changes' &&
    decision !== 'draft'
  ) {
    console.error(
      'Usage: diffing gh pr-review --decision <approve|comment|request-changes|draft> [--body <text>] [--dry-run]',
    )
    return EXIT_USAGE
  }
  const base = baseUrl()
  const payload = {
    decision,
    body: values.body ?? '',
    dryRun: values['dry-run'] === true,
  }
  const res = await fetch(`${base}/api/gh/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error(`Failed to submit review: ${(err as any).error ?? res.statusText}`)
    return 1
  }
  const result = (await res.json()) as {
    ok: boolean
    reviewId?: number
    reviewUrl?: string
    authSource: 'gh' | 'token' | 'none'
    error?: string
    dryRun?: boolean
  }
  if (values.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else if (result.ok) {
    if (result.dryRun) {
      console.log('Dry run OK — payload would have been accepted by GitHub.')
    } else {
      console.log(`Review submitted via ${result.authSource}: ${result.reviewUrl ?? `#${result.reviewId}`}`)
    }
  } else {
    console.error(`Submit failed (auth=${result.authSource}): ${result.error ?? 'unknown error'}`)
    return 1
  }
  return EXIT_OK
}

export async function runGhSubcommand(args: string[]): Promise<number> {
  const action = args[0]
  const rest = args.slice(1)
  switch (action) {
    case 'status':
      return ghStatus()
    case 'overview':
      return ghOverview(rest)
    case 'threads':
      return ghThreads(rest)
    case 'reviews':
      return ghReviews(rest)
    case 'pr-fetch':
      return ghPrFetch(rest)
    case 'pr-review':
      return ghPrReview(rest)
    case 'pr-list-comments':
      return ghPrListComments()
    default:
      console.error(
        'Usage: diffing gh <status|overview|threads|reviews|pr-fetch|pr-review|pr-list-comments> [...]',
      )
      return EXIT_USAGE
  }
}
