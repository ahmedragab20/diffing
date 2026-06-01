import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { getProjectStorageDir } from './git.js'
import type { ReviewComment } from './types.js'

/**
 * A review comment that already exists on the PR. Fetched from GitHub at
 * session start, then displayed read-only in the UI as context. We never
 * POST these back — the reviewer can only ADD new comments on top.
 */
export interface PrExistingComment {
  /** GitHub's database id for the review comment. */
  id: number
  author: { login: string; avatarUrl?: string } | null
  body: string
  /** File path as GitHub reports it (no `a/` / `b/` prefix). */
  path: string
  /** `null` when the comment is anchored to the file rather than a specific line. */
  line: number | null
  /** GitHub's "LEFT" (deletions) or "RIGHT" (additions) side, or null. */
  side: 'LEFT' | 'RIGHT' | null
  createdAt: string
  updatedAt: string
  /** The state of the review this comment belongs to (if it's the head comment of a review). */
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED' | null
  replies: PrExistingReply[]
  /** GitHub returns this when the diff has shifted; we surface it as a warning. */
  isOutdated: boolean
}

export interface PrExistingReply {
  id: number
  author: { login: string; avatarUrl?: string } | null
  body: string
  createdAt: string
  updatedAt: string
}

export interface PrAuthor {
  login: string
  avatarUrl?: string
}

export type PrDecision = 'approve' | 'comment' | 'request-changes'

/**
 * A full PR review session: the cached diff + metadata + the in-progress
 * new comments + the read-only existing comments. Persisted to
 * `pr-session.json` in the per-repo storage dir.
 */
export interface PrSession {
  /** Original `gh pr <ref>` input as the user typed it. */
  ref: string
  /** Resolved `owner` segment from `repository.owner.login`. */
  owner: string
  /** Resolved `repository.name`. */
  repo: string
  pullNumber: number
  /** The PR's head SHA — used to detect "force-pushed" between fetches. */
  headSha: string
  /** The PR's base SHA (often just `refs/heads/main`). */
  baseSha: string
  title: string
  url: string
  author: PrAuthor | null
  additions: number
  deletions: number
  changedFiles: number
  /** The full unified diff for the PR. */
  diff: string
  /** Comments the user is writing *right now* in this diffing session. */
  comments: ReviewComment[]
  /** Read-only existing comments fetched from GitHub. */
  existingComments: PrExistingComment[]
  /** Set after a successful submit; allows us to surface a no-op on double-click. */
  submittedAt?: number
  submittedReviewId?: number
  submittedReviewUrl?: string
  /** The auth source we used last (for diagnostics). */
  authSource?: 'gh' | 'token'
}

export interface PrSessionStore {
  get(): Promise<PrSession | null>
  set(session: PrSession): Promise<void>
  /** Patch fields of the session (shallow merge). Returns the new full session. */
  update(fields: Partial<PrSession>): Promise<PrSession | null>
  clear(): Promise<void>
}

export class FilePrSessionStore implements PrSessionStore {
  private dirPath: string
  private filePath: string

  constructor(storageDir?: string) {
    this.dirPath = storageDir ?? getProjectStorageDir()
    this.filePath = join(this.dirPath, 'pr-session.json')
  }

  async get(): Promise<PrSession | null> {
    try {
      const data = await readFile(this.filePath, 'utf-8')
      return JSON.parse(data) as PrSession
    } catch {
      return null
    }
  }

  private async save(session: PrSession): Promise<void> {
    try {
      await mkdir(this.dirPath, { recursive: true })
      await writeFile(this.filePath, JSON.stringify(session, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save pr-session to file:', err)
    }
  }

  async set(session: PrSession): Promise<void> {
    await this.save(session)
  }

  async update(fields: Partial<PrSession>): Promise<PrSession | null> {
    const current = await this.get()
    if (!current) return null
    const next = { ...current, ...fields }
    await this.save(next)
    return next
  }

  async clear(): Promise<void> {
    try {
      const { unlink } = await import('node:fs/promises')
      await unlink(this.filePath)
    } catch {
      // ignore
    }
  }
}

export class InMemoryPrSessionStore implements PrSessionStore {
  private current: PrSession | null = null

  async get(): Promise<PrSession | null> {
    return this.current
  }

  async set(session: PrSession): Promise<void> {
    this.current = session
  }

  async update(fields: Partial<PrSession>): Promise<PrSession | null> {
    if (!this.current) return null
    this.current = { ...this.current, ...fields }
    return this.current
  }

  async clear(): Promise<void> {
    this.current = null
  }
}
