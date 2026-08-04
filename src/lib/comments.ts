import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { getRepoRoot, getProjectStorageDir } from './git.js'
import type { ReviewComment, CommentReply } from './types.js'

export interface CommentUpdateFields {
  body?: string
  status?: ReviewComment['status']
  /**
   * Anchor remap after an in-place edit session saves: the comment's diff
   * coordinates are updated to where the edited document left them, so the
   * refreshed diff re-anchors threads at their live position instead of
   * marking them outdated.
   */
  side?: ReviewComment['side']
 lineNumber?: number;

 startLineNumber?: number;

}

export interface CommentStore {
  getAll(): Promise<ReviewComment[]>
  add(comment: ReviewComment): Promise<ReviewComment>
  update(id: string, fields: CommentUpdateFields): Promise<ReviewComment | null>
  /** Resolve every open comment in one write. Returns how many were updated. */
  resolveAllOpen(): Promise<number>
  remove(id: string): Promise<boolean>
  addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null>
  removeReply(commentId: string, replyId: string): Promise<ReviewComment | null>
  updateReply(commentId: string, replyId: string, body: string): Promise<ReviewComment | null>
}

export class InMemoryCommentStore implements CommentStore {
  private comments: ReviewComment[] = []

  async getAll(): Promise<ReviewComment[]> {
    return this.comments
  }

  async add(comment: ReviewComment): Promise<ReviewComment> {
    this.comments.push(comment)
    return comment
  }

  async update(id: string, fields: CommentUpdateFields): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === id)
    if (!comment) return null
    if (fields.body !== undefined) comment.body = fields.body
    if (fields.status !== undefined) comment.status = fields.status
    if (fields.side !== undefined) comment.side = fields.side
    if (fields.lineNumber !== undefined) comment.lineNumber = fields.lineNumber
    if (fields.startLineNumber !== undefined) comment.startLineNumber = fields.startLineNumber
    return comment
  }

  async resolveAllOpen(): Promise<number> {
    let n = 0
    for (const c of this.comments) {
      if (c.status === 'open') {
        c.status = 'resolved'
        n++
      }
    }
    return n
  }

  async remove(id: string): Promise<boolean> {
    const index = this.comments.findIndex((c) => c.id === id)
    if (index === -1) return false
    this.comments.splice(index, 1)
    return true
  }

  async addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === commentId)
    if (!comment) return null
    comment.replies.push(reply)
    return comment
  }

  async removeReply(commentId: string, replyId: string): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === commentId)
    if (!comment) return null
    const replyIndex = comment.replies.findIndex((r) => r.id === replyId)
    if (replyIndex === -1) return null
    comment.replies.splice(replyIndex, 1)
    return comment
  }

  async updateReply(commentId: string, replyId: string, body: string): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === commentId)
    if (!comment) return null
    const reply = comment.replies.find((r) => r.id === replyId)
    if (!reply) return null
    reply.body = body
    return comment
  }
}

export class FileCommentStore implements CommentStore {
  private dirPath: string
  private filePath: string
  private mutationQueue: Promise<void> = Promise.resolve()

  /**
   * @param storageDir Absolute directory to persist `comments.json` in.
   *   Defaults to the per-repo storage dir under `~/.diffing` — comments are
   *   NEVER written inside the reviewed (consumer) repo, so a consumer project
   *   stays free of any diffing-specific artifacts. The override exists only so
   *   tests can point at a throwaway temp dir.
   */
  constructor(storageDir?: string) {
    this.dirPath = storageDir ?? getProjectStorageDir()
    this.filePath = join(this.dirPath, 'comments.json')
  }

  async getAll(): Promise<ReviewComment[]> {
    try {
      const data = await readFile(this.filePath, 'utf-8')
      return JSON.parse(data)
    } catch {
      return []
    }
  }

  private async save(comments: ReviewComment[]): Promise<void> {
    try {
      await mkdir(this.dirPath, { recursive: true })
      try {
        const repoRoot = getRepoRoot()
        await writeFile(join(this.dirPath, 'repo_path.txt'), repoRoot, 'utf-8')
      } catch {
        // Ignore if outside git repo or in mock sandboxes
      }
      await writeFile(this.filePath, JSON.stringify(comments, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save comments to file:', err)
    }
  }

  /** Serialize each read-modify-write cycle so concurrent API calls cannot overwrite one another. */
  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async add(comment: ReviewComment): Promise<ReviewComment> {
    return this.enqueueMutation(async () => {
      const comments = await this.getAll()
      comments.push(comment)
      await this.save(comments)
      return comment
    })
  }

  async update(id: string, fields: CommentUpdateFields): Promise<ReviewComment | null> {
    return this.enqueueMutation(async () => {
      const comments = await this.getAll()
      const index = comments.findIndex((c) => c.id === id)
      if (index === -1) return null
      const comment = comments[index]
      if (fields.body !== undefined) comment.body = fields.body
      if (fields.status !== undefined) comment.status = fields.status
      if (fields.side !== undefined) comment.side = fields.side
      if (fields.lineNumber !== undefined) comment.lineNumber = fields.lineNumber
      if (fields.startLineNumber !== undefined) comment.startLineNumber = fields.startLineNumber
      await this.save(comments)
      return comment
    })
  }

  async resolveAllOpen(): Promise<number> {
    return this.enqueueMutation(async () => {
      const comments = await this.getAll()
      let n = 0
      for (const c of comments) {
        if (c.status === 'open') {
          c.status = 'resolved'
          n++
        }
      }
      if (n > 0) await this.save(comments)
      return n
    })
  }

  async remove(id: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const comments = await this.getAll()
      const index = comments.findIndex((c) => c.id === id)
      if (index === -1) return false
      comments.splice(index, 1)
      await this.save(comments)
      return true
    })
  }

  async addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null> {
    return this.enqueueMutation(async () => {
      const comments = await this.getAll()
      const index = comments.findIndex((c) => c.id === commentId)
      if (index === -1) return null
      const comment = comments[index]
      if (!comment.replies) comment.replies = []
      comment.replies.push(reply)
      await this.save(comments)
      return comment
    })
  }

  async removeReply(commentId: string, replyId: string): Promise<ReviewComment | null> {
    return this.enqueueMutation(async () => {
      const comments = await this.getAll()
      const index = comments.findIndex((c) => c.id === commentId)
      if (index === -1) return null
      const comment = comments[index]
      const replyIndex = comment.replies.findIndex((r) => r.id === replyId)
      if (replyIndex === -1) return null
      comment.replies.splice(replyIndex, 1)
      await this.save(comments)
      return comment
    })
  }

  async updateReply(commentId: string, replyId: string, body: string): Promise<ReviewComment | null> {
    return this.enqueueMutation(async () => {
      const comments = await this.getAll()
      const index = comments.findIndex((c) => c.id === commentId)
      if (index === -1) return null
      const comment = comments[index]
      const reply = comment.replies.find((r) => r.id === replyId)
      if (!reply) return null
      reply.body = body
      await this.save(comments)
      return comment
    })
  }
}
