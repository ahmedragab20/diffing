import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises'
import { join, extname, resolve, basename } from 'node:path'
import { watch, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { getFileContent, isImageFile, getRepoRoot, getProjectStorageDir, getMergeStatus, gitAddFile, listRepoFiles, revertHunk, getHunkHistory } from './lib/git.js'
import { searchFiles, searchContent, searchSymbols, searchAll, getSearchStatus, trackSelection } from './lib/search.js'
import { loadSettings, saveSettings } from './lib/settings.js'
import { InMemoryCommentStore, FileCommentStore } from './lib/comments.js'
import type { CommentStore } from './lib/comments.js'
import type { ReviewComment, ReviewDecision, ReviewMode } from './lib/types.js'
import { FilePlanStore } from './lib/plans.js'
import type { PlanStore } from './lib/plans.js'
import { FileUiStateStore } from './lib/state.js'
import { isSafePath, toSafeRelativePath } from './lib/path.js'
import { resolveEditorCommand, type EditorChoice } from './lib/editor-launcher.js'
import { ReviewSession } from './lib/review-session.js'
import { PlanReviewSession } from './lib/plan-review-session.js'
import { formatComments } from './lib/comment-format.js'
import { formatPlanReview, sectionTitleForLine, extractPlanLines } from './lib/plan-format.js'
import type { PlanDecision, PlanMode } from './lib/plan-types.js'
import { executeDiffWithMeta } from './lib/diff-engine.js'
import type { DiffOptions } from './lib/diff-options.js'
import { DEFAULTS } from './lib/diff-options.js'
import { FilePrSessionStore, InMemoryPrSessionStore } from './lib/pr-session.js'
import type { PrSessionStore, PrDecision } from './lib/pr-session.js'
import {
  buildPrSession,
  refreshPrSession,
  parsePrRef,
  detectCwdRepo,
  submitReview as githubSubmitReview,
} from './lib/github.js'

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
  return opts.revisions.length > 0 || opts.pathspecs.length > 0 || opts.showMode
}

export function createApp(
  clientDir: string,
  diffOpts: DiffOptions = DEFAULTS,
  commentStore?: CommentStore,
  planStore?: PlanStore,
  prSessionStore?: PrSessionStore,
  prMode = false,
) {
  const app = new Hono()
  const customMode = isCustomMode(diffOpts)
  const store = commentStore ?? new FileCommentStore()
  const plans = planStore ?? new FilePlanStore()
  const prStore = prSessionStore ?? new FilePrSessionStore()
  const uiStateStore = new FileUiStateStore()
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

  // The plan-review twin of reviewSession: tracks agents blocked waiting for a
  // plan verdict so the UI can show whether one is connected.
  const planReviewSession = new PlanReviewSession((snapshot) =>
    broadcast('plan-review-status', JSON.stringify(snapshot)),
  )

  let repoRoot: string
  try {
    repoRoot = getRepoRoot()
  } catch {
    repoRoot = process.cwd()
  }

  // Watch the project storage dir so any write — whether from this server's own
  // API handlers or from an external agent editing comments.json / plans.json
  // directly — pushes the matching event (`comments` or `plans`) to every
  // connected client in real time. This is the bidirectional user<->agent
  // channel: one file, one broadcast trigger. Skipped when stores are injected
  // (e.g. the in-memory stores in tests) since there is no backing file to watch.
  if (!commentStore && !planStore) {
    try {
      const storageDir = getProjectStorageDir()
      mkdirSync(storageDir, { recursive: true })
      let commentsDebounce: NodeJS.Timeout | null = null
      let plansDebounce: NodeJS.Timeout | null = null
      let prSessionDebounce: NodeJS.Timeout | null = null
      const storageWatcher = watch(storageDir, (_eventType, filename) => {
        if (!filename) return
        if (filename.startsWith('comments.json')) {
          if (commentsDebounce) clearTimeout(commentsDebounce)
          commentsDebounce = setTimeout(() => broadcast('comments', Date.now().toString()), 120)
        } else if (filename.startsWith('plans.json')) {
          if (plansDebounce) clearTimeout(plansDebounce)
          plansDebounce = setTimeout(() => broadcast('plans', Date.now().toString()), 120)
        } else if (filename.startsWith('pr-session.json')) {
          if (prSessionDebounce) clearTimeout(prSessionDebounce)
          prSessionDebounce = setTimeout(() => broadcast('pr-session', Date.now().toString()), 120)
        }
      })
      storageWatcher.unref()
    } catch (err) {
      console.warn('Failed to initialize storage watcher:', err)
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
    const stagedQuery = c.req.query('staged')
    const untrackedQuery = c.req.query('untracked')
    // MCP and other non-UI callers omit these query parameters. In that case
    // preserve the scope selected when the server started. Explicit UI values
    // still override the startup defaults, including explicit false.
    const staged = stagedQuery === undefined ? diffOpts.staged : stagedQuery === 'true'
    const untracked = untrackedQuery === undefined ? diffOpts.includeUntracked : untrackedQuery === 'true'

    // PR mode: short-circuit and return the cached PR patch. The session
    // lookup is cheap (a JSON read on startup) and avoids a wasteful
    // `git diff` call. Guard with the server's PR mode flag so a stale
    // `pr-session.json` left over from a previous `diffing "gh pr N"` run
    // does not hijack a plain `diffing` invocation.
    if (prMode) {
      const prSession = await prStore.get()
      if (prSession) {
        const binaryFiles: { path: string; type: 'added' | 'deleted' | 'changed' | 'untracked' }[] = []
        // Best-effort tab size from the project's editorconfig.
        const filePaths: string[] = []
        for (const line of prSession.diff.split('\n')) {
          const m = /^diff --git a\/.+ b\/(.+)$/.exec(line)
          if (m) filePaths.push(m[1])
        }
        return c.json({
          patch: prSession.diff,
          repoName: prSession.repo,
          branch: `#${prSession.pullNumber}`,
          customMode: true,
          binaryFiles,
          tabSizeMap: {},
          untrackedFiles: [],
          prMode: true,
          prRef: prSession.ref,
          prOwner: prSession.owner,
          prRepo: prSession.repo,
          prPullNumber: prSession.pullNumber,
          prUrl: prSession.url,
          prTitle: prSession.title,
          prAuthor: prSession.author,
          prHeadSha: prSession.headSha,
          prBaseSha: prSession.baseSha,
        })
      }
    }

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
      // Show mode signals the UI to render commit metadata banners. Both
      // fields are absent in the normal flow so existing clients see the
      // same payload they always did.
      showMode: optsForDiff.showMode || undefined,
      commits: result.commits,
      truncated: result.truncated,
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
      const relPath = toSafeRelativePath(filePath, root)
      if (!relPath) {
        return c.json({ error: 'Forbidden file path' }, 403)
      }
      const absolutePath = resolve(root, relPath)

      if (editor && editor !== 'default') {
        const command = resolveEditorCommand(editor as EditorChoice, absolutePath)
        if (command) {
          const { execFile } = await import('node:child_process')
          execFile(command.cmd, command.args, (err) => {
            if (err) {
              console.error(
                `Failed to launch ${editor} for ${absolutePath}: ${err.message}`,
              )
            }
          })
          return c.json({ ok: true })
        }
      }

      const openModule = await import('open')
      await openModule.default(absolutePath)
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

  // Unified, fff-powered code search. POST (not GET) so large diffs can pass
  // their changed-path set in the body without hitting URL length limits.
  app.post('/api/search', async (c) => {
    const body = await c.req.json<{
      scope?: 'all' | 'files' | 'text' | 'symbols'
      query?: string
      limit?: number
      regex?: boolean
      changedPaths?: string[]
    }>().catch(() => ({}) as Record<string, never>)

    const scope = body.scope ?? 'files'
    const query = typeof body.query === 'string' ? body.query : ''
    const limit = typeof body.limit === 'number' ? body.limit : undefined
    // A non-null `changedPaths` array engages "Changed only" mode: results are
    // restricted to exactly these (current-diff) paths.
    const paths = Array.isArray(body.changedPaths) ? body.changedPaths : undefined

    try {
      if (scope === 'all') {
        return c.json(await searchAll(query, { limit, regex: !!body.regex, paths }))
      }
      if (scope === 'text') {
        return c.json(await searchContent(query, { limit, regex: !!body.regex, paths }))
      }
      if (scope === 'symbols') {
        return c.json(await searchSymbols(query, { limit, paths }))
      }
      return c.json(await searchFiles(query, { limit, paths }))
    } catch (err: any) {
      return c.json({ scope, items: [], total: 0, indexing: false, error: err?.message ?? 'Search failed' }, 500)
    }
  })

  app.get('/api/search/status', async (c) => {
    return c.json(await getSearchStatus())
  })

  // Fire-and-forget: feeds fff's frecency ranking so frequently/recently opened
  // files float to the top of future searches.
  app.post('/api/search/track', async (c) => {
    const { query, path } = await c.req
      .json<{ query?: string; path?: string }>()
      .catch(() => ({}) as Record<string, never>)
    if (path) await trackSelection(query ?? '', path)
    return c.json({ ok: true })
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
      const relPath = toSafeRelativePath(filePath, root)
      if (!relPath) {
        return c.json({ error: 'Forbidden file path' }, 403)
      }
      revertHunk(relPath, hunkIndex)
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

  app.get('/api/hunk-history', async (c) => {
    const filePath = c.req.query('filePath')
    const deletionStart = Number(c.req.query('deletionStart'))
    const deletionCount = Number(c.req.query('deletionCount'))

    if (!filePath || Number.isNaN(deletionStart) || Number.isNaN(deletionCount)) {
      return c.json({ error: 'Missing or invalid parameters' }, 400)
    }

    try {
      const root = getRepoRoot()
      const relPath = toSafeRelativePath(filePath, root)
      if (!relPath) {
        return c.json({ error: 'Forbidden file path' }, 403)
      }
      const revision = diffOpts.showMode
        ? diffOpts.showRevspecs[diffOpts.showRevspecs.length - 1] || 'HEAD'
        : diffOpts.revisions[0] || 'HEAD'
      const history = getHunkHistory(relPath, deletionStart, deletionCount, revision)
      return c.json(history)
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to fetch hunk history' }, 500)
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
      const relPath = toSafeRelativePath(filePath, root)
      if (!relPath) {
        return c.json({ error: 'Forbidden file path' }, 403)
      }
      const absolutePath = resolve(root, relPath)
      await writeFile(absolutePath, content, 'utf-8')
      if (gitAdd) {
        try {
          gitAddFile(relPath)
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

  app.get('/api/ui-state', async (c) => {
    return c.json(await uiStateStore.getAll())
  })

  app.put('/api/ui-state', async (c) => {
    const body = await c.req.json()
    const current = await uiStateStore.getAll()
    const merged = { ...current, ...body }
    for (const key of Object.keys(body)) {
      if (body[key] === null || body[key] === undefined) {
        delete merged[key]
      }
    }
    await uiStateStore.setAll(merged)
    return c.json(merged)
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
      const relPath = toSafeRelativePath(comment.filePath, root)
      if (!relPath) {
        return c.json({ error: 'Forbidden file path' }, 403)
      }
      const absolutePath = resolve(root, relPath)
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

  // ── PR review session ─────────────────────────────────────────────────────
  // All `/api/gh/*` routes are active only when the server was started in PR
  // mode (`diffing "gh pr N"`). A stale `pr-session.json` on disk must not
  // leak PR data into a plain `diffing` invocation. The UI fetches
  // `/api/gh/session` on mount to detect PR mode and switch to <PrReviewApp>.

  /** Shared helper: 404 with a stable shape so the client knows "not in PR mode". */
  const notInPrMode = (c: any) => c.json({ error: 'Not in PR review mode', prMode: false }, 404)

  app.get('/api/gh/session', async (c) => {
    if (!prMode) return notInPrMode(c)
    const session = await prStore.get()
    if (!session) return notInPrMode(c)
    return c.json({
      prMode: true,
      ref: session.ref,
      owner: session.owner,
      repo: session.repo,
      pullNumber: session.pullNumber,
      baseSha: session.baseSha,
      headSha: session.headSha,
      title: session.title,
      url: session.url,
      author: session.author,
      additions: session.additions,
      deletions: session.deletions,
      changedFiles: session.changedFiles,
      existingComments: session.existingComments,
      submittedAt: session.submittedAt,
      submittedReviewId: session.submittedReviewId,
      submittedReviewUrl: session.submittedReviewUrl,
      authSource: session.authSource,
    })
  })

  /** Re-fetch PR metadata (head SHA, diff, existing comments) and persist. */
  app.post('/api/gh/pr/refresh', async (c) => {
    if (!prMode) return notInPrMode(c)
    const session = await prStore.get()
    if (!session) return notInPrMode(c)
    try {
      const refreshed = await refreshPrSession(session)
      await prStore.set(refreshed)
      return c.json({ ok: true, headSha: refreshed.headSha })
    } catch (err: any) {
      return c.json({ error: err?.message ?? 'Refresh failed' }, 500)
    }
  })

  /** Initialize a PR session from a ref like `1234`, `o/r#42`, or a GitHub URL. */
  app.post('/api/gh/pr/init', async (c) => {
    if (!prMode) return notInPrMode(c)
    const body = await c.req.json().catch(() => ({}))
    const ref = typeof body?.ref === 'string' ? body.ref : ''
    if (!ref.trim()) {
      return c.json({ error: 'ref is required' }, 400)
    }
    try {
      const cwdRepo = await detectCwdRepo()
      const resolved = parsePrRef(ref, cwdRepo ?? undefined)
      // Build via gh.
      const session = await buildPrSession(ref)
      await prStore.set(session)
      // Re-resolve in case the user wanted the current cwd's owner for a bare number
      // (already done inside buildPrSession).
      return c.json({
        ok: true,
        ref: session.ref,
        owner: session.owner,
        repo: session.repo,
        pullNumber: session.pullNumber,
        url: session.url,
      })
    } catch (err: any) {
      return c.json({ error: err?.message ?? 'Failed to initialise PR session' }, 500)
    }
  })

  // PR-mode comments live inside `pr-session.json`. The UI calls these instead
  // of the `/api/comments` family when `prMode === true`.
  app.get('/api/gh/pr-session/comments', async (c) => {
    if (!prMode) return notInPrMode(c)
    const session = await prStore.get()
    if (!session) return notInPrMode(c)
    return c.json(session.comments ?? [])
  })

  app.post('/api/gh/pr-session/comments', async (c) => {
    if (!prMode) return notInPrMode(c)
    const body = await c.req.json()
    const session = await prStore.get()
    if (!session) return notInPrMode(c)
    const comment: ReviewComment = {
      id: crypto.randomUUID(),
      filePath: body.filePath,
      side: body.side,
      lineNumber: body.lineNumber,
      startLineNumber: body.startLineNumber,
      lineContent: body.lineContent,
      body: body.body,
      status: 'open',
      createdAt: Date.now(),
      replies: [],
    }
    const next = { ...session, comments: [...(session.comments ?? []), comment] }
    await prStore.set(next)
    return c.json(comment, 201)
  })

  app.put('/api/gh/pr-session/comments/:id', async (c) => {
    if (!prMode) return notInPrMode(c)
    const id = c.req.param('id')
    const { body, status } = await c.req.json()
    const session = await prStore.get()
    if (!session) return notInPrMode(c)
    const comments = (session.comments ?? []).map((cm) =>
      cm.id === id
        ? { ...cm, body: body ?? cm.body, status: status ?? cm.status }
        : cm,
    )
    await prStore.set({ ...session, comments })
    const updated = comments.find((cm) => cm.id === id) ?? null
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/gh/pr-session/comments/:id', async (c) => {
    if (!prMode) return notInPrMode(c)
    const id = c.req.param('id')
    const session = await prStore.get()
    if (!session) return notInPrMode(c)
    const comments = (session.comments ?? []).filter((cm) => cm.id !== id)
    await prStore.set({ ...session, comments })
    return c.json({ ok: true })
  })

  app.post('/api/gh/pr-session/comments/:id/replies', async (c) => {
    if (!prMode) return notInPrMode(c)
    const id = c.req.param('id')
    const { body, role, model } = await c.req.json()
    const session = await prStore.get()
    if (!session) return notInPrMode(c)
    const comments = (session.comments ?? []).map((cm) => {
      if (cm.id !== id) return cm
      const reply = {
        id: crypto.randomUUID(),
        body,
        createdAt: Date.now(),
        role: role || (model ? 'agent' : 'user'),
        model: model || undefined,
      }
      return { ...cm, replies: [...(cm.replies ?? []), reply] }
    })
    await prStore.set({ ...session, comments })
    return c.json(comments.find((cm) => cm.id === id))
  })

  /** Submit the current PR session's review (new comments + verdict + body) to GitHub. */
  app.post('/api/gh/submit', async (c) => {
    if (!prMode) return notInPrMode(c)
    const session = await prStore.get()
    if (!session) return notInPrMode(c)
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const decision = body.decision
    if (decision !== 'approve' && decision !== 'comment' && decision !== 'request-changes') {
      return c.json({ error: 'decision must be one of: approve, comment, request-changes' }, 400)
    }
    const generalBody = typeof body.body === 'string' ? body.body : ''
    const dryRun = body.dryRun === true

    const result = await githubSubmitReview({
      resolved: {
        owner: session.owner,
        repo: session.repo,
        pullNumber: session.pullNumber,
        ref: session.ref,
      },
      decision: decision as PrDecision,
      body: generalBody,
      comments: session.comments ?? [],
    })

    if (result.ok && !dryRun) {
      const next = {
        ...session,
        submittedAt: Date.now(),
        submittedReviewId: result.reviewId,
        submittedReviewUrl: result.reviewUrl,
        authSource: result.authSource,
      }
      await prStore.set(next)
    }

    return c.json({
      ok: result.ok,
      reviewId: result.reviewId,
      reviewUrl: result.reviewUrl,
      failedComments: result.failedComments ?? 0,
      authSource: result.authSource,
      error: result.error,
      dryRun,
    })
  })

  // ── Agent handoff: "agent waits, human releases" ──────────────────────────
  // The UI's "Send to agent" button POSTs here. We snapshot the current
  // comments, format them, and release every agent blocked on /api/review/await.
  app.post('/api/review/send', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const generalComment =
      typeof body?.generalComment === 'string' ? body.generalComment : undefined
    const decision =
      body?.decision === 'approved' || body?.decision === 'changes-requested' || body?.decision === 'rejected' || body?.decision === 'comment-only'
        ? (body.decision as ReviewDecision)
        : undefined
    const mode =
      body?.mode === 'comment-only' || body?.mode === 'standard'
        ? (body.mode as ReviewMode)
        : 'standard'
    const all = await store.getAll()
    const openCount = all.filter((x) => x.status === 'open').length
    const payload = reviewSession.send({
      sentAt: Date.now(),
      commentXml: formatComments(all, generalComment, decision, mode),
      openCount,
      comments: all,
      decision,
      mode,
    })
    return c.json({
      ok: true,
      round: payload.round,
      openCount: payload.openCount,
      decision: payload.decision,
      mode: payload.mode,
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

  // ── Plan review ───────────────────────────────────────────────────────────
  // The same shape as the comment review, but for markdown plans an agent
  // submits before doing work. Reads/writes go through the plan store (backed by
  // plans.json, watched for live broadcasts), and the verdict is handed off via
  // the PlanReviewSession.
  app.get('/api/plans', async (c) => {
    return c.json(await plans.getAll())
  })

  app.get('/api/plans/:id', async (c) => {
    const plan = await plans.get(c.req.param('id'))
    if (!plan) return c.json({ error: 'Plan not found' }, 404)
    return c.json(plan)
  })

  // List every historical version of a plan, oldest-first. Each entry
  // carries the body+title snapshot that was live at that version, so a
  // reviewer can browse what the agent submitted in v1, v2, …
  app.get('/api/plans/:id/versions', async (c) => {
    const plan = await plans.get(c.req.param('id'))
    if (!plan) return c.json({ error: 'Plan not found' }, 404)
    return c.json(plan.versions ?? [])
  })

  // Return a single historical version's body (and title). The current
  // version is included — callers can pass `n = plan.version` and get the
  // same payload as a "show current" call.
  app.get('/api/plans/:id/versions/:n', async (c) => {
    const id = c.req.param('id')
    const n = Number(c.req.param('n'))
    if (!Number.isFinite(n) || n < 1) {
      return c.json({ error: 'version must be a positive integer' }, 400)
    }
    const plan = await plans.get(id)
    if (!plan) return c.json({ error: 'Plan not found' }, 404)
    const version = (plan.versions ?? []).find((v) => v.version === n)
    if (!version) return c.json({ error: `Version ${n} not found` }, 404)
    return c.json({
      version,
      plan: {
        id: plan.id,
        title: plan.title,
        decision: plan.decision,
        currentVersion: plan.version,
      },
    })
  })

  app.post('/api/plans', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    if (typeof body.body !== 'string' || !body.body.trim()) {
      return c.json({ error: 'A plan body (markdown) is required' }, 400)
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled plan'
    const plan = await plans.upsert({
      id: typeof body.id === 'string' && body.id ? body.id : undefined,
      title,
      body: body.body,
      source: typeof body.source === 'string' ? body.source : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
    })
    return c.json(plan, 201)
  })

  app.put('/api/plans/:id', async (c) => {
    const id = c.req.param('id')
    const { title, body, source, model } = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const updated = await plans.update(id, {
      title: typeof title === 'string' ? title : undefined,
      body: typeof body === 'string' ? body : undefined,
      source: typeof source === 'string' ? source : undefined,
      model: typeof model === 'string' ? model : undefined,
    })
    if (!updated) return c.json({ error: 'Plan not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/plans/:id', async (c) => {
    const removed = await plans.remove(c.req.param('id'))
    if (!removed) return c.json({ error: 'Plan not found' }, 404)
    return c.json({ ok: true })
  })

  app.post('/api/plans/:id/comments', async (c) => {
    const planId = c.req.param('id')
    const plan = await plans.get(planId)
    if (!plan) return c.json({ error: 'Plan not found' }, 404)
    const body = await c.req.json()
    const lineNumber = Number.isFinite(body.lineNumber) ? Number(body.lineNumber) : 0
    const startLineNumber = Number.isFinite(body.startLineNumber) ? Number(body.startLineNumber) : undefined
    const anchorStart = startLineNumber ?? lineNumber
    const lineContent =
      typeof body.lineContent === 'string' && body.lineContent
        ? body.lineContent
        : lineNumber > 0
          ? extractPlanLines(plan.body, anchorStart, lineNumber)
          : ''
    const sectionTitle =
      typeof body.sectionTitle === 'string' && body.sectionTitle
        ? body.sectionTitle
        : lineNumber > 0
          ? sectionTitleForLine(plan.body, anchorStart)
          : undefined
    // Stamp the version the comment is anchored to. The client may pass an
    // explicit value (e.g. when commenting on a historical version in the
    // viewer), but the server's value is authoritative.
    const createdAtPlanVersion =
      Number.isFinite(body.createdAtPlanVersion) ? Number(body.createdAtPlanVersion) : plan.version
    const comment = {
      id: crypto.randomUUID(),
      lineNumber,
      startLineNumber,
      lineContent,
      sectionTitle,
      body: body.body,
      status: 'open' as const,
      createdAt: Date.now(),
      createdAtPlanVersion,
      replies: [],
    }
    const updated = await plans.addComment(planId, comment)
    if (!updated) return c.json({ error: 'Plan not found' }, 404)
    return c.json(updated, 201)
  })

  app.put('/api/plans/:id/comments/:commentId', async (c) => {
    const { body, status } = await c.req.json()
    const updated = await plans.updateComment(c.req.param('id'), c.req.param('commentId'), { body, status })
    if (!updated) return c.json({ error: 'Plan or comment not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/plans/:id/comments/:commentId', async (c) => {
    const updated = await plans.removeComment(c.req.param('id'), c.req.param('commentId'))
    if (!updated) return c.json({ error: 'Plan or comment not found' }, 404)
    return c.json(updated)
  })

  app.post('/api/plans/:id/comments/:commentId/replies', async (c) => {
    const { body, role, model } = await c.req.json()
    const reply = {
      id: crypto.randomUUID(),
      body,
      createdAt: Date.now(),
      role: role || (model ? 'agent' : 'user'),
      model: model || undefined,
    }
    const updated = await plans.addReply(c.req.param('id'), c.req.param('commentId'), reply)
    if (!updated) return c.json({ error: 'Plan or comment not found' }, 404)
    return c.json(updated)
  })

  app.put('/api/plans/:id/comments/:commentId/replies/:replyId', async (c) => {
    const { body } = await c.req.json()
    if (!body) return c.json({ error: 'Body is required' }, 400)
    const updated = await plans.updateReply(c.req.param('id'), c.req.param('commentId'), c.req.param('replyId'), body)
    if (!updated) return c.json({ error: 'Plan, comment, or reply not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/plans/:id/comments/:commentId/replies/:replyId', async (c) => {
    const updated = await plans.removeReply(c.req.param('id'), c.req.param('commentId'), c.req.param('replyId'))
    if (!updated) return c.json({ error: 'Plan, comment, or reply not found' }, 404)
    return c.json(updated)
  })

  // The human's verdict. Persists the decision on the plan AND releases every
  // agent blocked on /api/plan-review/await with the full review payload.
  app.post('/api/plans/:id/decision', async (c) => {
    const planId = c.req.param('id')
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const decision = body.decision as PlanDecision
    if (decision !== 'approved' && decision !== 'rejected' && decision !== 'changes-requested' && decision !== 'comment-only') {
      return c.json({ error: 'decision must be one of: approved, rejected, changes-requested, comment-only' }, 400)
    }
    const decisionComment = typeof body.decisionComment === 'string' ? body.decisionComment : undefined
    const mode =
      body?.mode === 'comment-only' || body?.mode === 'standard'
        ? (body.mode as PlanMode)
        : 'standard'
    const plan = await plans.setDecision(planId, decision, decisionComment)
    if (!plan) return c.json({ error: 'Plan not found' }, 404)

    const openCommentCount = (plan.comments ?? []).filter((x) => x.status === 'open').length
    const payload = planReviewSession.decide({
      sentAt: Date.now(),
      planId,
      decision,
      decisionComment: plan.decisionComment,
      reviewXml: formatPlanReview(plan, { mode }),
      openCommentCount,
      plan,
      mode,
    })
    return c.json({
      ok: true,
      round: payload.round,
      decision,
      mode: payload.mode,
      openCommentCount,
      waiters: planReviewSession.snapshot().waiters,
    })
  })

  app.get('/api/plan-review/await', async (c) => {
    const sinceRaw = c.req.query('sinceRound')
    const sinceRound = sinceRaw !== undefined && sinceRaw !== '' ? Number(sinceRaw) : undefined
    const requested = Number(c.req.query('timeoutMs')) || 25000
    const timeoutMs = Math.min(Math.max(requested, 1000), 50000)
    const result = await planReviewSession.await({
      sinceRound: Number.isNaN(sinceRound as number) ? undefined : sinceRound,
      timeoutMs,
      signal: c.req.raw.signal,
    })
    return c.json(result)
  })

  app.get('/api/plan-review/status', (c) => {
    return c.json(planReviewSession.snapshot())
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

/**
 * Newest mtime (epoch ms) across everything that counts as project activity:
 * comments.json, plans.json, and any attachment (media) file. Plans and media
 * extend a project's life exactly like comments do, so retention is uniform
 * across all three. Returns null when none of them exist yet.
 */
async function newestActivityMs(projectDir: string): Promise<number | null> {
  const candidates: number[] = []
  const safeStat = async (p: string): Promise<number | null> => {
    try {
      return (await stat(p)).mtimeMs
    } catch {
      return null
    }
  }

  for (const name of ['comments.json', 'plans.json', 'pr-session.json']) {
    const file = join(projectDir, name)
    if (!existsSync(file)) continue
    const m = await safeStat(file)
    if (m !== null) candidates.push(m)
  }

  const attachmentsDir = join(projectDir, 'attachments')
  if (existsSync(attachmentsDir)) {
    const dirM = await safeStat(attachmentsDir)
    if (dirM !== null) candidates.push(dirM)
    try {
      for (const file of await readdir(attachmentsDir)) {
        const m = await safeStat(join(attachmentsDir, file))
        if (m !== null) candidates.push(m)
      }
    } catch {
      // unreadable attachments dir — fall back to whatever we already have
    }
  }

  return candidates.length ? Math.max(...candidates) : null
}

export async function cleanupStaleProjects(): Promise<void> {
  const baseDir = join(homedir(), '.diffing')
  if (!existsSync(baseDir)) return

  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    const now = Date.now()
    const STALE_TIME = 14 * 24 * 60 * 60 * 1000

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectDir = join(baseDir, entry.name)
        const repoPathFile = join(projectDir, 'repo_path.txt')

        let shouldDelete = false

        // Dead project: the repository it mirrored no longer exists on disk.
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

        // Stale project: nothing — comments, plans, or media — has been
        // touched within STALE_TIME. Plans live for the same span as comments
        // and attachments, so the freshest of the three keeps the dir alive.
        if (!shouldDelete) {
          const newest = await newestActivityMs(projectDir)
          if (newest !== null && now - newest > STALE_TIME) {
            shouldDelete = true
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

export async function startServer(options: {
  port: number
  host: string
  clientDir: string
  diffOpts?: DiffOptions
  /**
   * If set, the server builds a `pr-session.json` from this ref on startup so
   * the web UI opens in PR mode. The session is persisted in the per-repo
   * storage dir; if it already exists, the diff is NOT re-fetched (use the
   * `POST /api/gh/pr/refresh` endpoint to re-fetch).
   */
  prRef?: string
}): Promise<{ port: number; prMode: boolean }> {
  cleanupStaleProjects().catch((err) => {
    console.error('Failed to clean up stale projects:', err)
  })

  // Build the PR session BEFORE creating the Hono app so `createApp` knows
  // whether it should enable the PR routes. `buildPrSession` shells out to
  // `gh` (auth + metadata + diff fetch) and takes a few seconds -- if we
  // fire-and-forget like before, the port-bound callback resolves with
  // `prMode = false` and the lockfile is written as `mode: "web"`. The UI
  // then hits `/api/diff` before the session lands in the store, falls
  // through to the local diff, and shows nothing.
  let prMode = false
  if (options.prRef) {
    console.error(`Building PR session for ${options.prRef}...`)
    try {
      const store = new FilePrSessionStore()
      const existing = await store.get()
      if (!existing || existing.ref !== options.prRef) {
        const session = await buildPrSession(options.prRef)
        await store.set(session)
      }
      prMode = true
    } catch (err: any) {
      console.error(`[pr-session] failed to build session for ${options.prRef}: ${err?.message ?? err}`)
    }
  }

  const app = createApp(options.clientDir, options.diffOpts, undefined, undefined, undefined, prMode)

  return new Promise((resolve) => {
    serve({
      fetch: app.fetch,
      port: options.port,
      hostname: options.host,
    }, (info) => {
      resolve({ port: info.port, prMode })
    })
  })
}
