import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { getRepoRoot, getProjectStorageDir } from './git.js'
import type { ReviewComment, CommentReply } from './types.js'

export interface CommentStore {
  getAll(): Promise<ReviewComment[]>
  add(comment: ReviewComment): Promise<ReviewComment>
  update(id: string, fields: { body?: string; status?: ReviewComment['status'] }): Promise<ReviewComment | null>
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

  async update(id: string, fields: { body?: string; status?: ReviewComment['status'] }): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === id)
    if (!comment) return null
    if (fields.body !== undefined) comment.body = fields.body
    if (fields.status !== undefined) comment.status = fields.status
    return comment
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

  async add(comment: ReviewComment): Promise<ReviewComment> {
    const comments = await this.getAll()
    comments.push(comment)
    await this.save(comments)
    return comment
  }

  async update(id: string, fields: { body?: string; status?: ReviewComment['status'] }): Promise<ReviewComment | null> {
    const comments = await this.getAll()
    const index = comments.findIndex((c) => c.id === id)
    if (index === -1) return null
    const comment = comments[index]
    if (fields.body !== undefined) comment.body = fields.body
    if (fields.status !== undefined) comment.status = fields.status
    await this.save(comments)
    return comment
  }

  async remove(id: string): Promise<boolean> {
    const comments = await this.getAll()
    const index = comments.findIndex((c) => c.id === id)
    if (index === -1) return false
    comments.splice(index, 1)
    await this.save(comments)
    return true
  }

  async addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null> {
    const comments = await this.getAll()
    const index = comments.findIndex((c) => c.id === commentId)
    if (index === -1) return null
    const comment = comments[index]
    if (!comment.replies) comment.replies = []
    comment.replies.push(reply)
    await this.save(comments)
    return comment
  }

  async removeReply(commentId: string, replyId: string): Promise<ReviewComment | null> {
    const comments = await this.getAll()
    const index = comments.findIndex((c) => c.id === commentId)
    if (index === -1) return null
    const comment = comments[index]
    const replyIndex = comment.replies.findIndex((r) => r.id === replyId)
    if (replyIndex === -1) return null
    comment.replies.splice(replyIndex, 1)
    await this.save(comments)
    return comment
  }

  async updateReply(commentId: string, replyId: string, body: string): Promise<ReviewComment | null> {
    const comments = await this.getAll()
    const index = comments.findIndex((c) => c.id === commentId)
    if (index === -1) return null
    const comment = comments[index]
    const reply = comment.replies.find((r) => r.id === replyId)
    if (!reply) return null
    reply.body = body
    await this.save(comments)
    return comment
  }
}

