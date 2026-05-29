import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises'
import { join, extname, resolve, basename } from 'node:path'
import { watch, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { getFileContent, isImageFile, getRepoRoot, getProjectStorageDir, getMergeStatus, gitAddFile, listRepoFiles, revertHunk } from './lib/git.js'
import { loadSettings, saveSettings } from './lib/settings.js'
import { InMemoryCommentStore, FileCommentStore } from './lib/comments.js'
import type { CommentStore } from './lib/comments.js'
import { isSafePath } from './lib/path.js'
import { ReviewSession } from './lib/review-session.js'
import { formatComments } from './lib/comment-format.js'
import { executeDiffWithMeta } from './lib/diff-engine.js'
import type { DiffOptions } from './lib/diff-options.js'
import { DEFAULTS } from './lib/diff-options.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

function isCustomMode(opts: DiffOptions): boolean {
  return opts.revisions.length > 0 || opts.pathspecs.length > 0
}

export function createApp(clientDir: string, diffOpts: DiffOptions = DEFAULTS, commentStore?: CommentStore) {
  const app = new Hono()
  const customMode = isCustomMode(diffOpts)
  const store = commentStore ?? new FileCommentStore()
  const viewedFiles = new Set<string>()

  const activeClients = new Set<(event: string, data: string) => void>()

  const broadcast = (event: string, data: string) => {
    for (const send of activeClients) {
      try {
        send(event, data)
      } catch {
        // Client will be cleaned up on next interval or abort
      }
    }
  }

  // Tracks the "agent waits, human releases" handoff. Whenever the set of
  // blocked agents or the round changes, push an `agent-status` event so the
  // UI's "Send to agent" button can show whether an agent is connected.
  const reviewSession = new ReviewSession((snapshot) =>
    broadcast('agent-status', JSON.stringify(snapshot)),
  )

  let repoRoot: string
  try {
    repoRoot = getRepoRoot()
  } catch {
    repoRoot = process.cwd()
  }

  // Watch the project comment store so any write — whether from this server's
  // own API handlers or from an external agent editing comments.json directly —
  // pushes a `comments` event to every connected client in real time. This is
  // the bidirectional user<->agent channel: one file, one broadcast trigger.
  // Skipped when a comment store is injected (e.g. the in-memory store in
  // tests) since there is no backing file to watch.
  if (!commentStore) {
    try {
      const storageDir = getProjectStorageDir()
      mkdirSync(storageDir, { recursive: true })
      let commentsDebounce: NodeJS.Timeout | null = null
      const commentsWatcher = watch(storageDir, (_eventType, filename) => {
        if (filename && !filename.startsWith('comments.json')) return
        if (commentsDebounce) clearTimeout(commentsDebounce)
        commentsDebounce = setTimeout(() => broadcast('comments', Date.now().toString()), 120)
      })
      commentsWatcher.unref()
    } catch (err) {
      console.warn('Failed to initialize comment store watcher:', err)
    }
  }

  let debounceTimeout: NodeJS.Timeout | null = null

  try {
    const watcher = watch(repoRoot, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      const parts = filename.split(/[/\\]/)
      const isGit = parts.includes('.git')
      const isNodeModules = parts.includes('node_modules')
      const isDist = parts.includes('dist')
      const isChangeset = parts.includes('.changeset')

      let shouldTrigger = false
      if (isGit) {
        const isIndex = filename.endsWith('index')
        const isHead = filename.endsWith('HEAD')
        const isRefs = filename.includes('refs/') || filename.includes('refs\\')
        if (isIndex || isHead || isRefs) {
          shouldTrigger = true
        }
      } else if (!isNodeModules && !isDist && !isChangeset) {
        shouldTrigger = true
      }

      if (shouldTrigger) {
        if (debounceTimeout) clearTimeout(debounceTimeout)
        debounceTimeout = setTimeout(() => broadcast('change', Date.now().toString()), 200)
      }
    })
    watcher.unref()
  } catch (err) {
    console.warn('Failed to initialize repository watcher:', err)
  }

  app.get('/api/live', async (c) => {
    return streamSSE(c, async (stream) => {
      const sendUpdate = (event: string, data: string) => {
        stream.writeSSE({ event, data })
      }
      activeClients.add(sendUpdate)

      // Confirm the connection so the client's EventSource fires `open`
      // immediately instead of waiting for the first real event.
      await stream.writeSSE({ event: 'heartbeat', data: Date.now().toString() })

      const heartbeatInterval = setInterval(() => {
        stream.writeSSE({ event: 'heartbeat', data: Date.now().toString() }).catch(() => {})
      }, 15000)

      // Keep the SSE callback pending until the client disconnects. Without
      // this await the callback resolves instantly and hono closes the stream,
      // so no events would ever reach connected clients.
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeatInterval)
          activeClients.delete(sendUpdate)
          resolve()
        })
      })
    })
  })

  app.get('/api/diff', async (c) => {
    const staged = c.req.query('staged') === 'true'
    const untracked = c.req.query('untracked') === 'true'

    const optsForDiff = customMode
      ? diffOpts
      : { ...diffOpts, staged, includeUntracked: untracked }

    const result = await executeDiffWithMeta(optsForDiff)

    return c.json({
      patch: result.patch,
      repoName: result.repoName,
      branch: result.branch,
      customMode,
      binaryFiles: result.binaryFiles,
      tabSizeMap: result.tabSizeMap,
      untrackedFiles: result.untrackedFiles,
    })
  })

  app.get('/api/file-content', (c) => {
    const path = c.req.query('path')
    const version = c.req.query('version') as 'old' | 'new'
    if (!path || !version) {
      return c.json({ error: 'Missing path or version' }, 400)
    }
    const content = getFileContent(path, version)
    if (!content) {
      return c.json({ error: 'File not found' }, 404)
    }
    const ext = extname(path)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(new Uint8Array(content), {
      headers: { 'Content-Type': contentType },
    })
  })

  // Text-friendly file-content endpoint used by the hunk-expansion feature
  // (Phase B). Returns JSON { content, missing } where `missing` indicates the
  // version didn't exist (new file → old missing, deleted → new missing).
  app.get('/api/file-text', (c) => {
    const path = c.req.query('path')
    const version = c.req.query('version') as 'old' | 'new'
    if (!path || !version) {
      return c.json({ error: 'Missing path or version' }, 400)
    }
    const buffer = getFileContent(path, version)
    if (!buffer) {
      return c.json({ content: '', missing: true })
    }
    // Detect binary by null byte in the first 8KB
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        return c.json({ error: 'Binary file' }, 415)
      }
    }
    return c.json({ content: buffer.toString('utf-8'), missing: false })
  })

  app.post('/api/open-file', async (c) => {
    const { filePath, editor } = await c.req.json<{ filePath: string; editor?: string }>()
    if (!filePath) {
      return c.json({ error: 'filePath is required' }, 400)
    }

    try {
      const root = getRepoRoot()
      if (!isSafePath(filePath, root)) {
        return c.json({ error: 'Forbidden file path' }, 403)
      }
      const absolutePath = resolve(root, filePath)
      const { exec } = await import('node:child_process')

      if (editor === 'vscode') {
        exec(`code "${absolutePath}"`)
      } else if (editor === 'zed') {
        exec(`zed "${absolutePath}"`)
      } else if (editor === 'vim') {
        exec(`osascript -e 'tell application "Terminal" to do script "vim \\"${absolutePath}\\""'`)
      } else if (editor === 'neovim') {
        exec(`osascript -e 'tell application "Terminal" to do script "nvim \\"${absolutePath}\\""'`)
      } else {
        const openModule = await import('open')
        await openModule.default(absolutePath)
      }
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: `Failed to open file: ${err.message}` }, 500)
    }
  })

  app.get('/api/repo-files', (c) => {
    try {
      return c.json({ files: listRepoFiles() })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.get('/api/merge-status', (c) => {
    try {
      const status = getMergeStatus()
      return c.json(status)
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.post('/api/revert-hunk', async (c) => {
    const { filePath, hunkIndex } = await c.req.json<{
      filePath: string
      hunkIndex: number
    }>()
    if (!filePath || typeof hunkIndex !== 'number') {
      return c.json({ error: 'Missing filePath or hunkIndex' }, 400)
    }
    try {
      const root = getRepoRoot()
      if (!isSafePath(filePath, root)) {
        return c.json({ error: 'Forbidden file path' }, 403)
      }
      revertHunk(filePath, hunkIndex)
      return c.json({ ok: true })
    } catch (err: any) {
      const stderr =
        typeof err?.stderr === 'string'
          ? err.stderr
          : err?.stderr instanceof Buffer
            ? err.stderr.toString('utf-8')
            : ''
      return c.json(
        { error: stderr || err?.message || 'Failed to revert hunk' },
        500,
      )
    }
  })

  app.post('/api/save-file', async (c) => {
    const { filePath, content, gitAdd } = await c.req.json<{
      filePath: string
      content: string
      gitAdd?: boolean
    }>()
    if (!filePath || typeof content !== 'string') {
      return c.json({ error: 'Missing filePath or content' }, 400)
    }
    try {
      const root = getRepoRoot()
      if (!isSafePath(filePath, root)) {
        return c.json({ error: 'Forbidden file path' }, 403)
      }
      const absolutePath = resolve(root, filePath)
      await writeFile(absolutePath, content, 'utf-8')
      if (gitAdd) {
        try {
          gitAddFile(filePath)
        } catch (err: any) {
          return c.json({ ok: true, gitAddError: err.message })
        }
      }
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: `Failed to save file: ${err.message}` }, 500)
    }
  })

  app.get('/api/settings', (c) => {
    return c.json(loadSettings())
  })

  app.put('/api/settings', async (c) => {
    const body = await c.req.json()
    const settings = saveSettings(body)
    return c.json(settings)
  })

  app.get('/api/viewed', (c) => {
    return c.json([...viewedFiles])
  })

  app.put('/api/viewed', async (c) => {
    const { filePath, viewed } = await c.req.json<{ filePath: string; viewed: boolean }>()
    if (viewed) {
      viewedFiles.add(filePath)
    } else {
      viewedFiles.delete(filePath)
    }
    return c.json({ ok: true })
  })

  app.get('/api/comments', async (c) => {
    const comments = await store.getAll()
    return c.json(comments)
  })

  app.post('/api/comments', async (c) => {
    const body = await c.req.json()
    const comment = {
      id: crypto.randomUUID(),
      filePath: body.filePath,
      side: body.side,
      lineNumber: body.lineNumber,
      startLineNumber: body.startLineNumber,
      lineContent: body.lineContent,
      body: body.body,
      status: 'open' as const,
      createdAt: Date.now(),
      replies: [],
    }
    const created = await store.add(comment)
    return c.json(created, 201)
  })

  app.put('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const { body, status } = await c.req.json()
    const updated = await store.update(id, { body, status })
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.post('/api/comments/:id/replies', async (c) => {
    const commentId = c.req.param('id')
    const { body, role, model } = await c.req.json()
    const reply = {
      id: crypto.randomUUID(),
      body,
      createdAt: Date.now(),
      // Agents identify themselves by sending a `model`. Honour an explicit
      // role, otherwise infer agent-vs-user from the presence of a model so
      // replies posted via the documented `{ body, model }` payload are
      // attributed correctly.
      role: role || (model ? 'agent' : 'user'),
      model: model || undefined,
    }
    const updated = await store.addReply(commentId, reply)
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/comments/:id/replies/:replyId', async (c) => {
    const commentId = c.req.param('id')
    const replyId = c.req.param('replyId')
    const updated = await store.removeReply(commentId, replyId)
    if (!updated) return c.json({ error: 'Comment or reply not found' }, 404)
    return c.json(updated)
  })

  app.put('/api/comments/:id/replies/:replyId', async (c) => {
    const commentId = c.req.param('id')
    const replyId = c.req.param('replyId')
    const { body } = await c.req.json()
    if (!body) return c.json({ error: 'Body is required' }, 400)
    const updated = await store.updateReply(commentId, replyId, body)
    if (!updated) return c.json({ error: 'Comment or reply not found' }, 404)
    return c.json(updated)
  })

  app.post('/api/comments/:id/apply-suggestion', async (c) => {
    const id = c.req.param('id')
    const comment = (await store.getAll()).find((c) => c.id === id)
    if (!comment) {
      return c.json({ error: 'Comment not found' }, 404)
    }

    if (comment.side !== 'additions') {
      return c.json({ error: 'Suggestions can only be applied to added or modified lines' }, 400)
    }

    const match = comment.body.match(/```suggestion\n([\s\S]*?)```/)
    if (!match) {
      return c.json({ error: 'No suggestion block found in comment body' }, 400)
    }
    const suggestion = match[1]

    try {
      const root = getRepoRoot()
      if (!isSafePath(comment.filePath, root)) {
        return c.json({ error: 'Forbidden file path' }, 403)
      }
      const absolutePath = resolve(root, comment.filePath)
      const content = await readFile(absolutePath, 'utf-8')
      const lines = content.split(/\r?\n/)

      const lineIdx = comment.lineNumber - 1
      if (lineIdx < 0 || lineIdx >= lines.length) {
        return c.json({ error: 'Comment line number out of range' }, 400)
      }

      lines[lineIdx] = suggestion.trimEnd()
      const newContent = lines.join('\n')
      await writeFile(absolutePath, newContent, 'utf-8')

      await store.update(id, { status: 'resolved' })

      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: `Failed to apply suggestion: ${err.message}` }, 500)
    }
  })

  app.delete('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await store.remove(id)
    if (!removed) return c.json({ error: 'Comment not found' }, 404)
    return c.json({ ok: true })
  })

  // ── Agent handoff: "agent waits, human releases" ──────────────────────────
  // The UI's "Send to agent" button POSTs here. We snapshot the current
  // comments, format them, and release every agent blocked on /api/review/await.
  app.post('/api/review/send', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const generalComment =
      typeof body?.generalComment === 'string' ? body.generalComment : undefined
    const all = await store.getAll()
    const openCount = all.filter((x) => x.status === 'open').length
    const payload = reviewSession.send({
      sentAt: Date.now(),
      commentXml: formatComments(all, generalComment),
      openCount,
      comments: all,
    })
    return c.json({
      ok: true,
      round: payload.round,
      openCount: payload.openCount,
      waiters: reviewSession.snapshot().waiters,
    })
  })

  // Long-poll the waiting agent blocks on. Each request stays short (≤50s) so
  // it survives proxy/keep-alive limits; the client owns the total wait budget
  // by re-polling with the `sinceRound` cursor it last saw.
  app.get('/api/review/await', async (c) => {
    const sinceRaw = c.req.query('sinceRound')
    const sinceRound = sinceRaw !== undefined && sinceRaw !== '' ? Number(sinceRaw) : undefined
    const requested = Number(c.req.query('timeoutMs')) || 25000
    const timeoutMs = Math.min(Math.max(requested, 1000), 50000)
    const result = await reviewSession.await({
      sinceRound: Number.isNaN(sinceRound as number) ? undefined : sinceRound,
      timeoutMs,
      signal: c.req.raw.signal,
    })
    return c.json(result)
  })

  app.get('/api/review/status', (c) => {
    return c.json(reviewSession.snapshot())
  })

  app.post('/api/attachments', async (c) => {
    const body = await c.req.parseBody()
    const file = body['file']
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded' }, 400)
    }

    try {
      const storageDir = getProjectStorageDir()
      const attachmentsDir = join(storageDir, 'attachments')
      await mkdir(attachmentsDir, { recursive: true })

      const repoRoot = getRepoRoot()
      await writeFile(join(storageDir, 'repo_path.txt'), repoRoot, 'utf-8')

      const ext = extname(file.name) || '.png'
      const filename = `pasted_image_${crypto.randomUUID()}${ext}`
      const absolutePath = join(attachmentsDir, filename)

      const arrayBuffer = await file.arrayBuffer()
      await writeFile(absolutePath, new Uint8Array(arrayBuffer))

      return c.json({ url: `/api/attachments/${filename}` })
    } catch (err: any) {
      return c.json({ error: `Failed to save attachment: ${err.message}` }, 500)
    }
  })

  app.get('/api/attachments/:filename', async (c) => {
    const filename = c.req.param('filename')
    const storageDir = getProjectStorageDir()
    const attachmentsDir = join(storageDir, 'attachments')
    const absolutePath = resolve(attachmentsDir, filename)

    if (!absolutePath.startsWith(attachmentsDir)) {
      return c.text('Forbidden', 403)
    }

    try {
      const content = await readFile(absolutePath)
      const ext = extname(absolutePath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      })
    } catch {
      return c.text('Attachment not found', 404)
    }
  })

  app.get('/*', async (c) => {
    let filePath = c.req.path
    if (filePath === '/') filePath = '/index.html'

    const relativePath = filePath.slice(1)
    if (!isSafePath(relativePath, clientDir)) {
      return c.text('Forbidden', 403)
    }
    const fullPath = resolve(clientDir, relativePath)
    try {
      const content = await readFile(fullPath)
      const ext = extname(fullPath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      })
    } catch {
      const indexContent = await readFile(join(clientDir, 'index.html'))
      return new Response(indexContent, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  })

  return app
}

export async function cleanupStaleProjects(): Promise<void> {
  const baseDir = join(homedir(), '.diffit')
  if (!existsSync(baseDir)) return

  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    const now = Date.now()
    const STALE_TIME = 14 * 24 * 60 * 60 * 1000

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectDir = join(baseDir, entry.name)
        const repoPathFile = join(projectDir, 'repo_path.txt')
        const commentsFile = join(projectDir, 'comments.json')

        let shouldDelete = false

        if (existsSync(repoPathFile)) {
          try {
            const repoPath = (await readFile(repoPathFile, 'utf-8')).trim()
            if (!repoPath || !existsSync(repoPath)) {
              shouldDelete = true
            }
          } catch {
            // ignore
          }
        }

        if (!shouldDelete && existsSync(commentsFile)) {
          try {
            const stats = await stat(commentsFile)
            if (now - stats.mtimeMs > STALE_TIME) {
              shouldDelete = true
            }
          } catch {
            // ignore
          }
        }

        if (shouldDelete) {
          await rm(projectDir, { recursive: true, force: true })
        }
      }
    }
  } catch (err) {
    console.error('Failed to cleanup stale projects:', err)
  }
}

export function startServer(options: {
  port: number
  host: string
  clientDir: string
  diffOpts?: DiffOptions
}): Promise<{ port: number }> {
  cleanupStaleProjects().catch((err) => {
    console.error('Failed to clean up stale projects:', err)
  })

  const app = createApp(options.clientDir, options.diffOpts)

  return new Promise((resolve) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port,
      hostname: options.host,
    }, (info) => {
      resolve({ port: info.port })
    })
  })
}
