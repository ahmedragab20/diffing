import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  PrSession,
  PrExistingComment,
  PrExistingReview,
  PrAuthor,
} from './pr-session.js'
import type { ReviewComment } from './types.js'

const execFileAsync = promisify(execFile)
const GH_REQUEST_TIMEOUT_MS = 45_000
const GH_MAX_OUTPUT_BYTES = 20 * 1024 * 1024

/** Execute a command with explicit stdin delivery, output limits, and timeout. */
export function execWithInput(
  command: string,
  args: string[],
  input: string,
  timeoutMs = GH_REQUEST_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (error?: Error & { stdout?: string; stderr?: string; code?: number | null }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      } else {
        resolve({ stdout, stderr })
      }
    }

    const append = (target: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const text = chunk.toString()
      if (target === 'stdout') stdout += text
      else stderr += text
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > GH_MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM')
        finish(new Error('GitHub CLI response exceeded the 20 MB output limit'))
      }
    }

    child.stdout.on('data', (chunk) => append('stdout', chunk))
    child.stderr.on('data', (chunk) => append('stderr', chunk))
    child.on('error', (error) => finish(error))
    child.on('close', (code, signal) => {
      if (settled) return
      if (code === 0) return finish()
      const error = new Error(
        signal
          ? `GitHub CLI terminated by ${signal}`
          : `GitHub CLI exited with code ${code ?? 'unknown'}`,
      ) as Error & { stdout?: string; stderr?: string; code?: number | null }
      error.code = code
      finish(error)
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`GitHub CLI request timed out after ${Math.ceil(timeoutMs / 1000)} seconds`))
    }, timeoutMs)

    child.stdin.on('error', () => {
      // The close/error event carries the actionable command failure.
    })
    child.stdin.end(input)
  })
}

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
      // `gh auth status` is inconsistent about which stream the "Logged in to
      // github.com as <user>" line lands on: older releases (and Windows
      // builds) emit it on stderr, newer ones on stdout. We don't care — we
      // search both, so the regex works regardless of where gh decided to
      // put the line.
      const result = await execFileAsync('gh', ['auth', 'status'], {
        encoding: 'utf-8',
      })
      const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
      const userMatch = parseGhAuthStatusUser(combined)
      return {
        available: true,
        authenticated: true,
        version,
        user: userMatch,
      }
    } catch {
      return { available: true, authenticated: false, version }
    }
  } catch {
    return { available: false, authenticated: false }
  }
}

/**
 * Extract the GitHub username from `gh auth status` output. Exported for
 * unit tests — see `__tests__/github-auth.test.ts`.
 *
 * Real-world samples:
 *   `✓ Logged in to github.com account octocat (keyring)`        (gh 2.40+)
 *   `Logged in to github.com as octocat (oauth_token)`            (older gh)
 *   `  ✓ Logged in to github.com as octocat (~/.config/gh/hosts.yml)`
 */
export function parseGhAuthStatusUser(output: string): string | undefined {
  // Prefer the newer "account <user>" phrasing; fall back to "as <user>".
  const account = /Logged in to [^\s]+ account\s+([^\s(]+)/.exec(output)
  if (account) return account[1]
  const as = /Logged in to [^\s]+ as\s+([^\s(]+)/.exec(output)
  return as?.[1]
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
  /** PR head branch name (e.g. `feature/foo`). May be empty on old `gh`. */
  baseRefName: string
  /** PR base branch name (e.g. `main`). May be empty on old `gh`. */
  headRefName: string
  additions: number
  deletions: number
  changedFiles: number
  owner: string
  repo: string
  diff: string
  existingComments: PrExistingComment[]
  existingReviews: PrExistingReview[]
}

/**
 * Parse a `gh pr <ref>` input into `{ owner, repo, pullNumber [, host] }`. Accepts:
 *   - `1234`                              → uses the cwd repo (github.com or GHES)
 *   - `https://github.com/o/r/pull/1234`  → extracts from the URL
 *   - `https://ghe.example.com/o/r/pull/1`→ GitHub Enterprise Server / GHE Cloud
 *   - `o/r#1234`                          → shorthand (host from cwd when present)
 * If `cwdRepo` is provided, bare numbers and `o/r#1234` resolve against it.
 */
export interface ResolvedPr {
  owner: string
  repo: string
  pullNumber: number
  /** The original input, for diagnostic / persistence. */
  ref: string
  /**
   * GitHub host. `github.com` (or omitted) for github.com; a GHES / GHE Cloud
   * hostname otherwise (e.g. `github.company.com`). Used to route `gh -R` /
   * `gh api --hostname` and token REST calls.
   */
  host?: string
}

/** Repo identity derived from a git remote or `gh repo view`. */
export interface DetectedRepo {
  owner: string
  repo: string
  /** Hostname including optional port (e.g. `ghe.example.com` or `ghe.local:8443`). */
  host: string
}

/** True when the host is github.com (or unspecified, which we treat the same). */
export function isGithubDotCom(host?: string | null): boolean {
  return !host || host === 'github.com'
}

/**
 * `gh -R` selector: `OWNER/REPO` on github.com, `HOST/OWNER/REPO` on GHES.
 * See `gh help environment` / `--repo [HOST/]OWNER/REPO`.
 */
export function ghRepoSelector(resolved: Pick<ResolvedPr, 'owner' | 'repo' | 'host'>): string {
  if (isGithubDotCom(resolved.host)) {
    return `${resolved.owner}/${resolved.repo}`
  }
  return `${resolved.host}/${resolved.owner}/${resolved.repo}`
}

/** Extra argv for `gh api` / GraphQL when targeting a non-github.com host. */
export function ghHostnameArgs(resolved: Pick<ResolvedPr, 'host'> | { host?: string }): string[] {
  if (isGithubDotCom(resolved.host)) return []
  return ['--hostname', resolved.host as string]
}

/** REST API origin for token-based fetch (GHES uses `/api/v3`). */
export function githubApiBase(host?: string): string {
  if (isGithubDotCom(host)) return 'https://api.github.com'
  const withScheme = host!.includes('://') ? host! : `https://${host}`
  return `${withScheme.replace(/\/$/, '')}/api/v3`
}

/** Build a ResolvedPr from a persisted PR session (host optional for legacy JSON). */
export function resolvedFromSession(session: {
  owner: string
  repo: string
  pullNumber: number
  ref: string
  host?: string
}): ResolvedPr {
  return {
    owner: session.owner,
    repo: session.repo,
    pullNumber: session.pullNumber,
    ref: session.ref,
    host: session.host,
  }
}

/**
 * Fetch one repository file exactly as it existed at a PR base/head SHA.
 * The raw media type preserves binary files while `gh` supplies the user's
 * existing GitHub/GHES authentication. A missing path at that revision is a
 * normal result for added/deleted files and is returned as `null`.
 */
export async function fetchPrFileContentViaGh(
  resolved: Pick<ResolvedPr, 'owner' | 'repo' | 'host'>,
  path: string,
  sha: string,
): Promise<Buffer | null> {
  const normalizedPath = path.replace(/\\/g, '/')
  if (
    !normalizedPath ||
    normalizedPath.startsWith('/') ||
    normalizedPath.includes('\0') ||
    normalizedPath.split('/').some((segment) => segment === '..')
  ) {
    throw new Error('Invalid repository file path')
  }

  const encodedPath = normalizedPath.split('/').map(encodeURIComponent).join('/')
  const endpoint = `repos/${encodeURIComponent(resolved.owner)}/${encodeURIComponent(resolved.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        ...ghHostnameArgs(resolved),
        endpoint,
        '-H',
        'Accept: application/vnd.github.raw+json',
      ],
      {
        encoding: 'buffer',
        maxBuffer: GH_MAX_OUTPUT_BYTES,
        timeout: GH_REQUEST_TIMEOUT_MS,
      },
    )
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  } catch (error) {
    const details = error as Error & { stderr?: string | Buffer; stdout?: string | Buffer }
    const output = `${details.message}\n${details.stderr?.toString() ?? ''}\n${details.stdout?.toString() ?? ''}`
    if (/\bHTTP\s+404\b/i.test(output) || /\bnot found\b/i.test(output)) return null
    throw error
  }
}

/**
 * Parse a git remote URL into `{ host, owner, repo }`.
 * Supports scp-like SSH, `ssh://`, and `https://` for github.com and GHES.
 */
export function parseGitRemoteUrl(url: string): DetectedRepo | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  // scp-like: git@host:owner/repo.git  (also org-1234@github.com:owner/repo.git)
  // Reject URL schemes so we don't treat `https://…` as scp.
  if (!trimmed.includes('://')) {
    const scp = /^(?:[^@\s]+@)?([^:\s]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(trimmed)
    if (scp) {
      return { host: scp[1], owner: scp[2], repo: scp[3] }
    }
  }

  // URL forms: https://host/owner/repo.git, ssh://git@host/owner/repo.git
  try {
    const normalized = trimmed.replace(/^git\+/, '')
    const u = new URL(normalized)
    // Prefer `.host` so GHES with a non-default port keeps it (hostname strips port).
    const host = u.host
    const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean)
    if (host && parts.length >= 2) {
      const owner = parts[0]
      const repo = parts[1].replace(/\.git$/i, '')
      if (owner && repo) return { host, owner, repo }
    }
  } catch {
    // not a URL
  }
  return null
}

export function parsePrRef(
  input: string,
  cwdRepo?: { owner: string; repo: string; host?: string },
): ResolvedPr {
  const trimmed = input.trim()
  // URL form — github.com *and* enterprise hosts
  const urlMatch =
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(trimmed)
  if (urlMatch) {
    return {
      host: urlMatch[1],
      owner: urlMatch[2],
      repo: urlMatch[3],
      pullNumber: Number(urlMatch[4]),
      ref: trimmed,
    }
  }
  // `o/r#1234` shorthand (host inherited from cwd when available)
  const shorthand = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(trimmed)
  if (shorthand) {
    return {
      owner: shorthand[1],
      repo: shorthand[2],
      pullNumber: Number(shorthand[3]),
      ref: trimmed,
      host: cwdRepo?.host,
    }
  }
  // bare number — use cwd repo
  const bare = /^#?(\d+)$/.exec(trimmed)
  if (bare && cwdRepo) {
    return {
      owner: cwdRepo.owner,
      repo: cwdRepo.repo,
      pullNumber: Number(bare[1]),
      ref: trimmed,
      host: cwdRepo.host,
    }
  }
  if (bare) {
    throw new Error(
      `Cannot resolve bare PR number "${trimmed}" — run from inside the target repo, or pass a full URL or \`owner/repo#1234\`.`,
    )
  }
  throw new Error(`Unrecognised PR ref: ${trimmed}`)
}

/**
 * Best-effort: derive `{ host, owner, repo }` for the current working directory
 * from `git remote get-url origin`, then fall back to `gh repo view` (which
 * understands GHES remotes when `gh` is logged in to that host).
 */
export async function detectCwdRepo(): Promise<DetectedRepo | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['remote', 'get-url', 'origin'],
      { encoding: 'utf-8' },
    )
    const parsed = parseGitRemoteUrl(stdout.trim())
    if (parsed) return parsed
  } catch {
    // fall through to gh
  }

  // `gh repo view` resolves the repo (and host) from the local git remote even
  // on GHES, provided the user is authenticated to that host.
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner,url'],
      { encoding: 'utf-8' },
    )
    const data = JSON.parse(stdout) as { nameWithOwner?: string; url?: string }
    if (data.url) {
      const fromUrl = parseGitRemoteUrl(data.url)
      if (fromUrl) return fromUrl
    }
    if (data.nameWithOwner) {
      const [owner, repo] = data.nameWithOwner.split('/')
      if (owner && repo) {
        return { owner, repo, host: 'github.com' }
      }
    }
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
  // `gh pr view <ref> -R [HOST/]OWNER/REPO --json ...` for the metadata.
  // `gh pr diff <ref> -R [HOST/]OWNER/REPO` for the unified diff.
  // `gh api --hostname HOST ...` for the existing comments (paginated).
  const args = ['-R', ghRepoSelector(resolved)]

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
        'number,title,url,author,baseRefOid,headRefOid,baseRefName,headRefName,additions,deletions,changedFiles,headRepositoryOwner,headRepository',
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

  // Reviews / comments / submit always target the *base* repository (where
  // the PR lives). Using headRepositoryOwner here broke fork PRs — submit
  // would POST to the fork owner and get 404. Keep `resolved.owner/repo`.
  const author = metaJson.author
    ? { login: metaJson.author.login, avatarUrl: metaJson.author.avatarUrl }
    : null

  // Existing review events and their line-comment threads.
  const existingReviews = await fetchExistingReviewsViaGh(resolved)
  const existingComments = await fetchExistingCommentsViaGh(resolved, existingReviews)

  return {
    number: metaJson.number,
    title: metaJson.title,
    url: metaJson.url,
    author,
    baseSha: metaJson.baseRefOid,
    headSha: metaJson.headRefOid,
    baseRefName: typeof metaJson.baseRefName === 'string' ? metaJson.baseRefName : '',
    headRefName: typeof metaJson.headRefName === 'string' ? metaJson.headRefName : '',
    additions: metaJson.additions,
    deletions: metaJson.deletions,
    changedFiles: metaJson.changedFiles,
    owner: resolved.owner,
    repo: resolved.repo,
    diff,
    existingComments,
    existingReviews,
  }
}

export async function fetchExistingReviewsViaGh(resolved: ResolvedPr): Promise<PrExistingReview[]> {
  const reviewsEndpoint = `repos/${resolved.owner}/${resolved.repo}/pulls/${resolved.pullNumber}/reviews`
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', ...ghHostnameArgs(resolved), reviewsEndpoint, '--paginate'],
      { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 },
    )
    const parsed = JSON.parse(stdout)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((review: any): PrExistingReview | null => {
        const state = String(review.state ?? '').toUpperCase()
        if (!['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING', 'DISMISSED'].includes(state)) return null
        return {
          id: review.id,
          author: review.user?.login
            ? { login: review.user.login, avatarUrl: review.user.avatar_url }
            : null,
          body: review.body ?? '',
          state: state as PrExistingReview['state'],
          submittedAt: review.submitted_at ?? null,
          htmlUrl: review.html_url,
          commitId: review.commit_id,
        }
      })
      .filter((review): review is PrExistingReview => review != null)
      .sort((a, b) => (a.submittedAt ?? '') < (b.submittedAt ?? '') ? 1 : -1)
      .slice(0, 50)
  } catch {
    return []
  }
}

export async function fetchExistingCommentsViaGh(
  resolved: ResolvedPr,
  existingReviews?: PrExistingReview[],
): Promise<PrExistingComment[]> {
  const endpoint = `repos/${resolved.owner}/${resolved.repo}/pulls/${resolved.pullNumber}/comments`
  const recentReviews = existingReviews ?? await fetchExistingReviewsViaGh(resolved)
  const reviewStateById = new Map<number, string>()
  for (const r of recentReviews) reviewStateById.set(r.id, r.state)

  // Comments: paginate through.
  let commentsRaw: any[] = []
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', ...ghHostnameArgs(resolved), `${endpoint}?per_page=100`, '--paginate'],
      { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 },
    )
    const parsed = JSON.parse(stdout)
    if (Array.isArray(parsed)) commentsRaw = parsed
  } catch {
    return []
  }

  const threadByCommentId = await fetchReviewThreadStateViaGh(resolved)

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
    const thread = threadByCommentId.get(c.id)
    tops.push({
      id: c.id,
      author: c.user ? { login: c.user.login, avatarUrl: c.user.avatar_url } : null,
      body: c.body ?? '',
      path: c.path,
      line: typeof c.line === 'number' ? c.line : null,
      startLine: typeof c.start_line === 'number' ? c.start_line : null,
      side: c.side === 'LEFT' || c.side === 'RIGHT' ? c.side : null,
      startSide: c.start_side === 'LEFT' || c.start_side === 'RIGHT' ? c.start_side : null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      state: state as PrExistingComment['state'],
      replies: (replyByParent.get(c.id) ?? []).map((r) => ({
        id: r.id,
        author: r.user ? { login: r.user.login, avatarUrl: r.user.avatar_url } : null,
        body: r.body ?? '',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        viewerDidAuthor: threadByCommentId.get(r.id)?.viewerDidAuthor,
      })),
      // Outdated when the current line is gone but an original anchor remains,
      // or when GitHub's deprecated `position` is explicitly null with history.
      isOutdated: Boolean(
        (c.line == null && c.original_line != null) ||
          (c.position === null && c.original_position != null),
      ),
      threadId: thread?.id,
      isResolved: thread?.isResolved,
      viewerCanResolve: thread?.viewerCanResolve,
      viewerCanUnresolve: thread?.viewerCanUnresolve,
      viewerDidAuthor: thread?.viewerDidAuthor,
    })
  }

  // Sort: by file path, then by line.
  tops.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path)
    return (a.line ?? 0) - (b.line ?? 0)
  })
  return tops
}

interface GhReviewThreadState {
  id: string
  isResolved: boolean
  viewerCanResolve: boolean
  viewerCanUnresolve: boolean
  viewerDidAuthor?: boolean
}

/** Fetch thread-only state unavailable from the REST review-comments API. */
async function fetchReviewThreadStateViaGh(
  resolved: ResolvedPr,
): Promise<Map<number, GhReviewThreadState>> {
  const query = `
    query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            nodes {
              id
              isResolved
              viewerCanResolve
              viewerCanUnresolve
              comments(first: 100) { nodes { databaseId viewerDidAuthor } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `
  const byCommentId = new Map<number, GhReviewThreadState>()
  let cursor: string | null = null
  try {
    do {
      const { stdout } = await execWithInput(
        'gh',
        ['api', 'graphql', ...ghHostnameArgs(resolved), '--input', '-'],
        JSON.stringify({
          query,
          variables: {
            owner: resolved.owner,
            repo: resolved.repo,
            number: resolved.pullNumber,
            cursor,
          },
        }),
      )
      const parsed = JSON.parse(stdout) as any
      const connection = parsed?.data?.repository?.pullRequest?.reviewThreads
      for (const node of connection?.nodes ?? []) {
        const state: GhReviewThreadState = {
          id: node.id,
          isResolved: Boolean(node.isResolved),
          viewerCanResolve: Boolean(node.viewerCanResolve),
          viewerCanUnresolve: Boolean(node.viewerCanUnresolve),
        }
        for (const comment of node.comments?.nodes ?? []) {
          if (typeof comment.databaseId === 'number') {
            byCommentId.set(comment.databaseId, { ...state, viewerDidAuthor: Boolean(comment.viewerDidAuthor) })
          }
        }
      }
      cursor = connection?.pageInfo?.hasNextPage
        ? connection.pageInfo.endCursor ?? null
        : null
    } while (cursor)
  } catch {
    // REST comments remain useful when GraphQL thread state is unavailable.
  }
  return byCommentId
}

// ── Submitting reviews ─────────────────────────────────────────────────

export interface SubmitInput {
  resolved: ResolvedPr
  decision: 'approve' | 'comment' | 'request-changes' | 'draft'
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
 *
 * Returns `null` for `draft` — GitHub creates a PENDING review when `event`
 * is omitted from the payload.
 */
export function decisionToEvent(
  decision: 'approve' | 'comment' | 'request-changes' | 'draft',
): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | null {
  if (decision === 'draft') return null
  if (decision === 'approve') return 'APPROVE'
  if (decision === 'request-changes') return 'REQUEST_CHANGES'
  return 'COMMENT'
}

/** GitHub REST pull-request review comment shape (multi-line aware). */
export interface GhReviewComment {
  path: string
  body: string
  line: number
  side: 'LEFT' | 'RIGHT'
  start_line?: number
  start_side?: 'LEFT' | 'RIGHT'
}

/**
 * Map open line-anchored `ReviewComment`s to GitHub multi-line review comments.
 * - `deletions` → LEFT, `additions` → RIGHT
 * - Ranges use `start_line`/`line` (no N-part explosion)
 * - File-level comments (`lineNumber === 0`) are excluded; callers fold them
 *   into the review body via {@link buildReviewPayload}.
 */
export function expandMultiLineComments(comments: ReviewComment[]): GhReviewComment[] {
  const flat: GhReviewComment[] = []
  for (const c of comments) {
    if (c.status !== 'open') continue
    if (c.lineNumber === 0) continue
    const path = stripBPrefix(c.filePath)
    const side: 'LEFT' | 'RIGHT' = c.side === 'deletions' ? 'LEFT' : 'RIGHT'
    const start =
      c.startLineNumber && c.startLineNumber < c.lineNumber ? c.startLineNumber : undefined
    const entry: GhReviewComment = {
      path,
      line: c.lineNumber,
      side,
      body: c.body,
    }
    if (start !== undefined) {
      entry.start_line = start
      entry.start_side = side
    }
    flat.push(entry)
  }
  return flat
}

export function buildReviewPayload(
  input: Pick<SubmitInput, 'body' | 'decision' | 'comments'>,
): {
  body: string | undefined
  /** Omitted for draft/pending reviews. */
  event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  comments: GhReviewComment[]
} {
  const comments = input.comments ?? []
  const inline = expandMultiLineComments(comments)
  const fileLevel = comments.filter((c) => c.status === 'open' && c.lineNumber === 0)
  let body = typeof input.body === 'string' ? input.body.trim() : ''
  if (fileLevel.length > 0) {
    const sections = fileLevel.map((c) => {
      const path = stripBPrefix(c.filePath)
      return `**\`${path}\`:** ${c.body}`
    })
    const block = ['### File comments', ...sections].join('\n\n')
    body = body ? `${body}\n\n${block}` : block
  }
  const event = decisionToEvent(input.decision ?? 'comment')
  // GitHub: omit `event` entirely to create a PENDING (draft) review.
  if (event === null) {
    return {
      body: body || undefined,
      comments: inline,
    }
  }
  return {
    body: body || undefined,
    event,
    comments: inline,
  }
}

function stripBPrefix(path: string): string {
  if (path.startsWith('b/')) return path.slice(2)
  if (path.startsWith('a/')) return path.slice(2)
  return path
}

async function submitViaGh(input: SubmitInput): Promise<SubmitOutput> {
  const payload = buildReviewPayload(input)
  const endpoint = `repos/${input.resolved.owner}/${input.resolved.repo}/pulls/${input.resolved.pullNumber}/reviews`
  // `gh api` accepts a JSON body via `--input -` + stdin. Pass it via env to
  // avoid argv length limits on huge reviews.
  const args = [
    'api',
    ...ghHostnameArgs(input.resolved),
    '--method',
    'POST',
    endpoint,
    '-H',
    'Accept: application/vnd.github+json',
    '--input',
    '-',
  ]
  try {
    const { stdout } = await execWithInput('gh', args, JSON.stringify(payload))
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
  const url = `${githubApiBase(input.resolved.host)}/repos/${input.resolved.owner}/${input.resolved.repo}/pulls/${input.resolved.pullNumber}/reviews`
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(GH_REQUEST_TIMEOUT_MS),
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

// ── PR checks (CI status) ──────────────────────────────────────────────

export interface PrCheck {
  name: string
  state: 'success' | 'failure' | 'pending' | 'neutral' | 'error' | 'skipped' | 'cancelled' | 'timed_out' | 'action_required' | 'unknown'
  conclusion?: string | null
  detailsUrl?: string | null
}

/**
 * Fetch check runs + combined status for a PR head via `gh api`.
 * Best-effort: returns [] on any failure so the UI can degrade gracefully.
 */
export async function fetchPrChecks(resolved: ResolvedPr, headSha: string): Promise<PrCheck[]> {
  const checks: PrCheck[] = []
  try {
    const endpoint = `repos/${resolved.owner}/${resolved.repo}/commits/${headSha}/check-runs?per_page=50`
    const { stdout } = await execFileAsync(
      'gh',
      ['api', ...ghHostnameArgs(resolved), endpoint, '-H', 'Accept: application/vnd.github+json'],
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    )
    const parsed = JSON.parse(stdout) as {
      check_runs?: Array<{
        name: string
        status: string
        conclusion: string | null
        html_url?: string
      }>
    }
    for (const run of parsed.check_runs ?? []) {
      let state: PrCheck['state'] = 'unknown'
      if (run.status === 'completed') {
        const c = (run.conclusion ?? '').toLowerCase()
        if (c === 'success') state = 'success'
        else if (c === 'failure' || c === 'startup_failure') state = 'failure'
        else if (c === 'neutral') state = 'neutral'
        else if (c === 'cancelled') state = 'cancelled'
        else if (c === 'timed_out') state = 'timed_out'
        else if (c === 'skipped') state = 'skipped'
        else if (c === 'action_required') state = 'action_required'
        else state = 'error'
      } else {
        state = 'pending'
      }
      checks.push({
        name: run.name,
        state,
        conclusion: run.conclusion,
        detailsUrl: run.html_url ?? null,
      })
    }
  } catch {
    // ignore — optional surface
  }
  return checks
}

/**
 * Reply to an existing GitHub review comment (thread).
 * POST /repos/{owner}/{repo}/pulls/{pull_number}/comments with in_reply_to.
 */
export async function replyToPrComment(input: {
  resolved: ResolvedPr
  inReplyTo: number
  body: string
}): Promise<{
  ok: boolean
  id?: number
  reply?: {
    id: number
    author: PrAuthor | null
    body: string
    createdAt: string
    updatedAt: string
  }
  error?: string
}> {
  const endpoint = `repos/${input.resolved.owner}/${input.resolved.repo}/pulls/${input.resolved.pullNumber}/comments`
  const payload = JSON.stringify({
    body: input.body,
    in_reply_to: input.inReplyTo,
  })
  try {
    const { stdout } = await execWithInput(
      'gh',
      [
        'api',
        ...ghHostnameArgs(input.resolved),
        '--method',
        'POST',
        endpoint,
        '-H',
        'Accept: application/vnd.github+json',
        '--input',
        '-',
      ],
      payload,
    )
    const result = JSON.parse(stdout) as {
      id?: number
      body?: string
      user?: { login?: string; avatar_url?: string }
      created_at?: string
      updated_at?: string
    }
    if (typeof result.id !== 'number') {
      return { ok: false, error: 'GitHub reply response did not include a comment id' }
    }
    const now = new Date().toISOString()
    return {
      ok: true,
      id: result.id,
      reply: {
        id: result.id,
        author: result.user?.login
          ? { login: result.user.login, avatarUrl: result.user.avatar_url }
          : null,
        body: result.body ?? input.body,
        createdAt: result.created_at ?? now,
        updatedAt: result.updated_at ?? result.created_at ?? now,
      },
    }
  } catch (err: any) {
    const msg = err?.stderr || err?.stdout || err?.message || 'reply failed'
    return { ok: false, error: String(msg).slice(0, 500) }
  }
}

export async function updatePrReviewComment(input: {
  resolved: ResolvedPr
  commentId: number
  body: string
}): Promise<{ ok: boolean; error?: string }> {
  const endpoint = `repos/${input.resolved.owner}/${input.resolved.repo}/pulls/comments/${input.commentId}`
  try {
    await execWithInput(
      'gh',
      [
        'api',
        ...ghHostnameArgs(input.resolved),
        '--method',
        'PATCH',
        endpoint,
        '-H',
        'Accept: application/vnd.github+json',
        '--input',
        '-',
      ],
      JSON.stringify({ body: input.body }),
    )
    return { ok: true }
  } catch (error: any) {
    return { ok: false, error: githubCommandError(error, 'Failed to edit GitHub comment') }
  }
}

export async function deletePrReviewComment(input: {
  resolved: ResolvedPr
  commentId: number
}): Promise<{ ok: boolean; error?: string }> {
  const endpoint = `repos/${input.resolved.owner}/${input.resolved.repo}/pulls/comments/${input.commentId}`
  try {
    await execFileAsync(
      'gh',
      [
        'api',
        ...ghHostnameArgs(input.resolved),
        '--method',
        'DELETE',
        endpoint,
        '-H',
        'Accept: application/vnd.github+json',
      ],
      {
        encoding: 'utf-8',
        timeout: GH_REQUEST_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
      },
    )
    return { ok: true }
  } catch (error: any) {
    return { ok: false, error: githubCommandError(error, 'Failed to delete GitHub comment') }
  }
}

export async function setPrReviewThreadResolved(input: {
  threadId: string
  resolved: boolean
  /** GHES host when the PR is not on github.com. */
  host?: string
}): Promise<{ ok: boolean; error?: string }> {
  const mutationName = input.resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
  const query = `
    mutation UpdateReviewThread($threadId: ID!) {
      ${mutationName}(input: { threadId: $threadId }) {
        thread { id isResolved }
      }
    }
  `
  try {
    const { stdout } = await execWithInput(
      'gh',
      ['api', 'graphql', ...ghHostnameArgs({ host: input.host }), '--input', '-'],
      JSON.stringify({ query, variables: { threadId: input.threadId } }),
    )
    const parsed = JSON.parse(stdout) as { errors?: Array<{ message?: string }> }
    if (parsed.errors?.length) {
      return { ok: false, error: parsed.errors.map((item) => item.message).filter(Boolean).join('; ') || 'GitHub rejected the thread update' }
    }
    return { ok: true }
  } catch (error: any) {
    return { ok: false, error: githubCommandError(error, 'Failed to update GitHub thread') }
  }
}

function githubCommandError(error: any, fallback: string): string {
  const stdout = typeof error?.stdout === 'string' ? error.stdout : ''
  try {
    const parsed = JSON.parse(stdout) as { message?: string; errors?: Array<{ message?: string }> }
    if (parsed.message) return parsed.message
    const messages = parsed.errors?.map((item) => item.message).filter(Boolean)
    if (messages?.length) return messages.join('; ')
  } catch {
    // Fall through to stderr/message.
  }
  return String(error?.stderr || error?.message || fallback).trim().slice(0, 500) || fallback
}

// ── Building a PrSession ───────────────────────────────────────────────

export async function buildPrSession(ref: string): Promise<PrSession> {
  const cwdRepo = await detectCwdRepo()
  const resolved = parsePrRef(ref, cwdRepo ?? undefined)
  const meta = await fetchPrMetadataViaGh(resolved)
  // Prefer host from the resolved ref; fall back to parsing the PR html_url
  // (gh returns the enterprise URL) so later API calls keep the right host.
  const host =
    resolved.host ??
    parseGitRemoteUrl(meta.url)?.host ??
    cwdRepo?.host
  return {
    ref,
    owner: meta.owner,
    repo: meta.repo,
    pullNumber: meta.number,
    host: isGithubDotCom(host) ? undefined : host,
    baseSha: meta.baseSha,
    headSha: meta.headSha,
    baseRefName: meta.baseRefName,
    headRefName: meta.headRefName,
    title: meta.title,
    url: meta.url,
    author: meta.author,
    additions: meta.additions,
    deletions: meta.deletions,
    changedFiles: meta.changedFiles,
    diff: meta.diff,
    comments: [],
    existingComments: meta.existingComments,
    existingReviews: meta.existingReviews,
  }
}

/** Refresh `diff` + `existingComments` + head SHA in an existing session. */
export async function refreshPrSession(session: PrSession): Promise<PrSession> {
  const resolved = resolvedFromSession(session)
  const meta = await fetchPrMetadataViaGh(resolved)
  return {
    ...session,
    baseSha: meta.baseSha,
    headSha: meta.headSha,
    baseRefName: meta.baseRefName,
    headRefName: meta.headRefName,
    title: meta.title,
    url: meta.url,
    author: meta.author,
    additions: meta.additions,
    deletions: meta.deletions,
    changedFiles: meta.changedFiles,
    diff: meta.diff,
    existingComments: meta.existingComments,
    existingReviews: meta.existingReviews,
  }
}
