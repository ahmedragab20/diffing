// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMcpServer, MCP_VERSION } from '../mcp.js'
import { buildGitDiffArgs } from '../lib/diff-options.js'
import type { ServerLock } from '../lib/server-lock.js'

describe('diffing MCP', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'diffing-mcp-repo-'))
    execFileSync('git', ['init', '-q', repoRoot])
    repoRoot = realpathSync(repoRoot)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    rmSync(repoRoot, { recursive: true, force: true })
  })

  async function connect(options: Parameters<typeof createMcpServer>[0]) {
    const server = createMcpServer(options)
    const client = new Client({ name: 'mcp-test', version: '1.0.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    return {
      client,
      close: async () => {
        await client.close()
        await server.close()
      },
    }
  }

  const testLease = () => ({ ownerId: 'test-lease', release: vi.fn() })

  it('advertises the package version, guidance, tools, prompts, and resource', async () => {
    const session = await connect({
      repoRoot,
      readLock: () => null,
      lockIsAlive: () => false,
    })
    try {
      expect(session.client.getServerVersion()).toMatchObject({ name: 'diffing', version: MCP_VERSION })
      expect(session.client.getInstructions()).toContain('First call review_session_status')

      const tools = await session.client.listTools()
      const names = tools.tools.map((tool) => tool.name)
      expect(names).toEqual(expect.arrayContaining([
        'await_review', 'list_comments', 'reply_to_comment', 'resolve_comment',
        'unresolve_comment', 'edit_comment', 'delete_comment', 'apply_suggestion',
        'resolve_all_comments', 'get_review_history', 'report_progress',
        'edit_reply', 'delete_reply',
        'submit_plan', 'await_plan_review', 'list_plans', 'get_plan',
        'get_plan_versions', 'get_plan_version', 'reply_to_plan_comment', 'resolve_plan_comment',
        'review_session_status', 'start_review_session', 'get_diff', 'create_comment',
        'diff_summary', 'diff_files', 'diff_hunks', 'diff_slice', 'diff_search',
        'gh_overview', 'gh_list_threads', 'gh_list_reviews', 'gh_list_draft_comments',
        'gh_create_draft_comment', 'gh_refresh', 'gh_submit_review',
      ]))
      expect(tools.tools.every((tool) => tool.outputSchema && tool.annotations)).toBe(true)
      for (const name of ['await_review', 'await_plan_review']) {
        expect(tools.tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
          readOnlyHint: true,
          idempotentHint: false,
        })
      }

      const prompts = await session.client.listPrompts()
      expect(prompts.prompts.map((prompt) => prompt.name)).toEqual([
        'review_local_changes', 'submit_plan_for_review',
      ])
      const resources = await session.client.listResources()
      expect(resources.resources).toContainEqual(expect.objectContaining({ uri: 'diffing://agent-guide' }))
      const guide = await session.client.readResource({ uri: 'diffing://agent-guide' })
      expect(guide.contents[0]).toMatchObject({ mimeType: 'text/markdown' })
    } finally {
      await session.close()
    }
  })

  it('reports an actionable status when no review server is running', async () => {
    const session = await connect({
      repoRoot,
      readLock: () => null,
      lockIsAlive: () => false,
    })
    try {
      await session.client.listTools()
      const result = await session.client.callTool({ name: 'review_session_status', arguments: {} })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({
        repository: repoRoot,
        serverState: 'not-running',
        mode: 'none',
        url: null,
      })
    } finally {
      await session.close()
    }
  })

  it('starts once and then reuses the same MCP-owned loopback session', async () => {
    let lock: ServerLock | null = null
    const startServerFn = vi.fn(async () => ({ port: 43123, prMode: false }))
    const session = await connect({
      repoRoot,
      startServerFn,
      readLock: () => lock,
      writeLock: (next) => { lock = next },
      lockIsAlive: () => true,
      acquireStartupLease: testLease,
      now: () => 1234,
    })
    try {
      await session.client.listTools()
      const first = await session.client.callTool({
        name: 'start_review_session', arguments: { diffArgs: ['--staged'] },
      })
      const second = await session.client.callTool({
        name: 'start_review_session', arguments: { diffArgs: ['--staged'] },
      })
      expect(first.isError, JSON.stringify(first.content)).not.toBe(true)
      expect(first.structuredContent).toMatchObject({
        status: 'started', url: 'http://127.0.0.1:43123', managedBy: 'mcp',
      })
      expect(second.structuredContent).toMatchObject({ status: 'reused' })
      expect(startServerFn).toHaveBeenCalledTimes(1)
      expect(startServerFn).toHaveBeenCalledWith(expect.objectContaining({
        host: '127.0.0.1',
        diffOpts: expect.objectContaining({
          staged: true,
          noExtDiff: true,
          textconv: false,
          extDiff: undefined,
          outputFormat: undefined,
          outputFile: undefined,
        }),
      }))
      expect(lock).toMatchObject({
        host: '127.0.0.1', owner: 'mcp', diffArgs: ['--staged'], repoRoot,
      })
    } finally {
      await session.close()
    }
  })

  it('gets the active diff and creates an inline comment without raw HTTP', async () => {
    const requests: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (init?.method !== 'POST' && url.endsWith('/api/diff')) {
        return new Response(JSON.stringify({
          patch: 'diff --git a/a.ts b/a.ts\n+hello',
          repoName: 'repo', branch: 'main', customMode: false,
          binaryFiles: [], tabSizeMap: { 'a.ts': 2 }, untrackedFiles: [],
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (init?.method === 'POST' && url.endsWith('/api/comments')) {
        const body = JSON.parse(String(init.body))
        requests.push(body)
        return new Response(JSON.stringify({
          id: 'comment-1', ...body, status: 'open', createdAt: 10, replies: [],
        }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }))
    const lock: ServerLock = {
      port: 43124, host: '127.0.0.1', pid: process.pid, repoRoot,
      startedAt: Date.now(), version: MCP_VERSION, mode: 'web',
    }
    const session = await connect({
      repoRoot,
      readLock: () => lock,
      lockIsAlive: () => true,
    })
    try {
      await session.client.listTools()
      const diff = await session.client.callTool({ name: 'get_diff', arguments: {} })
      expect(diff.structuredContent).toMatchObject({ repoName: 'repo', branch: 'main' })
      expect((diff.content as Array<unknown>)[0]).toMatchObject({
        type: 'text', text: expect.stringContaining('diff --git'),
      })

      const created = await session.client.callTool({
        name: 'create_comment',
        arguments: {
          filePath: 'a.ts', side: 'additions', lineNumber: 1,
          lineContent: 'hello', body: 'Please cover this branch.',
        },
      })
      expect(created.structuredContent).toMatchObject({
        status: 'created', comment: { id: 'comment-1', filePath: 'a.ts' },
      })
      expect(requests).toEqual([expect.objectContaining({ body: 'Please cover this branch.' })])
    } finally {
      await session.close()
    }
  })

  it('exposes slim PR reads and local draft creation in gh-pr mode', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/api/gh/overview')) {
        return new Response(JSON.stringify({
          prMode: true,
          owner: 'acme',
          repo: 'widget',
          pullNumber: 12,
          counts: { unresolvedThreads: 1 },
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/api/gh/threads')) {
        return new Response('<pr-review-threads pr="acme/widget#12" />', {
          headers: { 'Content-Type': 'application/xml' },
        })
      }
      if (init?.method === 'POST' && url.endsWith('/api/gh/pr-session/comments')) {
        const body = JSON.parse(String(init.body))
        return new Response(JSON.stringify({
          id: 'draft-1', ...body, status: 'open', createdAt: 10, replies: [],
        }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)
    const lock: ServerLock = {
      port: 43135,
      host: '127.0.0.1',
      pid: process.pid,
      repoRoot,
      startedAt: Date.now(),
      version: MCP_VERSION,
      mode: 'gh-pr',
      prRef: 'acme/widget#12',
    }
    const session = await connect({
      repoRoot,
      readLock: () => lock,
      lockIsAlive: () => true,
    })
    try {
      const overview = await session.client.callTool({ name: 'gh_overview', arguments: {} })
      expect(overview.isError, JSON.stringify(overview.content)).not.toBe(true)
      expect(overview.structuredContent).toMatchObject({
        result: { owner: 'acme', pullNumber: 12 },
      })

      const threads = await session.client.callTool({
        name: 'gh_list_threads',
        arguments: { unresolvedOnly: true, format: 'xml' },
      })
      expect(threads.isError, JSON.stringify(threads.content)).not.toBe(true)
      expect(threads.structuredContent).toMatchObject({
        result: { format: 'xml', xml: expect.stringContaining('pr-review-threads') },
      })

      const draft = await session.client.callTool({
        name: 'gh_create_draft_comment',
        arguments: {
          filePath: 'src/a.ts',
          side: 'additions',
          lineNumber: 4,
          body: 'Please cover this path.',
          severity: 'blocking',
        },
      })
      expect(draft.isError, JSON.stringify(draft.content)).not.toBe(true)
      expect(draft.structuredContent).toMatchObject({
        comment: { id: 'draft-1', severity: 'blocking' },
      })
    } finally {
      await session.close()
    }
  })

  it('rejects output and runtime arguments before starting and never creates an output file', async () => {
    const outputPath = join(repoRoot, 'attacker-controlled.patch')
    const startServerFn = vi.fn(async () => ({ port: 43125, prMode: false }))
    const session = await connect({
      repoRoot,
      startServerFn,
      readLock: () => null,
      lockIsAlive: () => false,
      acquireStartupLease: testLease,
    })
    try {
      const result = await session.client.callTool({
        name: 'start_review_session',
        arguments: { diffArgs: [`--output=${outputPath}`] },
      })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('Unsafe or unsupported diff argument')
      expect(startServerFn).not.toHaveBeenCalled()
      expect(existsSync(outputPath)).toBe(false)

      const runtime = await session.client.callTool({
        name: 'start_review_session', arguments: { diffArgs: ['--host', '0.0.0.0'] },
      })
      expect(runtime.isError).toBe(true)
      expect(startServerFn).not.toHaveBeenCalled()
    } finally {
      await session.close()
    }
  })

  it('rejects ignored modifiers without a custom anchor', async () => {
    const startServerFn = vi.fn(async () => ({ port: 43125, prMode: false }))
    const session = await connect({
      repoRoot, startServerFn, readLock: () => null, lockIsAlive: () => false,
      acquireStartupLease: testLease,
    })
    try {
      for (const diffArgs of [
        ['--ignore-all-space'], ['--merge'], ['--diff-filter=M'],
        ['--find-renames=50'], ['--unified=7'],
      ]) {
        const result = await session.client.callTool({ name: 'start_review_session', arguments: { diffArgs } })
        expect(result.isError).toBe(true)
        expect(JSON.stringify(result.content)).toContain('require a revision or a pathspec')
      }
      expect(startServerFn).not.toHaveBeenCalled()
    } finally {
      await session.close()
    }
  })

  it('rejects unsupported modifiers and invalid option values before startup', async () => {
    const startServerFn = vi.fn(async () => ({ port: 43133, prMode: false }))
    const session = await connect({
      repoRoot, startServerFn, readLock: () => null, lockIsAlive: () => false,
      acquireStartupLease: testLease,
    })
    const invalidCases = [
      { args: ['--indent-heuristic', 'HEAD'], message: 'Unsafe or unsupported diff argument' },
      { args: ['--patch', 'HEAD'], message: 'Unsafe or unsupported diff argument' },
      { args: ['--no-textconv', 'HEAD'], message: 'Unsafe or unsupported diff argument' },
      { args: ['--diff-algorithm=bogus', 'HEAD'], message: 'Unsupported value' },
      { args: ['--ws-error-highlight=bogus', 'HEAD'], message: 'Unsupported value' },
      { args: ['--ignore-submodules=bogus', 'HEAD'], message: 'Unsupported value' },
      { args: ['--unified=5lines', 'HEAD'], message: 'non-negative integer' },
      { args: ['--inter-hunk-context=-1', 'HEAD'], message: 'non-negative integer' },
      { args: ['--find-renames=101', 'HEAD'], message: 'integer from 0 to 100' },
      { args: ['--break-rewrites=50/101', 'HEAD'], message: 'slash-separated integers' },
      { args: ['--diff-filter=Z', 'HEAD'], message: 'unsupported filter letters' },
      { args: ['--anchored', 'a\0b', 'HEAD'], message: 'must not contain NUL bytes' },
      {
        args: ['-U999999999999999999999999999999', 'HEAD'],
        message: 'requires a safe integer',
      },
    ]
    try {
      for (const { args, message } of invalidCases) {
        const result = await session.client.callTool({
          name: 'start_review_session', arguments: { diffArgs: args },
        })
        expect(result.isError, JSON.stringify({ args, content: result.content })).toBe(true)
        expect(JSON.stringify(result.content)).toContain(message)
      }
      expect(startServerFn).not.toHaveBeenCalled()
    } finally {
      await session.close()
    }
  })

  it('preserves every accepted modifier in the final Git argument array', async () => {
    const startServerFn = vi.fn(async () => ({ port: 43134, prMode: false }))
    const session = await connect({
      repoRoot, startServerFn, readLock: () => null, writeLock: () => {},
      lockIsAlive: () => false, acquireStartupLease: testLease,
    })
    const acceptedCases = [
      { args: ['--diff-algorithm=histogram', 'HEAD'], expected: '--diff-algorithm=histogram' },
      { args: ['--ws-error-highlight=all', 'HEAD'], expected: '--ws-error-highlight=all' },
      { args: ['--ignore-submodules=dirty', 'HEAD'], expected: '--ignore-submodules=dirty' },
      { args: ['--no-indent-heuristic', 'HEAD'], expected: '--no-indent-heuristic' },
      { args: ['--find-renames', '75', 'HEAD'], expected: '-M75' },
      { args: ['-U', '6', 'HEAD'], expected: '--unified=6' },
      { args: ['-Sneedle', 'HEAD'], expected: '-Sneedle' },
      { args: ['--diff-filter=AM', 'HEAD'], expected: '--diff-filter=AM' },
    ]
    try {
      for (const { args, expected } of acceptedCases) {
        const result = await session.client.callTool({
          name: 'start_review_session', arguments: { diffArgs: args },
        })
        expect(result.isError, JSON.stringify({ args, content: result.content })).not.toBe(true)
        const call = startServerFn.mock.calls.at(-1)
        expect(call).toBeDefined()
        expect(buildGitDiffArgs(call![0].diffOpts)).toContain(expected)
      }
      expect(startServerFn).toHaveBeenCalledTimes(acceptedCases.length)
    } finally {
      await session.close()
    }
  })

  it('normalizes separate option values and honors modifiers with revision/path anchors', async () => {
    let lock: ServerLock | null = null
    const startServerFn = vi.fn(async () => ({ port: 43132, prMode: false }))
    const session = await connect({
      repoRoot, startServerFn, readLock: () => lock,
      writeLock: (next) => { lock = next }, lockIsAlive: () => true,
      acquireStartupLease: testLease,
    })
    try {
      const result = await session.client.callTool({
        name: 'start_review_session',
        arguments: { diffArgs: ['--unified', '5', 'HEAD', '--', 'src'] },
      })
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
      const diffOpts = startServerFn.mock.calls[0][0].diffOpts
      expect(diffOpts).toMatchObject({
        unifiedContext: 5, revisions: ['HEAD'], pathspecs: ['src'], noExtDiff: true,
      })
      expect(buildGitDiffArgs(diffOpts)).toEqual(expect.arrayContaining([
        '--unified=5', '--no-ext-diff', 'HEAD', '--', 'src',
      ]))
    } finally {
      await session.close()
    }
  })

  it('serializes same-process starts and rejects a concurrent different scope', async () => {
    let lock: ServerLock | null = null
    let finishStart!: (value: { port: number; prMode: boolean }) => void
    const startServerFn = vi.fn(() => new Promise<{ port: number; prMode: boolean }>((resolve) => {
      finishStart = resolve
    }))
    const session = await connect({
      repoRoot,
      startServerFn,
      readLock: () => lock,
      writeLock: (next) => { lock = next },
      lockIsAlive: () => true,
      acquireStartupLease: testLease,
    })
    try {
      const firstPromise = session.client.callTool({
        name: 'start_review_session', arguments: { diffArgs: ['--staged'] },
      })
      await vi.waitFor(() => expect(startServerFn).toHaveBeenCalledTimes(1))
      const secondPromise = session.client.callTool({
        name: 'start_review_session', arguments: { diffArgs: ['main...HEAD'] },
      })
      finishStart({ port: 43126, prMode: false })
      const [first, second] = await Promise.all([firstPromise, secondPromise])

      expect(first.isError).not.toBe(true)
      expect(second.isError).toBe(true)
      expect(JSON.stringify(second.content)).toContain('different diff scope')
      expect(startServerFn).toHaveBeenCalledTimes(1)
    } finally {
      await session.close()
    }
  })

  it('rechecks the server lock after acquiring the startup lease', async () => {
    const matchingUserLock: ServerLock = {
      port: 43127, host: '127.0.0.1', pid: process.pid, repoRoot,
      startedAt: 10, version: MCP_VERSION, mode: 'web',
    }
    let reads = 0
    const startServerFn = vi.fn(async () => ({ port: 1, prMode: false }))
    const session = await connect({
      repoRoot,
      startServerFn,
      readLock: () => (++reads === 1 ? null : matchingUserLock),
      lockIsAlive: () => true,
      acquireStartupLease: testLease,
    })
    try {
      const result = await session.client.callTool({ name: 'start_review_session', arguments: {} })
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ status: 'reused', managedBy: 'user' })
      expect(startServerFn).not.toHaveBeenCalled()
    } finally {
      await session.close()
    }
  })

  it('refuses foreign MCP-owned and non-loopback sessions', async () => {
    let lock: ServerLock = {
      port: 43128, host: '127.0.0.1', pid: process.pid + 100, repoRoot,
      startedAt: 10, version: MCP_VERSION, mode: 'web', owner: 'mcp', ownerId: 'foreign',
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const startServerFn = vi.fn(async () => ({ port: 1, prMode: false }))
    const session = await connect({
      repoRoot,
      startServerFn,
      readLock: () => lock,
      lockIsAlive: () => true,
      acquireStartupLease: testLease,
    })
    try {
      const foreign = await session.client.callTool({ name: 'start_review_session', arguments: {} })
      expect(foreign.isError).toBe(true)
      expect(JSON.stringify(foreign.content)).toContain('different diffing MCP connection')

      lock = { ...lock, pid: process.pid, ownerId: 'same-pid-other-owner' }
      const samePidForeign = await session.client.callTool({ name: 'start_review_session', arguments: {} })
      expect(samePidForeign.isError).toBe(true)
      expect(JSON.stringify(samePidForeign.content)).toContain('different diffing MCP connection')

      lock = { ...lock, owner: undefined, ownerId: undefined, pid: process.pid, host: '0.0.0.0' }
      const remote = await session.client.callTool({ name: 'get_diff', arguments: {} })
      expect(remote.isError).toBe(true)
      expect(JSON.stringify(remote.content)).toContain('non-loopback host')
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(startServerFn).not.toHaveBeenCalled()
    } finally {
      await session.close()
    }
  })

  it('does not claim success or remove a foreign lock when lock publication fails after bind', async () => {
    let lock: ServerLock | null = null
    const foreign: ServerLock = {
      port: 49999, host: '127.0.0.1', pid: process.pid, repoRoot,
      startedAt: 99, version: MCP_VERSION, mode: 'web',
    }
    const removeLock = vi.fn()
    const session = await connect({
      repoRoot,
      startServerFn: vi.fn(async () => ({ port: 43129, prMode: false })),
      readLock: () => lock,
      writeLock: () => {
        lock = foreign
        throw new Error('disk full')
      },
      removeLock,
      lockIsAlive: () => true,
      acquireStartupLease: testLease,
    })
    try {
      const result = await session.client.callTool({ name: 'start_review_session', arguments: {} })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('No MCP session was claimed')
      expect(removeLock).not.toHaveBeenCalled()
      expect(lock).toBe(foreign)
    } finally {
      await session.close()
    }
  })

  it('parks on plan await timeout instead of urging a silent retry loop', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/api/plan-review/status')) return Response.json({ round: 0 })
      if (url.includes('/api/plan-review/await')) {
        return Response.json({ status: 'timeout', round: 0 })
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    }))
    const lock: ServerLock = {
      port: 43135, host: '127.0.0.1', pid: process.pid, repoRoot,
      startedAt: 1, version: MCP_VERSION, mode: 'web',
    }
    const session = await connect({ repoRoot, readLock: () => lock, lockIsAlive: () => true })
    try {
      const result = await session.client.callTool({
        name: 'await_plan_review', arguments: { timeoutSeconds: 0.001 },
      })
      expect(result.structuredContent).toMatchObject({
        status: 'timeout',
        disposition: 'park',
        round: 0,
      })
      expect(String((result.structuredContent as { nextAction?: string }).nextAction))
        .toMatch(/Do not retry in a silent loop/i)
    } finally {
      await session.close()
    }
  })

  it('keeps the review cursor across a timeout so a between-calls handoff is not missed', async () => {
    let released = false
    let statusCalls = 0
    const awaitUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/api/review/status')) {
        statusCalls += 1
        return Response.json({ round: released ? 1 : 0 })
      }
      if (url.includes('/api/review/await')) {
        awaitUrls.push(url)
        await new Promise((resolve) => setTimeout(resolve, 3))
        return Response.json(released
          ? { status: 'released', payload: {
              round: 1, mode: 'standard', openCount: 0, comments: [],
              decision: 'approved', commentXml: '<code-review-comments />',
            } }
          : { status: 'timeout', round: 0 })
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    }))
    const lock: ServerLock = {
      port: 43130, host: '127.0.0.1', pid: process.pid, repoRoot,
      startedAt: 1, version: MCP_VERSION, mode: 'web',
    }
    const session = await connect({ repoRoot, readLock: () => lock, lockIsAlive: () => true })
    try {
      const timeout = await session.client.callTool({
        name: 'await_review', arguments: { timeoutSeconds: 0.001 },
      })
      expect(timeout.structuredContent).toMatchObject({
        status: 'timeout',
        disposition: 'park',
        round: 0,
      })
      expect(String((timeout.structuredContent as { nextAction?: string }).nextAction)).toMatch(/Park/i)
      released = true
      const handoff = await session.client.callTool({
        name: 'await_review', arguments: { timeoutSeconds: 0.02 },
      })
      expect(handoff.structuredContent).toMatchObject({ status: 'released', round: 1 })
      expect(statusCalls).toBe(1)
      expect(awaitUrls.at(-1)).toContain('sinceRound=0')
    } finally {
      await session.close()
    }
  })

  it('replays the latest cached review on first attachment', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/api/review/status')) return Response.json({ round: 1 })
      if (url.includes('/api/review/await')) {
        expect(url).toContain('sinceRound=0')
        return Response.json({ status: 'released', payload: {
          round: 1, mode: 'standard', openCount: 0, comments: [],
          decision: 'approved', commentXml: '<code-review-comments />',
        } })
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    }))
    const lock: ServerLock = {
      port: 43133, host: '127.0.0.1', pid: process.pid, repoRoot,
      startedAt: 1, version: MCP_VERSION, mode: 'web',
    }
    const session = await connect({ repoRoot, readLock: () => lock, lockIsAlive: () => true })
    try {
      const result = await session.client.callTool({ name: 'await_review', arguments: { timeoutSeconds: 0.1 } })
      expect(result.structuredContent).toMatchObject({ status: 'released', round: 1 })
    } finally {
      await session.close()
    }
  })

  it('replays the latest cached plan verdict without a preceding submit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/api/plan-review/status')) return Response.json({ round: 1 })
      if (url.includes('/api/plan-review/await')) {
        expect(url).toContain('sinceRound=0')
        return Response.json({ status: 'released', payload: {
          round: 1, mode: 'standard', planId: 'p1', decision: 'approved',
          openCommentCount: 0, plan: { id: 'p1' }, reviewXml: '<plan-review />',
        } })
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    }))
    const lock: ServerLock = {
      port: 43134, host: '127.0.0.1', pid: process.pid, repoRoot,
      startedAt: 1, version: MCP_VERSION, mode: 'web',
    }
    const session = await connect({ repoRoot, readLock: () => lock, lockIsAlive: () => true })
    try {
      const result = await session.client.callTool({ name: 'await_plan_review', arguments: { timeoutSeconds: 0.1 } })
      expect(result.structuredContent).toMatchObject({ status: 'released', decision: 'approved', round: 1 })
    } finally {
      await session.close()
    }
  })

  it('rejects local MCP tools for GitHub PR mode and TUI locks without a loopback port', async () => {
    let lock: ServerLock = {
      port: 43135, host: '127.0.0.1', pid: process.pid, repoRoot,
      startedAt: 1, version: MCP_VERSION, mode: 'gh-pr',
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const session = await connect({ repoRoot, readLock: () => lock, lockIsAlive: () => true })
    try {
      lock = { ...lock, mode: 'gh-pr', port: 43135 }
      const prResult = await session.client.callTool({ name: 'get_diff', arguments: {} })
      expect(prResult.isError).toBe(true)
      expect(JSON.stringify(prResult.content)).toContain('GitHub PR review')

      // TUI with no HTTP port cannot serve loopback review tools.
      lock = { ...lock, mode: 'tui', port: 0 }
      const tuiResult = await session.client.callTool({ name: 'get_diff', arguments: {} })
      expect(tuiResult.isError).toBe(true)
      expect(JSON.stringify(tuiResult.content)).toMatch(/loopback API|TUI/i)

      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      await session.close()
    }
  })

  it('captures the plan cursor before submit and returns a fast comment-only verdict', async () => {
    const events: string[] = []
    let statusCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/api/plan-review/status')) {
        events.push('status')
        statusCalls += 1
        return Response.json({ round: 4 })
      }
      if (url.endsWith('/api/plans') && init?.method === 'POST') {
        events.push('submit')
        return Response.json({ id: 'plan-1', version: 1, title: 'Plan', body: '# Plan', comments: [] })
      }
      if (url.includes('/api/plan-review/await')) {
        events.push('await')
        expect(url).toContain('sinceRound=4')
        return Response.json({ status: 'released', payload: {
          round: 5,
          mode: 'comment-only',
          planId: 'plan-1',
          decision: 'comment-only',
          decisionComment: 'Discuss only',
          openCommentCount: 0,
          plan: { id: 'plan-1' },
          reviewXml: '<plan-review />',
        } })
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    }))
    const lock: ServerLock = {
      port: 43131, host: '127.0.0.1', pid: process.pid, repoRoot,
      startedAt: 1, version: MCP_VERSION, mode: 'web',
    }
    const session = await connect({ repoRoot, readLock: () => lock, lockIsAlive: () => true })
    try {
      const submitted = await session.client.callTool({
        name: 'submit_plan', arguments: { body: '# Plan' },
      })
      expect(submitted.isError, JSON.stringify(submitted.content)).not.toBe(true)
      expect(submitted.structuredContent).toMatchObject({
        status: 'submitted',
        planId: 'plan-1',
        nextAction: expect.stringMatching(/async handoff/i),
      })
      const verdict = await session.client.callTool({
        name: 'await_plan_review', arguments: { timeoutSeconds: 0.1 },
      })
      expect(verdict.isError, JSON.stringify(verdict.content)).not.toBe(true)
      expect(verdict.structuredContent).toMatchObject({
        status: 'released', mode: 'comment-only', decision: 'comment-only', round: 5,
      })
      expect(events).toEqual(['status', 'submit', 'await'])
      expect(statusCalls).toBe(1)
    } finally {
      await session.close()
    }
  })
})
