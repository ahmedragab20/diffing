import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  PrSession,
  PrExistingComment,
  PrAuthor,
} from './pr-session.js'
import type { ReviewComment } from './types.js'

const execFileAsync = promisify(execFile)

export type AuthSource = 'gh' | 'token' | 'none'

export interface GhCliInfo {
  available: boolean
  authenticated: boolean
  version?: string
  user?: string
}

/**
 * Probe the `gh` CLI: is it on `$PATH`, and is the user authenticated?
 * Never throws — returns a permissive `available: false` on any failure.
 */
export async function detectGhCli(): Promise<GhCliInfo> {
  try {
    const { stdout } = await execFileAsync('gh', ['--version'], { encoding: 'utf-8' })
    const version = stdout.split('\n')[0]?.trim() || undefined
    try {
      const { stdout: statusOut } = await execFileAsync('gh', ['auth', 'status'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      // `gh auth status` writes the user on success. Output is "Logged in to github.com as <user> (oauth_token)".
      const userMatch = /as\s+([^\s(]+)/.exec(statusOut)
      return {
        available: true,
        authenticated: true,
        version,
        user: userMatch?.[1],
      }
    } catch {
      return { available: true, authenticated: false, version }
    }
  } catch {
    return { available: false, authenticated: false }
  }
}

/** Read the most-preferred GitHub token from the env. */
export function readGithubToken(): string | null {
  const env = process.env
  return env.GH_TOKEN || env.GITHUB_TOKEN || env.GITHUB_API_TOKEN || null
}

/** Detect which auth source we'd actually use for an HTTP call. */
export function detectAuthSource(): AuthSource {
  if (readGithubToken()) return 'token'
  // We can't tell if `gh` is logged in without shelling out; the caller can
  // do a quick `detectGhCli` check first and override.
  return 'none'
}

// ── PR metadata ─────────────────────────────────────────────────────────

export interface PrMetadata {
  number: number
  title: string
  url: string
  author: PrAuthor | null
  baseSha: string
  headSha: string
  additions: number
  deletions: number
  changedFiles: number
  owner: string
  repo: string
  diff: string
  existingComments: PrExistingComment[]
}

/**
 * Parse a `gh pr <ref>` input into `{ owner, repo, pullNumber }`. Accepts:
 *   - `1234`                              → uses the cwd repo
 *   - `https://github.com/o/r/pull/1234`  → extracts from the URL
 *   - `o/r#1234`                          → shorthand
 * If `cwdRepo` is provided, bare numbers and `o/r#1234` resolve against it.
 */
export interface ResolvedPr {
  owner: string
  repo: string
  pullNumber: number
  /** The original input, for diagnostic / persistence. */
  ref: string
}

export function parsePrRef(input: string, cwdRepo?: { owner: string; repo: string }): ResolvedPr {
  const trimmed = input.trim()
  // URL form
  const urlMatch =
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(trimmed)
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], pullNumber: Number(urlMatch[3]), ref: trimmed }
  }
  // `o/r#1234` shorthand
  const shorthand = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(trimmed)
  if (shorthand) {
    return { owner: shorthand[1], repo: shorthand[2], pullNumber: Number(shorthand[3]), ref: trimmed }
  }
  // bare number — use cwd repo
  const bare = /^#?(\d+)$/.exec(trimmed)
  if (bare && cwdRepo) {
    return { owner: cwdRepo.owner, repo: cwdRepo.repo, pullNumber: Number(bare[1]), ref: trimmed }
  }
  if (bare) {
    throw new Error(
      `Cannot resolve bare PR number "${trimmed}" — run from inside the target repo, or pass a full URL or \`owner/repo#1234\`.`,
    )
  }
  throw new Error(`Unrecognised PR ref: ${trimmed}`)
}

/**
 * Best-effort: derive `{ owner, repo }` for the current working directory
 * from `git remote get-url origin`. Falls back to throwing.
 */
export async function detectCwdRepo(): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['remote', 'get-url', 'origin'],
      { encoding: 'utf-8' },
    )
    const url = stdout.trim()
    // ssh://git@github.com/owner/repo.git or git@github.com:owner/repo.git or https://github.com/owner/repo.git
    const m =
      /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(url)
    if (m) return { owner: m[1], repo: m[2] }
  } catch {
    // fall through
  }
  return null
}

/**
 * Fetch PR metadata + diff + existing review comments using `gh`.
 * Throws with a user-readable message on failure.
 */
export async function fetchPrMetadataViaGh(resolved: ResolvedPr): Promise<PrMetadata> {
  // `gh pr view <ref> -R <owner>/<repo> --json ...` for the metadata.
  // `gh pr diff <ref> -R <owner>/<repo>` for the unified diff.
  // `gh api ...` for the existing comments (paginated).
  const repo = `${resolved.owner}/${resolved.repo}`
  const args = ['-R', repo]

  let metaJson: any
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'view',
        String(resolved.pullNumber),
        ...args,
        '--json',
        'number,title,url,author,baseRefOid,headRefOid,additions,deletions,changedFiles,headRepositoryOwner,headRepository',
      ],
      { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 },
    )
    metaJson = JSON.parse(stdout)
  } catch (err: any) {
    const stderr = err?.stderr || err?.message || 'unknown error'
    throw new Error(`gh pr view failed: ${stderr.trim()}`)
  }

  let diff = ''
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'diff', String(resolved.pullNumber), ...args],
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
    )
    diff = stdout
  } catch (err: any) {
    const stderr = err?.stderr || err?.message || 'unknown error'
    throw new Error(`gh pr diff failed: ${stderr.trim()}`)
  }

  // Author: the JSON shape uses `headRepositoryOwner` for the owning org/user.
  const headOwner =
    metaJson.headRepositoryOwner?.login || metaJson.headRepository?.owner?.login || resolved.owner
  const repoName = metaJson.headRepository?.name || resolved.repo
  const author = metaJson.author
    ? { login: metaJson.author.login, avatarUrl: metaJson.author.avatarUrl }
    : null

  // Existing comments (paginated) + reviews (for state).
  const existingComments = await fetchExistingCommentsViaGh(resolved)

  return {
    number: metaJson.number,
    title: metaJson.title,
    url: metaJson.url,
    author,
    baseSha: metaJson.baseRefOid,
    headSha: metaJson.headRefOid,
    additions: metaJson.additions,
    deletions: metaJson.deletions,
    changedFiles: metaJson.changedFiles,
    owner: headOwner,
    repo: repoName,
    diff,
    existingComments,
  }
}

async function fetchExistingCommentsViaGh(resolved: ResolvedPr): Promise<PrExistingComment[]> {
  const repo = `${resolved.owner}/${resolved.repo}`
  const endpoint = `repos/${resolved.owner}/${resolved.repo}/pulls/${resolved.pullNumber}/comments`
  const reviewsEndpoint = `repos/${resolved.owner}/${resolved.repo}/pulls/${resolved.pullNumber}/reviews`

  // Reviews: cap at 50 most-recent (sort desc, take first 50, then reverse to chronological).
  // We need the `state` field on each review.
  let reviews: Array<{ id: number; state: string; submitted_at: string }> = []
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', reviewsEndpoint, '--paginate'],
      { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 },
    )
    const all = JSON.parse(stdout)
    if (Array.isArray(all)) reviews = all
  } catch {
    // continue without review state — comments will be unlabelled.
  }
  // newest first; sort by submitted_at desc and take 50.
  reviews.sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1))
  const recentReviews = reviews.slice(0, 50)
  const reviewStateById = new Map<number, string>()
  for (const r of recentReviews) reviewStateById.set(r.id, r.state)

  // Comments: paginate through.
  let commentsRaw: any[] = []
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `${endpoint}?per_page=100`, '--paginate'],
      { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 },
    )
    const parsed = JSON.parse(stdout)
    if (Array.isArray(parsed)) commentsRaw = parsed
  } catch {
    return []
  }

  // Each top-level review comment is a single "comment". Replies come back as
  // separate items on the same endpoint with `in_reply_to_id` set. We group
  // them: top-levels keep their own shape, replies nest into `replies`.
  const byId = new Map<number, any>()
  for (const c of commentsRaw) byId.set(c.id, c)
  const replyByParent = new Map<number, any[]>()
  for (const c of commentsRaw) {
    if (c.in_reply_to_id && byId.has(c.in_reply_to_id)) {
      const list = replyByParent.get(c.in_reply_to_id) ?? []
      list.push(c)
      replyByParent.set(c.in_reply_to_id, list)
    }
  }

  const tops: PrExistingComment[] = []
  for (const c of commentsRaw) {
    if (c.in_reply_to_id) continue
    const state = c.pull_request_review_id
      ? reviewStateById.get(c.pull_request_review_id) ?? null
      : null
    tops.push({
      id: c.id,
      author: c.user ? { login: c.user.login, avatarUrl: c.user.avatar_url } : null,
      body: c.body ?? '',
      path: c.path,
      line: typeof c.line === 'number' ? c.line : null,
      side: c.side === 'LEFT' || c.side === 'RIGHT' ? c.side : null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      state: state as PrExistingComment['state'],
      replies: (replyByParent.get(c.id) ?? []).map((r) => ({
        id: r.id,
        author: r.user ? { login: r.user.login, avatarUrl: r.user.avatar_url } : null,
        body: r.body ?? '',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      isOutdated: typeof c.position === 'number' && c.position === null ? false : false,
    })
  }

  // Sort: by file path, then by line.
  tops.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path)
    return (a.line ?? 0) - (b.line ?? 0)
  })
  return tops
}

// ── Submitting reviews ─────────────────────────────────────────────────

export interface SubmitInput {
  resolved: ResolvedPr
  decision: 'approve' | 'comment' | 'request-changes'
  body: string
  comments: ReviewComment[]
}

export interface SubmitOutput {
  ok: boolean
  reviewId?: number
  reviewUrl?: string
  /** Number of inline comments that failed to land (anchors to deleted lines, etc.). */
  failedComments?: number
  /** Which auth path we used. */
  authSource: 'gh' | 'token'
  /** First error message (if any), for the UI to show. */
  error?: string
}

/**
 * POST the review to GitHub. Prefers `gh api` (uses the user's existing
 * `gh auth`); falls back to a direct HTTP call with `$GITHUB_TOKEN` when
 * `gh` is unavailable.
 */
export async function submitReview(input: SubmitInput): Promise<SubmitOutput> {
  const gh = await detectGhCli()
  if (gh.available && gh.authenticated) {
    return submitViaGh(input)
  }
  const token = readGithubToken()
  if (token) {
    return submitViaToken(input, token)
  }
  return {
    ok: false,
    authSource: 'none',
    error:
      'Cannot submit: no `gh` CLI on $PATH (or not authenticated) and no $GITHUB_TOKEN env var. Run `gh auth login` or set $GITHUB_TOKEN.',
  }
}

/**
 * Map our `PrDecision` to the GitHub REST event string. Exported so the
 * test suite can pin the mapping (including the `rejected → REQUEST_CHANGES`
 * quirk, which exists because GitHub has no REJECT event).
 */
export function decisionToEvent(decision: 'approve' | 'comment' | 'request-changes'): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
  if (decision === 'approve') return 'APPROVE'
  if (decision === 'request-changes') return 'REQUEST_CHANGES'
  return 'COMMENT'
}

/**
 * Expand multi-line `ReviewComment`s into N single-line `gh`-shaped entries
 * with `[part N/M]` prefixes. Exported for the test suite — the body of the
 * caller (`buildReviewPayload`) is otherwise private.
 *
 * Skips: non-`open` comments, file-level comments (`lineNumber === 0`).
 * Strips the `a/` / `b/` prefix from the file path (GitHub expects PR-relative
 * paths in the `path` field).
 */
export function expandMultiLineComments(
  comments: ReviewComment[],
): Array<{ path: string; line: number; side: 'RIGHT'; body: string }> {
  const flat: Array<{ path: string; line: number; side: 'RIGHT'; body: string }> = []
  for (const c of comments) {
    if (c.status !== 'open') continue
    if (c.lineNumber === 0) continue
    const path = stripBPrefix(c.filePath)
    const start = c.startLineNumber && c.startLineNumber < c.lineNumber ? c.startLineNumber : c.lineNumber
    const end = c.lineNumber
    const span = end - start + 1
    if (span > 1) {
      for (let i = 0; i < span; i++) {
        flat.push({
          path,
          line: start + i,
          side: 'RIGHT',
          body: `[part ${i + 1}/${span}]\n${c.body}`,
        })
      }
    } else {
      flat.push({ path, line: end, side: 'RIGHT', body: c.body })
    }
  }
  return flat
}

export function buildReviewPayload(
  input: Pick<SubmitInput, 'body' | 'decision' | 'comments'>,
): {
  body: string | undefined
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  comments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }>
} {
  return {
    body: input.body,
    event: decisionToEvent(input.decision ?? 'comment'),
    comments: expandMultiLineComments(input.comments ?? []),
  }
}

function stripBPrefix(path: string): string {
  if (path.startsWith('b/')) return path.slice(2)
  if (path.startsWith('a/')) return path.slice(2)
  return path
}

async function submitViaGh(input: SubmitInput): Promise<SubmitOutput> {
  const payload = buildReviewPayload(input)
  const repo = `${input.resolved.owner}/${input.resolved.repo}`
  const endpoint = `repos/${input.resolved.owner}/${input.resolved.repo}/pulls/${input.resolved.pullNumber}/reviews`
  // `gh api` accepts a JSON body via `--input -` + stdin. Pass it via env to
  // avoid argv length limits on huge reviews.
  const args = [
    'api',
    '--method',
    'POST',
    endpoint,
    '-H',
    'Accept: application/vnd.github+json',
    '--input',
    '-',
  ]
  try {
    const { stdout } = await execFileAsync('gh', args, {
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
      input: JSON.stringify(payload),
    })
    const result = JSON.parse(stdout)
    return {
      ok: true,
      authSource: 'gh',
      reviewId: result.id,
      reviewUrl: result.html_url,
    }
  } catch (err: any) {
    // `gh api` surfaces GitHub's error JSON in stdout when the response is 4xx.
    const stdout = err?.stdout || ''
    const stderr = err?.stderr || err?.message || 'unknown error'
    let parsed: any = null
    try {
      parsed = JSON.parse(stdout)
    } catch {
      // not JSON
    }
    const ghMessage = parsed?.message || stderr.trim()
    return {
      ok: false,
      authSource: 'gh',
      error: ghMessage,
    }
  }
}

async function submitViaToken(input: SubmitInput, token: string): Promise<SubmitOutput> {
  const payload = buildReviewPayload(input)
  const url = `https://api.github.com/repos/${input.resolved.owner}/${input.resolved.repo}/pulls/${input.resolved.pullNumber}/reviews`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'diffing-cli',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      return {
        ok: false,
        authSource: 'token',
        error: `HTTP ${res.status}: ${errBody.slice(0, 500)}`,
      }
    }
    const result = (await res.json()) as { id: number; html_url: string }
    return {
      ok: true,
      authSource: 'token',
      reviewId: result.id,
      reviewUrl: result.html_url,
    }
  } catch (err: any) {
    return {
      ok: false,
      authSource: 'token',
      error: err?.message || 'Network error',
    }
  }
}

// ── Building a PrSession ───────────────────────────────────────────────

export async function buildPrSession(ref: string): Promise<PrSession> {
  const cwdRepo = await detectCwdRepo()
  const resolved = parsePrRef(ref, cwdRepo ?? undefined)
  const meta = await fetchPrMetadataViaGh(resolved)
  return {
    ref,
    owner: meta.owner,
    repo: meta.repo,
    pullNumber: meta.number,
    baseSha: meta.baseSha,
    headSha: meta.headSha,
    title: meta.title,
    url: meta.url,
    author: meta.author,
    additions: meta.additions,
    deletions: meta.deletions,
    changedFiles: meta.changedFiles,
    diff: meta.diff,
    comments: [],
    existingComments: meta.existingComments,
  }
}

/** Refresh `diff` + `existingComments` + head SHA in an existing session. */
export async function refreshPrSession(session: PrSession): Promise<PrSession> {
  const resolved: ResolvedPr = {
    owner: session.owner,
    repo: session.repo,
    pullNumber: session.pullNumber,
    ref: session.ref,
  }
  const meta = await fetchPrMetadataViaGh(resolved)
  return {
    ...session,
    baseSha: meta.baseSha,
    headSha: meta.headSha,
    title: meta.title,
    url: meta.url,
    author: meta.author,
    additions: meta.additions,
    deletions: meta.deletions,
    changedFiles: meta.changedFiles,
    diff: meta.diff,
    existingComments: meta.existingComments,
  }
}
