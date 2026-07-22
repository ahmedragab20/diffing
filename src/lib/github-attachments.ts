/**
 * Publish-time rewrite of local `/api/attachments/…` markdown into
 * repo-ACL-bound GitHub raw blob URLs (hidden orphan ref via Git Data API).
 *
 * Private repos / GHE: URLs inherit repository visibility. Never uses
 * release assets (always public) or cookie-based user-attachments upload.
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import {
  detectGhCli,
  execWithInput,
  ghHostnameArgs,
  githubApiBase,
  isGithubDotCom,
  readGithubToken,
  type ResolvedPr,
} from './github.js'
import { getProjectStorageDir } from './git.js'
import { toSafeRelativePath } from './path.js'

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

/** Markdown image/link targets that point at local diffing attachments. */
const LOCAL_ATTACHMENT_RE =
  /(?:!?\[[^\]]*\]\()(\/api\/attachments\/([^)\s]+))\)|(?:src=["'])(\/api\/attachments\/([^"'\s]+))["']/gi

export interface LocalAttachmentRef {
  /** Full local URL path, e.g. `/api/attachments/pasted_image_….png` */
  url: string
  /** Basename only (validated). */
  filename: string
}

export interface AttachmentUploadPlan {
  filename: string
  localUrl: string
  bytes: number
  contentHash: string
  /** Path inside the orphan tree (stable, hash-prefixed). */
  treePath: string
}

export interface RewriteResult {
  bodies: string[]
  /** Local URL → GitHub raw URL (or dry-run placeholder). */
  urlMap: Record<string, string>
  uploaded: number
  dryRun: boolean
  error?: string
}

/** Public web origin for markdown image URLs (not the REST API host). */
export function githubWebOrigin(host?: string | null): string {
  if (isGithubDotCom(host)) return 'https://github.com'
  const raw = host!.includes('://') ? host! : `https://${host}`
  return raw.replace(/\/$/, '')
}

/** Build a private-repo-safe raw content URL for a blob at a commit. */
export function githubRawBlobUrl(
  resolved: Pick<ResolvedPr, 'owner' | 'repo' | 'host'>,
  commitSha: string,
  treePath: string,
): string {
  const origin = githubWebOrigin(resolved.host)
  const segments = treePath.split('/').map((s) => encodeURIComponent(s)).join('/')
  return `${origin}/${resolved.owner}/${resolved.repo}/raw/${commitSha}/${segments}`
}

export function attachmentRefName(pullNumber: number): string {
  return `refs/diffing/attachments/pr-${pullNumber}`
}

/**
 * Extract safe local attachment filenames from markdown. Rejects traversal,
 * absolute paths, and empty names.
 */
export function extractLocalAttachmentRefs(markdown: string): LocalAttachmentRef[] {
  const found = new Map<string, LocalAttachmentRef>()
  LOCAL_ATTACHMENT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LOCAL_ATTACHMENT_RE.exec(markdown)) !== null) {
    const url = match[1] ?? match[3]
    const filename = match[2] ?? match[4]
    if (!url || !filename) continue
    const safe = sanitizeAttachmentFilename(filename)
    if (!safe) continue
    found.set(url, { url, filename: safe })
  }
  return [...found.values()]
}

/** Returns basename if safe; null if traversal / bad extension / weird chars. */
export function sanitizeAttachmentFilename(filename: string): string | null {
  let decoded = filename
  try {
    decoded = decodeURIComponent(filename)
  } catch {
    // keep as-is
  }
  if (!decoded || decoded.includes('\0') || decoded.includes('/') || decoded.includes('\\')) {
    return null
  }
  if (decoded.includes('..') || decoded.startsWith('.') || decoded !== decoded.trim()) {
    return null
  }
  // UUID-ish pasted names: pasted_image_<uuid>.ext or similar alnum/_/-
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(decoded)) {
    return null
  }
  const ext = extname(decoded).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) return null
  return decoded
}

export function rewriteAttachmentUrls(
  markdown: string,
  urlMap: Record<string, string>,
): string {
  if (Object.keys(urlMap).length === 0) return markdown
  let out = markdown
  for (const [local, remote] of Object.entries(urlMap)) {
    // Replace exact local URL occurrences (image markdown and src=).
    out = out.split(local).join(remote)
  }
  return out
}

function attachmentsDir(custom?: string): string {
  return custom ?? join(getProjectStorageDir(), 'attachments')
}

async function loadAttachmentFile(
  dir: string,
  filename: string,
): Promise<{ bytes: Buffer; error?: string }> {
  const safeRel = toSafeRelativePath(filename, dir)
  if (!safeRel || safeRel.includes('..') || safeRel.includes('/') || safeRel.includes('\\')) {
    return { bytes: Buffer.alloc(0), error: `Refusing unsafe attachment path: ${filename}` }
  }
  const absolute = join(dir, safeRel)
  try {
    const st = await stat(absolute)
    if (!st.isFile()) {
      return { bytes: Buffer.alloc(0), error: `Attachment is not a file: ${filename}` }
    }
    if (st.size > MAX_ATTACHMENT_BYTES) {
      return {
        bytes: Buffer.alloc(0),
        error: `Attachment ${filename} exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`,
      }
    }
    const bytes = await readFile(absolute)
    return { bytes }
  } catch {
    return { bytes: Buffer.alloc(0), error: `Missing local attachment: ${filename}` }
  }
}

export async function planAttachmentUploads(
  markdownBodies: string[],
  opts?: { attachmentsDir?: string },
): Promise<{ plans: AttachmentUploadPlan[]; error?: string }> {
  const refs = new Map<string, LocalAttachmentRef>()
  for (const body of markdownBodies) {
    for (const ref of extractLocalAttachmentRefs(body)) {
      refs.set(ref.url, ref)
    }
  }
  if (refs.size === 0) return { plans: [] }

  const dir = attachmentsDir(opts?.attachmentsDir)
  const plans: AttachmentUploadPlan[] = []
  const hashToTreePath = new Map<string, string>()

  for (const ref of refs.values()) {
    const loaded = await loadAttachmentFile(dir, ref.filename)
    if (loaded.error) return { plans: [], error: loaded.error }
    const contentHash = createHash('sha256').update(loaded.bytes).digest('hex')
    let treePath = hashToTreePath.get(contentHash)
    if (!treePath) {
      const ext = extname(ref.filename).toLowerCase() || '.bin'
      treePath = `${contentHash.slice(0, 16)}${ext}`
      hashToTreePath.set(contentHash, treePath)
    }
    plans.push({
      filename: ref.filename,
      localUrl: ref.url,
      bytes: loaded.bytes.length,
      contentHash,
      treePath,
    })
  }
  return { plans }
}

type ApiCaller = (method: string, path: string, body?: unknown) => Promise<{ ok: boolean; status: number; json: any; text: string }>

function contentsWriteHint(message: string): string {
  const lower = message.toLowerCase()
  if (
    lower.includes('resource not accessible') ||
    lower.includes('not found') ||
    lower.includes('403') ||
    lower.includes('forbidden') ||
    lower.includes('permission') ||
    lower.includes('scopes')
  ) {
    return (
      `${message} — Image upload needs contents:write ` +
      `(re-auth \`gh\` with the repo scope, or use a token with Contents: Write).`
    )
  }
  return message
}

async function createGhApiCaller(resolved: ResolvedPr): Promise<{ caller: ApiCaller; authSource: 'gh' | 'token' } | { error: string }> {
  const gh = await detectGhCli()
  if (gh.available && gh.authenticated) {
    const caller: ApiCaller = async (method, path, body) => {
      const args = [
        'api',
        ...ghHostnameArgs(resolved),
        '--method',
        method,
        path,
        '-H',
        'Accept: application/vnd.github+json',
      ]
      try {
        let stdout: string
        if (body !== undefined) {
          args.push('--input', '-')
          ;({ stdout } = await execWithInput('gh', args, JSON.stringify(body)))
        } else {
          ;({ stdout } = await execWithInput('gh', args, ''))
        }
        const json = stdout.trim() ? JSON.parse(stdout) : null
        return { ok: true, status: 200, json, text: stdout }
      } catch (err: any) {
        const stdout = String(err?.stdout || '')
        const stderr = String(err?.stderr || err?.message || '')
        let json: any = null
        try {
          json = stdout ? JSON.parse(stdout) : null
        } catch {
          // ignore
        }
        const status = typeof err?.code === 'number' ? err.code : 500
        return {
          ok: false,
          status,
          json,
          text: json?.message || stderr || stdout || 'gh api failed',
        }
      }
    }
    return { caller, authSource: 'gh' }
  }

  const token = readGithubToken()
  if (!token) {
    return {
      error:
        'Cannot upload images: no `gh` CLI on $PATH (or not authenticated) and no $GITHUB_TOKEN. Run `gh auth login` or set $GITHUB_TOKEN.',
    }
  }

  const base = githubApiBase(resolved.host)
  const caller: ApiCaller = async (method, path, body) => {
    const res = await fetch(`${base}/${path.replace(/^\//, '')}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'diffing-cli',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45_000),
    })
    const text = await res.text().catch(() => '')
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // ignore
    }
    return { ok: res.ok, status: res.status, json, text: json?.message || text }
  }
  return { caller, authSource: 'token' }
}

async function readFileBytes(dir: string, filename: string): Promise<Buffer> {
  return readFile(join(dir, filename))
}

/**
 * Upload unique attachment blobs to `refs/diffing/attachments/pr-<N>` and
 * rewrite every local `/api/attachments/…` URL in the given bodies.
 *
 * On `dryRun: true`, builds placeholder URLs (`…/raw/<pending>/…`) without
 * calling GitHub.
 */
export async function rewriteLocalAttachmentsInBodies(
  resolved: ResolvedPr,
  bodies: string[],
  opts?: { dryRun?: boolean; attachmentsDir?: string },
): Promise<RewriteResult> {
  const dryRun = opts?.dryRun === true
  const planned = await planAttachmentUploads(bodies, { attachmentsDir: opts?.attachmentsDir })
  if (planned.error) {
    return { bodies, urlMap: {}, uploaded: 0, dryRun, error: planned.error }
  }
  if (planned.plans.length === 0) {
    return { bodies, urlMap: {}, uploaded: 0, dryRun }
  }

  if (dryRun) {
    const urlMap: Record<string, string> = {}
    for (const p of planned.plans) {
      urlMap[p.localUrl] = githubRawBlobUrl(resolved, '<pending>', p.treePath)
    }
    return {
      bodies: bodies.map((b) => rewriteAttachmentUrls(b, urlMap)),
      urlMap,
      uploaded: 0,
      dryRun: true,
    }
  }

  const api = await createGhApiCaller(resolved)
  if ('error' in api) {
    return { bodies, urlMap: {}, uploaded: 0, dryRun, error: api.error }
  }
  const { caller } = api
  const repoPath = `repos/${resolved.owner}/${resolved.repo}`
  const dir = attachmentsDir(opts?.attachmentsDir)

  // Deduplicate blob uploads by content hash
  const hashToBlobSha = new Map<string, string>()
  const uniqueByHash = new Map<string, AttachmentUploadPlan>()
  for (const p of planned.plans) {
    if (!uniqueByHash.has(p.contentHash)) uniqueByHash.set(p.contentHash, p)
  }

  for (const p of uniqueByHash.values()) {
    const bytes = await readFileBytes(dir, p.filename)
    const res = await caller('POST', `${repoPath}/git/blobs`, {
      content: bytes.toString('base64'),
      encoding: 'base64',
    })
    if (!res.ok || !res.json?.sha) {
      return {
        bodies,
        urlMap: {},
        uploaded: 0,
        dryRun,
        error: contentsWriteHint(res.text || `Failed to create blob for ${p.filename}`),
      }
    }
    hashToBlobSha.set(p.contentHash, res.json.sha as string)
  }

  const tree = [...uniqueByHash.values()].map((p) => ({
    path: p.treePath,
    mode: '100644' as const,
    type: 'blob' as const,
    sha: hashToBlobSha.get(p.contentHash)!,
  }))

  const treeRes = await caller('POST', `${repoPath}/git/trees`, { tree })
  if (!treeRes.ok || !treeRes.json?.sha) {
    return {
      bodies,
      urlMap: {},
      uploaded: 0,
      dryRun,
      error: contentsWriteHint(treeRes.text || 'Failed to create git tree for attachments'),
    }
  }

  const refName = attachmentRefName(resolved.pullNumber)
  // GET git/ref/<name-without-refs-prefix>
  const refSuffix = refName.replace(/^refs\//, '')
  const existing = await caller('GET', `${repoPath}/git/ref/${refSuffix}`)
  const parents: string[] =
    existing.ok && existing.json?.object?.sha ? [existing.json.object.sha as string] : []

  const commitRes = await caller('POST', `${repoPath}/git/commits`, {
    message: `diffing: attach review images for PR #${resolved.pullNumber}`,
    tree: treeRes.json.sha,
    parents,
  })
  if (!commitRes.ok || !commitRes.json?.sha) {
    return {
      bodies,
      urlMap: {},
      uploaded: 0,
      dryRun,
      error: contentsWriteHint(commitRes.text || 'Failed to create attachment commit'),
    }
  }
  const commitSha = commitRes.json.sha as string

  if (parents.length === 0) {
    const createRef = await caller('POST', `${repoPath}/git/refs`, {
      ref: refName,
      sha: commitSha,
    })
    if (!createRef.ok) {
      return {
        bodies,
        urlMap: {},
        uploaded: 0,
        dryRun,
        error: contentsWriteHint(createRef.text || `Failed to create ${refName}`),
      }
    }
  } else {
    const updateRef = await caller('PATCH', `${repoPath}/git/refs/${refSuffix}`, {
      sha: commitSha,
      force: false,
    })
    if (!updateRef.ok) {
      return {
        bodies,
        urlMap: {},
        uploaded: 0,
        dryRun,
        error: contentsWriteHint(updateRef.text || `Failed to update ${refName}`),
      }
    }
  }

  const urlMap: Record<string, string> = {}
  for (const p of planned.plans) {
    urlMap[p.localUrl] = githubRawBlobUrl(resolved, commitSha, p.treePath)
  }

  return {
    bodies: bodies.map((b) => rewriteAttachmentUrls(b, urlMap)),
    urlMap,
    uploaded: uniqueByHash.size,
    dryRun: false,
  }
}
