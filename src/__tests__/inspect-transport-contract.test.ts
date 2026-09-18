// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../server.js'
import { runSubcommand } from '../cli-agent.js'
import { createMcpServer, MCP_VERSION } from '../mcp.js'
import { DEFAULTS } from '../lib/diff-options.js'
import { InMemoryCommentStore } from '../lib/comments.js'
import { InMemoryPlanStore } from '../lib/plans.js'
import { InMemoryPrSessionStore, type PrSession } from '../lib/pr-session.js'
import type { ServerLock } from '../lib/server-lock.js'

const state = vi.hoisted(() => ({ lock: null as ServerLock | null, root: '', home: '' }))
vi.mock('../lib/server-lock.js', async (original) => ({
  ...await original<typeof import('../lib/server-lock.js')>(),
  resolveActiveServerLock: () => state.lock,
}))
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), watch: () => ({ unref() {}, close() {} }) }))
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => state.home }))
vi.mock('../lib/settings.js', () => ({ loadSettings: () => ({ aiLanguageServers: {} }), saveSettings: vi.fn() }))
vi.mock('../lib/git.js', async (original) => ({ ...await original<typeof import('../lib/git.js')>(), getRepoRoot: () => state.root }))

const patch = `diff --git a/one.ts b/one.ts
index 1111111..2222222 100644
--- a/one.ts
+++ b/one.ts
@@ -1,2 +1,3 @@
 one
+one-added
 one-context
@@ -10,2 +11,3 @@
 ten
+ten-added
 ten-context
diff --git a/two.ts b/two.ts
index 3333333..4444444 100644
--- a/two.ts
+++ b/two.ts
@@ -1,2 +1,3 @@
 two
+two-added
 two-context
@@ -20,2 +21,3 @@
 twenty
+twenty-added
 twenty-context
`

function artifact(diff = patch): PrSession {
  return {
    ref: 'owner/repo#1', owner: 'owner', repo: 'repo', pullNumber: 1,
    headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), title: 'fixture', url: 'https://example.test/pr/1',
    author: null, additions: 4, deletions: 0, changedFiles: 2, diff, comments: [], existingComments: [],
  }
}

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'diffing-inspect-contract-'))
  state.home = join(directory, 'home'); mkdirSync(state.home)
  state.root = join(directory, 'repo'); mkdirSync(state.root)
  execFileSync('git', ['init', '-q', state.root])
  state.root = realpathSync(state.root)
  state.lock = { host: '127.0.0.1', port: 43123, mode: 'gh-pr', pid: process.pid, repoRoot: state.root, startedAt: 1, version: MCP_VERSION }
  const prs = new InMemoryPrSessionStore()
  await prs.set(artifact())
  const open = () => createApp(state.root, DEFAULTS, new InMemoryCommentStore(), new InMemoryPlanStore(), prs, true)
  let app = open()
  const fetcher = vi.fn((input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input, init)))
  vi.stubGlobal('fetch', fetcher)
  const server = createMcpServer({ repoRoot: state.root, readLock: () => state.lock, lockIsAlive: () => true, reviewUiIsReachable: () => true })
  const client = new Client({ name: 'inspect-contract', version: '1.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport); await client.connect(clientTransport)
  return {
    prs, fetcher, client, restart: () => { app = open() },
    close: async () => { await client.close(); await server.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

async function cli(operation: string, input: Record<string, string | number>) {
  let output = ''; let error = ''
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((value) => { output += String(value); return true })
  const stderr = vi.spyOn(console, 'error').mockImplementation((...args) => { error += args.join(' ') })
  try {
    const args = Object.entries(input).flatMap(([key, value]) => [`--${key === 'snapshotId' ? 'snapshot-id' : key}`, String(value)])
    const exitCode = await runSubcommand('inspect', [operation, ...args])
    return { failed: exitCode !== 0, body: output ? JSON.parse(output) : error.startsWith('{') ? JSON.parse(error) : null }
  } finally { stdout.mockRestore(); stderr.mockRestore() }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); state.lock = null })

describe('inspect CLI and MCP transport contracts', () => {
  it.each(['cli', 'mcp'] as const)('%s preserves actual retained pages and typed failures through the server', async (transport) => {
    const fixture = await setup()
    try {
      const read = async (operation: string, input: Record<string, string | number>) => {
        if (transport === 'cli') return cli(operation, input)
        const result = await fixture.client.callTool({ name: `diff_${operation}`, arguments: input })
        return { failed: result.isError === true, body: (result.structuredContent as { result?: Record<string, any> } | undefined)?.result }
      }
      const first = await read('files', { limit: 1 })
      expect(first.failed).toBe(false)
      expect(first.body.files.map((file: { path: string }) => file.path)).toEqual(['one.ts'])
      const { snapshotId, nextContinuation } = first.body
      expect(nextContinuation).toEqual(expect.any(String))
      await fixture.prs.set(artifact(patch.replaceAll('two.ts', 'changed.ts')))
      const next = await read('files', { continuation: nextContinuation })
      expect(next.failed).toBe(false)
      expect(next.body.snapshotId).toBe(snapshotId)
      expect(next.body.files.map((file: { path: string }) => file.path)).toEqual(['two.ts'])
      expect(next.body.nextContinuation).toBeNull()
      const [payload, signature] = nextContinuation.split('.')
      const tampered = `${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`
      for (const token of ['bad.token', tampered]) {
        const result = await read('files', { continuation: token })
        expect(result.failed).toBe(true)
        expect(result.body).toMatchObject({ code: 'invalid_continuation', recovery: 'restart_files' })
      }
      const calls = fixture.fetcher.mock.calls.length
      expect((await read('files', { continuation: nextContinuation, path: 'one.ts' })).failed).toBe(true)
      expect(fixture.fetcher).toHaveBeenCalledTimes(calls)
      fixture.restart()
      const expired = await read('files', { continuation: nextContinuation })
      expect(expired.failed).toBe(true)
      expect(expired.body).toMatchObject({ code: 'snapshot_expired', recovery: 'restart_files' })
      for (const operation of ['hunks', 'slice', 'search']) {
        const result = await read(operation, { snapshotId, ...(operation === 'search' ? { query: 'added' } : { file: 0 }) })
        expect(result.failed).toBe(true)
        expect(result.body).toMatchObject({ code: 'snapshot_expired', recovery: 'restart_files' })
      }
    } finally { await fixture.close() }
  })
})
