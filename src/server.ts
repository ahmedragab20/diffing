import { readFile, writeFile } from 'node:fs/promises'
import { join, extname, resolve, basename } from 'node:path'
import { watch } from 'node:fs'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { getFileContent, isImageFile, getTabSizeForFiles, getGitDiffAsync, getCustomGitDiffAsync, getRepoRootAsync, getBranchNameAsync, getUntrackedFilePathsAsync, getRepoRoot } from './git.js'
import { loadSettings, saveSettings } from './settings.js'
import { InMemoryCommentStore, FileCommentStore } from './comments.js'
import type { CommentStore } from './comments.js'
import { isSafePath } from './path.js'

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

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

function parseFilePaths(patch: string): string[] {
  const paths = new Set<string>()
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/)
    if (match) paths.add(match[1])
  }
  return [...paths]
}

function parseBinaryFiles(patch: string, untrackedFiles?: Set<string>): BinaryFileInfo[] {
  const binaryFiles: BinaryFileInfo[] = []
  const lines = patch.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('Binary files ') || !line.includes(' differ')) continue

    // Find the file path from the preceding diff --git line
    let filePath = ''
    for (let j = i - 1; j >= 0; j--) {
      const match = lines[j].match(/^diff --git a\/.+ b\/(.+)$/)
      if (match) {
        filePath = match[1]
        break
      }
    }
    if (!filePath) continue

    // Determine change type from surrounding lines
    let changeType: BinaryFileInfo['type'] = 'changed'
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].startsWith('diff --git')) break
      if (lines[j].startsWith('new file mode')) {
        changeType = 'added'
        break
      }
      if (lines[j].startsWith('deleted file mode')) {
        changeType = 'deleted'
        break
      }
    }

    if (changeType === 'added' && untrackedFiles?.has(filePath)) {
      changeType = 'untracked'
    }
    binaryFiles.push({ path: filePath, type: changeType })
  }
  return binaryFiles
}

export function createApp(clientDir: string, customDiffArgs?: string[], commentStore?: CommentStore) {
  const app = new Hono()
  const isCustomMode = !!customDiffArgs
  const store = commentStore ?? new FileCommentStore()
  const viewedFiles = new Set<string>()

  const activeClients = new Set<(event: string, data: string) => void>()

  // Watch git repository root for changes to trigger live reloads
  let repoRoot: string
  try {
    repoRoot = getRepoRoot()
  } catch {
    repoRoot = process.cwd()
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
        debounceTimeout = setTimeout(() => {
          for (const sendUpdate of activeClients) {
            try {
              sendUpdate('change', Date.now().toString())
            } catch {
              // Client will be cleaned up on next interval or abort
            }
          }
        }, 200)
      }
    })
    watcher.unref()
  } catch (err) {
    console.warn('Failed to initialize repository watcher:', err)
  }

  app.get('/api/live', async (c) => {
    return streamSSE(c, async (stream) => {
      const sendUpdate = (event: string, data: string) => {
        stream.writeSSE({
          event,
          data,
        })
      }
      activeClients.add(sendUpdate)

      const heartbeatInterval = setInterval(() => {
        try {
          stream.writeSSE({
            event: 'heartbeat',
            data: Date.now().toString(),
          })
        } catch {
          clearInterval(heartbeatInterval)
          activeClients.delete(sendUpdate)
        }
      }, 30000)

      stream.onAbort(() => {
        clearInterval(heartbeatInterval)
        activeClients.delete(sendUpdate)
      })
    })
  })

  app.get('/api/diff', async (c) => {
    const staged = c.req.query('staged') === 'true'
    const untracked = c.req.query('untracked') === 'true'

    const patchPromise = isCustomMode
      ? getCustomGitDiffAsync(customDiffArgs)
      : getGitDiffAsync({ staged, untracked })

    const repoNamePromise = getRepoRootAsync().then((root) => basename(root))
    const branchPromise = getBranchNameAsync()
    const untrackedFilesPromise = untracked ? getUntrackedFilePathsAsync() : Promise.resolve([])

    const [patch, repoName, branch, untrackedFiles] = await Promise.all([
      patchPromise,
      repoNamePromise,
      branchPromise,
      untrackedFilesPromise,
    ])

    const untrackedSet = new Set(untrackedFiles)
    const binaryFiles = parseBinaryFiles(patch, untrackedSet)
    const filePaths = parseFilePaths(patch)
    const tabSizeMap = getTabSizeForFiles(filePaths)
    return c.json({ patch, repoName, branch, customMode: isCustomMode, binaryFiles, tabSizeMap, untrackedFiles })
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
    const { body } = await c.req.json()
    const reply = {
      id: crypto.randomUUID(),
      body,
      createdAt: Date.now(),
    }
    const updated = await store.addReply(commentId, reply)
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
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

      // Replace target line with suggestion
      lines[lineIdx] = suggestion.trimEnd()
      const newContent = lines.join('\n')
      await writeFile(absolutePath, newContent, 'utf-8')

      // Mark comment as resolved after applying suggestion
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

export function startServer(options: {
  port: number
  host: string
  clientDir: string
  customDiffArgs?: string[]
}): Promise<{ port: number }> {
  const app = createApp(options.clientDir, options.customDiffArgs)

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
