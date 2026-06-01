import { parseArgs } from 'node:util'
import { readServerLock, isLockAlive } from './lib/server-lock.js'
import { formatComments } from './lib/comment-format.js'
import type { ReviewComment } from './lib/types.js'
import type { PrSession } from './lib/pr-session.js'

/**
 * `diffing gh …` — the headless / port-agnostic surface for the PR review
 * mode. Mirrors the shape of the local review CLI: each subcommand resolves
 * the running server from the per-repo lockfile and talks to it via
 * localhost HTTP. No port ever leaves the lockfile.
 *
 *   diffing gh pr-fetch <ref>           → GET  /api/gh/pr/init then dump
 *   diffing gh pr-review                → POST /api/gh/submit (current session)
 *   diffing gh pr-list-comments         → GET  /api/gh/pr-session/comments (XML)
 *   diffing gh status                   → GET  /api/gh/session (one-line summary)
 */

const EXIT_OK = 0
const EXIT_AWAIT_TIMEOUT = 2
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

async function ghStatus(): Promise<number> {
  const base = baseUrl()
  const res = await fetch(`${base}/api/gh/session`)
  if (res.status === 404) {
    console.error('No active PR session. Start one with `diffing "gh pr <ref>"`.')
    return EXIT_NOT_FOUND
  }
  const s = (await res.json()) as PrSession & { prMode: boolean }
  const submittedLine = s.submittedAt
    ? `submitted at ${new Date(s.submittedAt).toISOString()} → ${s.submittedReviewUrl ?? '(no url)'}`
    : 'not submitted yet'
  console.log(`${s.owner}/${s.repo}#${s.pullNumber}  ${s.title}`)
  console.log(`  url:        ${s.url}`)
  console.log(`  author:     ${s.author?.login ?? '(unknown)'}`)
  console.log(`  +${s.additions} -${s.deletions}  (${s.changedFiles} files)`)
  console.log(`  head:       ${s.headSha.slice(0, 7)}`)
  console.log(`  base:       ${s.baseSha.slice(0, 7)}`)
  console.log(`  existing:   ${s.existingComments?.length ?? 0} review comments (read-only context)`)
  console.log(`  new:        ${s.comments?.length ?? 0} comments in this session`)
  console.log(`  status:     ${submittedLine}`)
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
  const res = await fetch(`${base}/api/gh/pr/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error(`Failed to fetch PR: ${(err as any).error ?? res.statusText}`)
    return 1
  }
  const result = (await res.json()) as Record<string, unknown>
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
  if (decision !== 'approve' && decision !== 'comment' && decision !== 'request-changes') {
    console.error('Usage: diffing gh pr-review --decision <approve|comment|request-changes> [--body <text>] [--dry-run]')
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
    case 'pr-fetch':
      return ghPrFetch(rest)
    case 'pr-review':
      return ghPrReview(rest)
    case 'pr-list-comments':
      return ghPrListComments()
    default:
      console.error('Usage: diffing gh <status|pr-fetch|pr-review|pr-list-comments> [...]')
      return EXIT_USAGE
  }
}
