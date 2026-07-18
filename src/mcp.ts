import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { formatComments } from './lib/comment-format.js'
import { buildGitDiffArgs, parseDiffOptions } from './lib/diff-options.js'
import { formatPlanReview } from './lib/plan-format.js'
import {
  diffScopeKey,
  acquireServerStartupLease,
  isLockAlive,
  readServerLock,
  removeServerLock,
  removeServerLockIfOwned,
  writeServerLock,
  type ServerLock,
  type ServerStartupLease,
} from './lib/server-lock.js'
import { startServer } from './server.js'
import type { Plan } from './lib/plan-types.js'
import type { ReviewComment } from './lib/types.js'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

function readPackageVersion(): string {
  const packagePath = resolve(moduleDirectory, '..', 'package.json')
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version?: unknown }
  if (typeof pkg.version !== 'string' || !pkg.version) {
    throw new Error(`Invalid package version in ${packagePath}`)
  }
  return pkg.version
}

export const MCP_VERSION = readPackageVersion()

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const MUTATING = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

const IDEMPOTENT_MUTATION = { ...MUTATING, idempotentHint: true } as const

const AWAIT = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

const commentSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  side: z.enum(['deletions', 'additions']),
  lineNumber: z.number(),
  startLineNumber: z.number().optional(),
  lineContent: z.string(),
  body: z.string(),
  status: z.enum(['open', 'resolved']),
  createdAt: z.number(),
  /** Optional triage label; omitted / none = untriaged. Emitted on agent handoff XML. */
  severity: z.enum(['blocking', 'nit', 'question', 'praise', 'none']).optional(),
  replies: z.array(z.object({
    id: z.string(),
    body: z.string(),
    createdAt: z.number(),
    role: z.enum(['user', 'agent']).optional(),
    model: z.string().optional(),
    createdAtPlanVersion: z.number().optional(),
  })),
})

function textResult(text: string, structuredContent: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text }], structuredContent }
}

/** Resolve and validate an immutable repository binding without invoking a shell. */
export function resolveMcpRepository(repoPath = process.cwd(), explicit = false): string {
  if (explicit && !isAbsolute(repoPath)) {
    throw new Error('diffing mcp: --repo must be an absolute path')
  }

  let candidate: string
  try {
    candidate = realpathSync(repoPath)
    if (!statSync(candidate).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new Error(`diffing mcp: repository path is not an accessible directory: ${repoPath}`)
  }

  try {
    return execFileSync('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    throw new Error(`diffing mcp: path is not inside a Git repository: ${candidate}`)
  }
}

interface DiffResponse {
  patch: string
  repoName: string
  branch: string
  customMode: boolean
  binaryFiles: Array<{ path: string; type: 'added' | 'deleted' | 'changed' | 'untracked' }>
  tabSizeMap: Record<string, number>
  untrackedFiles: string[]
  showMode?: boolean
  commits?: unknown[]
  truncated?: number
}

export interface CreateMcpServerOptions {
  repoRoot: string
  ownerId?: string
  clientDir?: string
  startServerFn?: typeof startServer
  now?: () => number
  readLock?: (repoRoot: string) => ServerLock | null
  writeLock?: (lock: ServerLock) => void
  removeLock?: (repoRoot: string) => void
  lockIsAlive?: (lock: ServerLock, repoRoot: string) => boolean
  acquireStartupLease?: (repoRoot: string, ownerId: string) => ServerStartupLease | null
}

interface SessionStatus {
  repository: string
  serverState: 'running' | 'not-running'
  mode: 'none' | 'web' | 'gh-pr' | 'tui'
  url: string | null
  managedBy: 'mcp' | 'user' | null
  diffArgs: string[]
  nextAction: string
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase()
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true
  const octets = normalized.split('.')
  return octets.length === 4 && octets[0] === '127' && octets.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

function lockUrl(lock: ServerLock): string | null {
  if (lock.port <= 0) return null
  if (!isLoopbackHost(lock.host)) return null
  const host = lock.host === '::1' ? '[::1]' : lock.host
  return `http://${host}:${lock.port}`
}

async function requestJson<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, init)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request to ${path} was cancelled. Retry the MCP tool when ready.`)
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Cannot reach the diffing review server at ${base}: ${detail}. ` +
      'Call review_session_status, then start_review_session if needed.',
    )
  }

  const raw = await response.text()
  if (!response.ok) {
    let detail = raw.trim()
    try {
      const parsed = JSON.parse(raw) as { error?: unknown }
      if (typeof parsed.error === 'string') detail = parsed.error
    } catch {
      // Preserve the response body when it is not JSON.
    }
    throw new Error(
      `diffing server rejected ${init?.method ?? 'GET'} ${path} with HTTP ${response.status}` +
      (detail ? `: ${detail}` : '') + '.',
    )
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`diffing server returned malformed JSON for ${path}. Check that client and server versions match.`)
  }
}

function sameScope(lock: ServerLock, requestedScope: string, requestedArgs: string[]): boolean {
  if (lock.scope) return lock.scope === requestedScope
  // Locks written by older diffing versions had no scope metadata. Reuse only
  // for the default request; a non-default request must never silently inherit
  // an unknown scope.
  return requestedArgs.length === 0
}

const SAFE_MCP_BOOLEAN_DIFF_ARGS = new Set([
  '--staged', '--cached', '--merge', '--no-indent-heuristic',
  '--ignore-space-change', '--ignore-all-space', '--ignore-blank-lines', '--ignore-cr-at-eol',
  '--function-context', '--find-copies-harder', '--pickaxe-all', '--no-ext-diff',
  '-b', '-w', '-W',
])

const SAFE_MCP_VALUE_DIFF_ARGS = new Set([
  '--diff-algorithm', '--anchored', '--ws-error-highlight', '--unified', '--inter-hunk-context',
  '--find-copies', '--find-renames', '--break-rewrites', '--diff-filter', '--ignore-submodules',
  '-U', '-C', '-M', '-B', '-S', '-G',
])

const SAFE_MCP_ENUM_VALUES: Record<string, ReadonlySet<string>> = {
  '--diff-algorithm': new Set(['minimal', 'patience', 'histogram', 'myers']),
  '--ws-error-highlight': new Set(['none', 'default', 'all']),
  '--ignore-submodules': new Set(['none', 'untracked', 'dirty', 'all']),
}

const MAX_MCP_CONTEXT_LINES = 100_000

function boundedMcpInteger(name: string, value: string, maximum: number): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} requires a non-negative integer, received ${JSON.stringify(value)}.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(
      `${name} requires a safe integer from 0 to ${maximum}, received ${JSON.stringify(value)}.`,
    )
  }
  return parsed
}

function validateMcpDiffValue(name: string, value: string): void {
  if (value.includes('\0')) throw new Error(`Value for ${name} must not contain NUL bytes.`)
  const allowed = SAFE_MCP_ENUM_VALUES[name]
  if (allowed && !allowed.has(value)) {
    throw new Error(`Unsupported value ${JSON.stringify(value)} for ${name}. Expected one of: ${[...allowed].join(', ')}.`)
  }
  if (name === '--unified' || name === '--inter-hunk-context' || name === '-U') {
    boundedMcpInteger(name, value, MAX_MCP_CONTEXT_LINES)
  }
  if (['--find-copies', '--find-renames', '-C', '-M'].includes(name)) {
    boundedMcpInteger(name, value, 100)
  }
  if (name === '--break-rewrites' || name === '-B') {
    const parts = value.split('/')
    const invalidPart = parts.some((part) => {
      if (!/^\d+$/.test(part)) return true
      const parsed = Number(part)
      return !Number.isSafeInteger(parsed) || parsed > 100
    })
    if (parts.length > 2 || invalidPart) {
      throw new Error(`${name} requires one or two slash-separated integers from 0 to 100, received ${JSON.stringify(value)}.`)
    }
  }
  if (name === '--diff-filter' && !/^(?:[ACDMRTUXBacdmrtuxb]+\*?|\*)$/.test(value)) {
    throw new Error(`${name} contains unsupported filter letters: ${JSON.stringify(value)}.`)
  }
}

function attachedShortOption(arg: string): { name: string; value: string } | null {
  const match = /^(-[UCMBGS])(.+)$/.exec(arg)
  return match ? { name: match[1], value: match[2] } : null
}

/** Validate MCP-controlled git arguments before the general CLI parser sees them. */
export function validateMcpDiffArgs(diffArgs: string[]): void {
  let pathsOnly = false
  for (let index = 0; index < diffArgs.length; index += 1) {
    const arg = diffArgs[index]
    if (arg.includes('\0')) throw new Error('diffArgs must not contain NUL bytes.')
    if (pathsOnly) continue
    if (arg === '--') {
      pathsOnly = true
      continue
    }
    if (!arg.startsWith('-')) continue
    if (SAFE_MCP_BOOLEAN_DIFF_ARGS.has(arg)) continue

    const attached = attachedShortOption(arg)
    if (attached) {
      validateMcpDiffValue(attached.name, attached.value)
      continue
    }

    const equals = arg.indexOf('=')
    const name = equals >= 0 ? arg.slice(0, equals) : arg
    if (SAFE_MCP_VALUE_DIFF_ARGS.has(name)) {
      let value: string
      if (equals < 0) {
        value = diffArgs[index + 1]
        if (value === undefined || value === '--' || value.startsWith('-')) {
          throw new Error(`Safe diff option ${name} requires a value.`)
        }
        index += 1
      } else if (arg.slice(equals + 1).length === 0) {
        throw new Error(`Safe diff option ${name} requires a value.`)
      } else {
        value = arg.slice(equals + 1)
      }
      validateMcpDiffValue(name, value)
      continue
    }

    throw new Error(
      `Unsafe or unsupported diff argument ${JSON.stringify(arg)}. ` +
      'start_review_session accepts only revision/path scope, filtering, whitespace, context, and rename-detection options; output, external-driver, and diffing runtime flags are forbidden.',
    )
  }
}

export function normalizeMcpDiffArgs(diffArgs: string[]): string[] {
  const normalized: string[] = []
  let pathsOnly = false
  for (let index = 0; index < diffArgs.length; index += 1) {
    const arg = diffArgs[index]
    if (arg === '--') pathsOnly = true
    if (!pathsOnly && SAFE_MCP_VALUE_DIFF_ARGS.has(arg)) {
      const separator = arg.startsWith('--') ? '=' : ''
      normalized.push(`${arg}${separator}${diffArgs[index + 1]}`)
      index += 1
    } else {
      normalized.push(arg)
    }
  }
  return normalized
}

function expectedBuiltMcpArg(arg: string): string | null {
  const aliases: Record<string, string> = {
    '--cached': '--staged',
    '-b': '--ignore-space-change',
    '-w': '--ignore-all-space',
    '-W': '--function-context',
  }
  if (aliases[arg]) return aliases[arg]

  const attached = attachedShortOption(arg)
  if (attached) {
    const { name, value } = attached
    if (name === '-U') return `--unified=${Number(value)}`
    if (name === '-C') return Number(value) === 40 ? '-C' : `-C${Number(value)}`
    if (name === '-M') return Number(value) === 50 ? '-M' : `-M${Number(value)}`
    return arg
  }

  const equals = arg.indexOf('=')
  if (equals < 0) return SAFE_MCP_BOOLEAN_DIFF_ARGS.has(arg) ? arg : null
  const name = arg.slice(0, equals)
  const value = arg.slice(equals + 1)
  if (name === '--find-copies') return Number(value) === 40 ? '-C' : `-C${Number(value)}`
  if (name === '--find-renames') return Number(value) === 50 ? '-M' : `-M${Number(value)}`
  if (name === '--break-rewrites') return `-B${value}`
  return arg
}

function assertMcpModifiersAreEmitted(normalizedArgs: string[], parsed: ReturnType<typeof parseDiffOptions>): void {
  const builtArgs = buildGitDiffArgs(parsed)
  const separator = normalizedArgs.indexOf('--')
  const scopeArgs = separator < 0 ? normalizedArgs : normalizedArgs.slice(0, separator)
  for (const arg of scopeArgs) {
    if (!arg.startsWith('-')) continue
    const expected = expectedBuiltMcpArg(arg)
    if (expected && !builtArgs.includes(expected)) {
      throw new Error(
        `Unsupported diff argument ${JSON.stringify(arg)}: it is not preserved in the final Git diff arguments.`,
      )
    }
  }
}

function validateMcpModifierAnchoring(diffArgs: string[], parsed: ReturnType<typeof parseDiffOptions>): void {
  if (parsed.revisions.length > 0 || parsed.pathspecs.length > 0) return
  const baseline = new Set(['--staged', '--cached', '--patch', '-p', '--no-ext-diff', '--no-textconv'])
  const modifiers = diffArgs.slice(0, Math.max(0, diffArgs.indexOf('--') === -1 ? diffArgs.length : diffArgs.indexOf('--')))
    .filter((arg) => arg.startsWith('-') && !baseline.has(arg))
  if (modifiers.length > 0) {
    throw new Error(
      `Diff modifiers ${modifiers.map((arg) => JSON.stringify(arg)).join(', ')} require a revision or a pathspec after --. ` +
      'Without that anchor diffing uses its baseline working-tree engine, which cannot honor these modifiers.',
    )
  }
}

interface SessionStartResult extends Record<string, unknown> {
  status: 'started' | 'reused'
  repository: string
  url: string
  mode: 'web'
  managedBy: 'mcp' | 'user'
  diffArgs: string[]
  nextAction: string
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const repoRoot = resolveMcpRepository(options.repoRoot, true)
  const startServerFn = options.startServerFn ?? startServer
  const now = options.now ?? Date.now
  const readLock = options.readLock ?? readServerLock
  const writeLock = options.writeLock ?? writeServerLock
  const removeLock = options.removeLock ?? removeServerLock
  const lockIsAlive = options.lockIsAlive ?? isLockAlive
  const acquireStartupLease = options.acquireStartupLease ?? acquireServerStartupLease
  const ownerId = options.ownerId ?? randomUUID()
  const defaultClientDir = existsSync(resolve(moduleDirectory, 'client'))
    ? resolve(moduleDirectory, 'client')
    : resolve(repoRoot, 'dist/client')
  const clientDir = options.clientDir ?? defaultClientDir

  const instructions = `diffing is bound to ${repoRoot} for this connection. ` +
    'First call review_session_status. If no web session is running, call start_review_session; it is safe to retry and never replaces a user session. ' +
    'For code review, call get_diff, create_comment as needed, then await_review for the human handoff. ' +
    'For plan review, call submit_plan then await_plan_review. A changes-requested verdict means revise and resubmit the same planId; rejected means stop; approved means proceed. ' +
    'Wait tools return released or timeout with a mode; timeout is not failure and the same wait tool may be called again. All networking remains local.'

  const server = new McpServer(
    { name: 'diffing', version: MCP_VERSION },
    { instructions },
  )
  let reviewCursor: { identity: string; round: number } | null = null
  let planCursor: { identity: string; round: number } | null = null

  function liveLock(): ServerLock | null {
    const lock = readLock(repoRoot)
    return lock && lockIsAlive(lock, repoRoot) ? lock : null
  }

  function ensureReusableLock(lock: ServerLock): void {
    if (lock.owner === 'mcp' && (lock.pid !== process.pid || lock.ownerId !== ownerId)) {
      throw new Error(
        `A different diffing MCP connection (${lock.pid}/${lock.ownerId ?? 'legacy'}) owns this repository session. ` +
        'Its web server lifecycle is tied to that MCP connection; stop it or wait for it to exit, then retry.',
      )
    }
    if (!isLoopbackHost(lock.host)) {
      throw new Error(
        `The active diffing session is bound to non-loopback host ${JSON.stringify(lock.host)}. ` +
        'MCP refuses LAN/remote review URLs; end it and call start_review_session for a loopback-only session.',
      )
    }
  }

  function requireWebSession(): { lock: ServerLock; url: string; identity: string } {
    const lock = liveLock()
    if (!lock) {
      throw new Error(
        `No diffing web review session is running for ${repoRoot}. ` +
        'Call start_review_session, then retry this tool.',
      )
    }
    ensureReusableLock(lock)
    const mode = lock.mode ?? 'web'
    if (mode === 'gh-pr') {
      throw new Error(
        'The active diffing session is a GitHub PR review, not a local review.',
      )
    }
    const url = lockUrl(lock)
    if (!url) {
      throw new Error('The active diffing session does not expose a reachable loopback API.')
    }
    return {
      lock,
      url,
      identity: `${lock.pid}:${lock.startedAt}:${lock.port}:${lock.ownerId ?? ''}`,
    }
  }

  function requestSessionJson<T>(
    session: ReturnType<typeof requireWebSession>,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers)
    if (session.lock.mode === 'tui') {
      if (!session.lock.capability) throw new Error('The TUI lock is missing its API capability.')
      headers.set('X-Diffing-Capability', session.lock.capability)
    }
    return requestJson<T>(session.url, path, { ...init, headers })
  }

  function requestBaseJson<T>(path: string, init?: RequestInit): Promise<T> {
    return requestSessionJson<T>(requireWebSession(), path, init)
  }

  function requireTuiSession(): ReturnType<typeof requireWebSession> {
    const session = requireWebSession()
    if (session.lock.mode !== 'tui') {
      throw new Error('This bounded diff-inspection tool requires an active `diffing --tui` session.')
    }
    return session
  }

  async function seedReviewCursor(
    session: ReturnType<typeof requireWebSession>,
    signal?: AbortSignal,
  ): Promise<number> {
    if (reviewCursor?.identity === session.identity) return reviewCursor.round
    const status = await requestSessionJson<{ round?: number }>(session, '/api/review/status', { signal })
    // On first attachment replay the latest cached handoff if one exists.
    reviewCursor = { identity: session.identity, round: Math.max(0, (status.round ?? 0) - 1) }
    return reviewCursor.round
  }

  async function seedPlanCursor(
    session: ReturnType<typeof requireWebSession>,
    signal?: AbortSignal,
    force = false,
  ): Promise<number> {
    if (!force && planCursor?.identity === session.identity) return planCursor.round
    const status = await requestSessionJson<{ round?: number }>(session, '/api/plan-review/status', { signal })
    planCursor = {
      identity: session.identity,
      round: force ? (status.round ?? 0) : Math.max(0, (status.round ?? 0) - 1),
    }
    return planCursor.round
  }

  function sessionStatus(): SessionStatus {
    const lock = liveLock()
    if (!lock) {
      return {
        repository: repoRoot,
        serverState: 'not-running',
        mode: 'none',
        url: null,
        managedBy: null,
        diffArgs: [],
        nextAction: 'Call start_review_session, then get_diff.',
      }
    }
    const mode = lock.mode ?? 'web'
    const url = lockUrl(lock)
    const inaccessible = url === null
    return {
      repository: repoRoot,
      serverState: 'running',
      mode,
      url,
      managedBy: lock.owner === 'mcp' ? 'mcp' : 'user',
      diffArgs: lock.diffArgs ?? [],
      nextAction: inaccessible
        ? 'This session is not loopback-only, so MCP will not connect to it. End it manually and call start_review_session.'
        : mode === 'tui'
        ? 'The native TUI agent API is available; use diff_summary/diff_files/diff_hunks/diff_slice/diff_search or review tools.'
        : mode === 'gh-pr'
          ? 'This is a GitHub PR session; use the GitHub review workflow or start a local session after it ends.'
          : 'Call get_diff to inspect changes, or use a plan-review tool.',
    }
  }

  server.registerTool('review_session_status', {
    title: 'Get review session status',
    description: 'Inspect the repository binding and active diffing session. Works when no web server is running; use its nextAction before other tools.',
    inputSchema: {},
    outputSchema: {
      repository: z.string(),
      serverState: z.enum(['running', 'not-running']),
      mode: z.enum(['none', 'web', 'gh-pr', 'tui']),
      url: z.string().nullable(),
      managedBy: z.enum(['mcp', 'user']).nullable(),
      diffArgs: z.array(z.string()),
      nextAction: z.string(),
    },
    annotations: READ_ONLY,
  }, async () => {
    const status = sessionStatus()
    return textResult(
      status.serverState === 'running'
        ? `diffing ${status.mode} session is running for ${repoRoot}${status.url ? ` at ${status.url}` : ''}. ${status.nextAction}`
        : `No diffing web session is running for ${repoRoot}. ${status.nextAction}`,
      { ...status },
    )
  })

  let startQueue: Promise<void> = Promise.resolve()
  server.registerTool('start_review_session', {
    title: 'Start or reuse a local review session',
    description: 'Idempotently reuse a matching web review session or start a headless loopback-only session on an OS-selected port. Modifiers require a revision or pathspec anchor so the custom engine honors them. Arguments are never passed to a shell; incompatible sessions are reported, never stopped.',
    inputSchema: {
      diffArgs: z.array(z.string()).optional().describe('Optional git-diff arguments, for example ["--staged"] or ["main...HEAD", "--", "src/"].'),
    },
    outputSchema: {
      status: z.enum(['started', 'reused']),
      repository: z.string(),
      url: z.string(),
      mode: z.literal('web'),
      managedBy: z.enum(['mcp', 'user']),
      diffArgs: z.array(z.string()),
      nextAction: z.string(),
    },
    annotations: IDEMPOTENT_MUTATION,
  }, async ({ diffArgs = [] }) => {
    validateMcpDiffArgs(diffArgs)
    const normalizedArgs = normalizeMcpDiffArgs(diffArgs)
    const parsed = parseDiffOptions(normalizedArgs)
    validateMcpModifierAnchoring(diffArgs, parsed)
    // The allowlist preserves line-oriented patches. These assignments are a
    // second invariant at the typed boundary in case the general parser grows
    // new defaults later.
    parsed.outputMode = 'web'
    parsed.host = '127.0.0.1'
    parsed.port = undefined
    parsed.noOpen = true
    parsed.noExtDiff = true
    parsed.textconv = false
    parsed.extDiff = undefined
    // `undefined` is the parser's canonical ordinary unified-patch mode.
    parsed.outputFormat = undefined
    parsed.outputFile = undefined
    parsed.exitCode = false
    parsed.quiet = false
    parsed.check = false
    parsed.binary = false
    assertMcpModifiersAreEmitted(normalizedArgs, parsed)
    const requestedScope = diffScopeKey(parsed)

    const operation = startQueue.then(async (): Promise<SessionStartResult> => {
      const reuse = (existing: ServerLock): SessionStartResult => {
        ensureReusableLock(existing)
        const mode = existing.mode ?? 'web'
        if (mode !== 'web') {
          throw new Error(
            `A live ${mode} diffing session already owns this repository. ` +
            'diffing will not replace or stop it; end that session manually before starting a local web review.',
          )
        }
        if (!sameScope(existing, requestedScope, diffArgs)) {
          throw new Error(
            'A live diffing web session already shows a different diff scope. ' +
            `Requested arguments: ${JSON.stringify(diffArgs)}. ` +
            'Use the existing session or end it manually; diffing will not replace it.',
          )
        }
        const url = lockUrl(existing)
        if (!url) throw new Error('The active diffing web session has no safe loopback URL.')
        return {
          status: 'reused', repository: repoRoot, url, mode: 'web',
          managedBy: existing.owner === 'mcp' ? 'mcp' : 'user',
          diffArgs: existing.diffArgs ?? diffArgs,
          nextAction: 'Call get_diff to inspect the active diff.',
        }
      }

      const beforeLease = liveLock()
      if (beforeLease) return reuse(beforeLease)

      const lease = acquireStartupLease(repoRoot, ownerId)
      if (!lease) {
        throw new Error(
          'Another diffing process is starting a review session for this repository. ' +
          'Retry start_review_session after that startup completes.',
        )
      }

      try {
        // Cross-process race guard: the lease winner must recheck server.json
        // because another process may have completed startup before acquisition.
        const afterLease = liveLock()
        if (afterLease) return reuse(afterLease)

        const started = await startServerFn({
          port: 0,
          host: '127.0.0.1',
          clientDir,
          diffOpts: parsed,
        })
        const lock: ServerLock = {
          port: started.port,
          host: '127.0.0.1',
          pid: process.pid,
          repoRoot,
          startedAt: now(),
          version: MCP_VERSION,
          mode: 'web',
          scope: requestedScope,
          diffArgs: [...diffArgs],
          owner: 'mcp',
          ownerId,
        }
        try {
          writeLock(lock)
        } catch (error) {
          // startServer currently does not expose a close handle. Never report
          // success and never leave a lock claiming ownership. The loopback
          // listener can survive only until this MCP process disconnects.
          const persisted = readLock(repoRoot)
          if (persisted?.owner === 'mcp' && persisted.ownerId === ownerId) {
            removeLock(repoRoot)
          }
          const detail = error instanceof Error ? error.message : String(error)
          throw new Error(
            `The review server bound locally but its discovery lock could not be written: ${detail}. ` +
            'No MCP session was claimed; retry after fixing lock storage. The unadvertised loopback listener will close when this MCP process exits.',
          )
        }
        return {
          status: 'started', repository: repoRoot, url: lockUrl(lock)!, mode: 'web',
          managedBy: 'mcp', diffArgs: [...diffArgs],
          nextAction: 'Call get_diff to inspect the active diff.',
        }
      } finally {
        lease.release()
      }
    })

    startQueue = operation.then(() => undefined, () => undefined)
    const result = await operation
    return textResult(`${result.status === 'started' ? 'Started' : 'Reused'} review session at ${result.url}.`, result)
  })

  server.registerTool('get_diff', {
    title: 'Get the active local diff',
    description: 'Fetch the complete patch and basic repository metadata from the active local web review. Start or locate the session first.',
    inputSchema: {},
    outputSchema: {
      patch: z.string(),
      repoName: z.string(),
      branch: z.string(),
      customMode: z.boolean(),
      binaryFiles: z.array(z.object({
        path: z.string(), type: z.enum(['added', 'deleted', 'changed', 'untracked']),
      })),
      tabSizeMap: z.record(z.string(), z.number()),
      untrackedFiles: z.array(z.string()),
      showMode: z.boolean().optional(),
      commits: z.array(z.unknown()).optional(),
      truncated: z.number().optional(),
    },
    annotations: READ_ONLY,
  }, async () => {
    const diff = await requestBaseJson<DiffResponse>('/api/diff')
    const structured = {
      patch: diff.patch,
      repoName: diff.repoName,
      branch: diff.branch,
      customMode: diff.customMode,
      binaryFiles: diff.binaryFiles,
      tabSizeMap: diff.tabSizeMap,
      untrackedFiles: diff.untrackedFiles,
      ...(typeof diff.showMode === 'boolean' ? { showMode: diff.showMode } : {}),
      ...(Array.isArray(diff.commits) ? { commits: diff.commits } : {}),
      ...(typeof diff.truncated === 'number' ? { truncated: diff.truncated } : {}),
    }
    return textResult(diff.patch || '(The active diff is empty.)', structured)
  })

  server.registerTool('diff_summary', {
    title: 'Summarize the native TUI diff',
    description: 'Return bounded totals and change-kind counts from the TUI sparse index without transferring the patch.',
    inputSchema: {},
    outputSchema: { result: z.unknown() },
    annotations: READ_ONLY,
  }, async () => {
    const session = requireTuiSession()
    const result = await requestSessionJson<Record<string, unknown>>(session, '/api/diff/summary')
    return textResult(JSON.stringify(result), { result })
  })

  server.registerTool('diff_files', {
    title: 'Page changed files from the native TUI',
    description: 'Return a bounded page of changed-file metadata with an opaque numeric continuation cursor.',
    inputSchema: {
      cursor: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(1000).optional(),
    },
    outputSchema: { result: z.unknown() },
    annotations: READ_ONLY,
  }, async ({ cursor = 0, limit = 100 }) => {
    const session = requireTuiSession()
    const result = await requestSessionJson<Record<string, unknown>>(
      session,
      `/api/diff/files?cursor=${cursor}&limit=${limit}`,
    )
    return textResult(JSON.stringify(result), { result })
  })

  server.registerTool('diff_hunks', {
    title: 'Page hunk metadata from the native TUI',
    description: 'Return bounded hunk metadata for one file index. Pass generation from diff_summary to reject stale navigation.',
    inputSchema: {
      file: z.number().int().nonnegative(),
      generation: z.number().int().nonnegative().optional(),
      cursor: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(1000).optional(),
    },
    outputSchema: { result: z.unknown() },
    annotations: READ_ONLY,
  }, async ({ file, generation, cursor = 0, limit = 100 }) => {
    const session = requireTuiSession()
    const query = new URLSearchParams({ file: String(file), cursor: String(cursor), limit: String(limit) })
    if (generation !== undefined) query.set('generation', String(generation))
    const result = await requestSessionJson<Record<string, unknown>>(session, `/api/diff/hunks?${query}`)
    return textResult(JSON.stringify(result), { result })
  })

  server.registerTool('diff_slice', {
    title: 'Read a bounded native TUI diff slice',
    description: 'Read exact logical rows for one file with strict line and byte budgets; use nextRow to continue.',
    inputSchema: {
      file: z.number().int().nonnegative(),
      start: z.number().int().nonnegative().optional(),
      generation: z.number().int().nonnegative().optional(),
      maxLines: z.number().int().positive().max(1000).optional(),
      maxBytes: z.number().int().positive().max(4 * 1024 * 1024).optional(),
    },
    outputSchema: { result: z.unknown() },
    annotations: READ_ONLY,
  }, async ({ file, start = 0, generation, maxLines = 120, maxBytes = 256 * 1024 }) => {
    const session = requireTuiSession()
    const query = new URLSearchParams({
      file: String(file), start: String(start), maxLines: String(maxLines), maxBytes: String(maxBytes),
    })
    if (generation !== undefined) query.set('generation', String(generation))
    const result = await requestSessionJson<Record<string, unknown>>(session, `/api/diff/slice?${query}`)
    return textResult(JSON.stringify(result), { result })
  })

  server.registerTool('diff_search', {
    title: 'Search the native TUI diff',
    description: 'Search changed paths and content with bounded hits/bytes and generation-safe continuation coordinates.',
    inputSchema: {
      query: z.string().min(1),
      generation: z.number().int().nonnegative().optional(),
      file: z.number().int().nonnegative().optional(),
      row: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(1000).optional(),
      maxBytes: z.number().int().positive().max(4 * 1024 * 1024).optional(),
    },
    outputSchema: { result: z.unknown() },
    annotations: READ_ONLY,
  }, async ({ query, generation, file = 0, row = 0, limit = 100, maxBytes = 256 * 1024 }) => {
    const session = requireTuiSession()
    const params = new URLSearchParams({
      q: query, file: String(file), row: String(row), limit: String(limit), maxBytes: String(maxBytes),
    })
    if (generation !== undefined) params.set('generation', String(generation))
    const result = await requestSessionJson<Record<string, unknown>>(session, `/api/diff/search?${params}`)
    return textResult(JSON.stringify(result), { result })
  })

  server.registerTool('create_comment', {
    title: 'Create an inline review comment',
    description:
      'Create a local inline comment on an exact line (or inclusive range) from get_diff. ' +
      'side is additions for +/context in the new file and deletions for a removed line. ' +
      'Optional severity triages the finding for the human and is included in the agent handoff XML.',
    inputSchema: {
      filePath: z.string().min(1).describe('Repository-relative file path exactly as shown in the patch.'),
      side: z.enum(['deletions', 'additions']).describe('Which side of the patch contains the target line.'),
      lineNumber: z.number().int().positive().describe('Target line number on the selected side (bottom of range if multi-line).'),
      startLineNumber: z.number().int().positive().optional().describe('Optional first line for an inclusive multi-line comment.'),
      lineContent: z.string().describe('Target line text (or joined multi-line span), used to preserve context in the review UI.'),
      body: z.string().min(1).describe('Actionable review comment in Markdown.'),
      severity: z
        .enum(['blocking', 'nit', 'question', 'praise', 'none'])
        .optional()
        .describe(
          'Optional triage: blocking = must fix; nit = optional polish; question = needs answer; praise = no change. Omit or none = untriaged.',
        ),
    },
    outputSchema: { status: z.literal('created'), comment: commentSchema },
    annotations: MUTATING,
  }, async (input) => {
    const payload = {
      ...input,
      // Match HTTP/UI: do not persist bare "none".
      severity: input.severity && input.severity !== 'none' ? input.severity : undefined,
    }
    const comment = await requestBaseJson<ReviewComment>('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return textResult(`Created inline comment ${comment.id} on ${comment.filePath}:${comment.lineNumber}.`, {
      status: 'created', comment,
    })
  })

  server.registerTool('await_review', {
    title: 'Wait for code review handoff',
    description: 'Wait for the human to send a code-review round. Returns status=released or status=timeout and always includes mode. Timeout is expected and safe to retry; progress notifications are sent between long polls.',
    inputSchema: {
      timeoutSeconds: z.number().positive().max(3600).optional().describe('Total wait budget in seconds; defaults to 570.'),
    },
    outputSchema: {
      status: z.enum(['released', 'timeout']),
      mode: z.enum(['standard', 'comment-only']),
      round: z.number(),
      openCount: z.number().optional(),
      decision: z.enum(['approved', 'changes-requested', 'rejected', 'comment-only']).optional(),
      comments: z.array(commentSchema).optional(),
      nextAction: z.string(),
    },
    annotations: AWAIT,
  }, async ({ timeoutSeconds }, extra) => {
    const session = requireWebSession()
    const budgetMs = (timeoutSeconds ?? 570) * 1000
    const progressToken = extra?._meta?.progressToken
    let sinceRound = await seedReviewCursor(session, extra?.signal)
    const deadline = Date.now() + budgetMs
    let cycle = 0

    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now())
      const result = await requestSessionJson<any>(
        session,
        `/api/review/await?timeoutMs=${Math.min(25000, remaining)}&sinceRound=${sinceRound}`,
        { signal: extra?.signal },
      )
      if (result.status === 'released') {
        const payload = result.payload
        sinceRound = payload.round
        reviewCursor = { identity: session.identity, round: sinceRound }
        const structured = {
          status: 'released',
          mode: payload.mode ?? 'standard',
          round: payload.round,
          openCount: payload.openCount,
          ...(payload.decision ? { decision: payload.decision } : {}),
          comments: payload.comments,
          nextAction: payload.mode === 'comment-only'
            ? 'Reply to comments without editing files; resolve only comments the human considers addressed.'
            : 'Address open comments, reply with evidence, and resolve completed threads.',
        }
        return textResult(payload.commentXml, structured)
      }
      sinceRound = result.round ?? sinceRound
      reviewCursor = { identity: session.identity, round: sinceRound }
      cycle += 1
      if (progressToken !== undefined) {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: cycle,
            total: Math.max(cycle, Math.ceil(budgetMs / 25000)),
            message: 'Still waiting for a code-review handoff; long poll completed and will retry.',
          },
        }).catch(() => {})
      }
    }
    const structured = {
      status: 'timeout', mode: 'standard', round: sinceRound,
      nextAction: 'No review was sent within the wait budget. Call await_review again to keep waiting.',
    }
    return textResult(structured.nextAction, structured)
  })

  server.registerTool('list_comments', {
    title: 'List code review comments',
    description: 'Fetch code-review comments as XML plus structured data. Use openOnly=true when addressing the current review round.',
    inputSchema: {
      openOnly: z.boolean().optional().describe('Return only unresolved comments when true.'),
    },
    outputSchema: { comments: z.array(commentSchema) },
    annotations: READ_ONLY,
  }, async ({ openOnly }) => {
    const all = await requestBaseJson<ReviewComment[]>('/api/comments')
    const comments = openOnly ? all.filter((comment) => comment.status === 'open') : all
    return textResult(formatComments(comments), { comments })
  })

  server.registerTool('reply_to_comment', {
    title: 'Reply to a code review comment',
    description: 'Post an agent reply to an existing code-review thread. Include concise evidence of the answer or applied change.',
    inputSchema: {
      commentId: z.string().min(1).describe('Comment id from list_comments or await_review.'),
      body: z.string().min(1).describe('Reply body in Markdown.'),
      model: z.string().optional().describe('Optional agent/model identifier shown in the UI.'),
    },
    outputSchema: { status: z.literal('replied'), commentId: z.string() },
    annotations: MUTATING,
  }, async ({ commentId, body, model }) => {
    await requestBaseJson<unknown>(`/api/comments/${encodeURIComponent(commentId)}/replies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, role: 'agent', model }),
    })
    return textResult(`Replied to ${commentId}.`, { status: 'replied', commentId })
  })

  server.registerTool('resolve_comment', {
    title: 'Resolve a code review comment',
    description: 'Mark a code-review thread resolved after its request is fully addressed. Safe to retry.',
    inputSchema: { commentId: z.string().min(1).describe('Comment id to resolve.') },
    outputSchema: { status: z.literal('resolved'), commentId: z.string() },
    annotations: IDEMPOTENT_MUTATION,
  }, async ({ commentId }) => {
    await requestBaseJson<unknown>(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    })
    return textResult(`Resolved ${commentId}.`, { status: 'resolved', commentId })
  })

  server.registerTool('unresolve_comment', {
    title: 'Unresolve a code review comment',
    description: 'Re-open a previously resolved code-review thread. Safe to retry.',
    inputSchema: { commentId: z.string().min(1).describe('Comment id to re-open.') },
    outputSchema: { status: z.literal('open'), commentId: z.string() },
    annotations: IDEMPOTENT_MUTATION,
  }, async ({ commentId }) => {
    await requestBaseJson<unknown>(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'open' }),
    })
    return textResult(`Re-opened ${commentId}.`, { status: 'open', commentId })
  })

  server.registerTool('edit_comment', {
    title: 'Edit a code review comment body',
    description: 'Replace the body of an existing code-review comment (human or agent).',
    inputSchema: {
      commentId: z.string().min(1).describe('Comment id to edit.'),
      body: z.string().min(1).describe('New Markdown body.'),
    },
    outputSchema: { status: z.literal('edited'), commentId: z.string() },
    annotations: MUTATING,
  }, async ({ commentId, body }) => {
    await requestBaseJson<unknown>(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    return textResult(`Edited ${commentId}.`, { status: 'edited', commentId })
  })

  server.registerTool('delete_comment', {
    title: 'Delete a code review comment',
    description: 'Permanently delete a code-review thread and its replies.',
    inputSchema: { commentId: z.string().min(1).describe('Comment id to delete.') },
    outputSchema: { status: z.literal('deleted'), commentId: z.string() },
    annotations: MUTATING,
  }, async ({ commentId }) => {
    await requestBaseJson<unknown>(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
    })
    return textResult(`Deleted ${commentId}.`, { status: 'deleted', commentId })
  })

  server.registerTool('apply_suggestion', {
    title: 'Apply a suggestion block from a comment',
    description:
      'Apply the first ```suggestion fence in a comment to the working-tree file (additions side). Supports multi-line ranges. Resolves the comment on success.',
    inputSchema: { commentId: z.string().min(1).describe('Comment id containing a ```suggestion fence.') },
    outputSchema: { status: z.literal('applied'), commentId: z.string() },
    annotations: MUTATING,
  }, async ({ commentId }) => {
    await requestBaseJson<unknown>(
      `/api/comments/${encodeURIComponent(commentId)}/apply-suggestion`,
      { method: 'POST' },
    )
    return textResult(`Applied suggestion from ${commentId}.`, { status: 'applied', commentId })
  })

  server.registerTool('resolve_all_comments', {
    title: 'Resolve all open code review comments',
    description: 'Mark every open code-review thread as resolved. Safe to retry.',
    inputSchema: {},
    outputSchema: { status: z.literal('resolved-all'), resolved: z.number() },
    annotations: IDEMPOTENT_MUTATION,
  }, async () => {
    const result = await requestBaseJson<{ ok: boolean; resolved: number }>(
      '/api/comments/resolve-all',
      { method: 'POST' },
    )
    return textResult(`Resolved ${result.resolved} comment(s).`, {
      status: 'resolved-all',
      resolved: result.resolved,
    })
  })

  server.registerTool('get_review_history', {
    title: 'Get review handoff history',
    description:
      'List past "Send to agent" rounds (newest first). In-memory only — empty after server restart.',
    inputSchema: {},
    outputSchema: {
      rounds: z.array(z.object({
        round: z.number(),
        sentAt: z.number(),
        openCount: z.number(),
        decision: z.string().optional(),
        mode: z.string().optional(),
        filePaths: z.array(z.string()),
      })),
    },
    annotations: READ_ONLY,
  }, async () => {
    const data = await requestBaseJson<{ rounds: Array<Record<string, unknown>> }>(
      '/api/review/history',
    )
    return textResult(
      `Review history: ${data.rounds?.length ?? 0} round(s).`,
      { rounds: data.rounds ?? [] },
    )
  })

  server.registerTool('report_progress', {
    title: 'Report agent progress to the human UI',
    description:
      'Push a short status message (and optional percent) to the review UI so the human sees what you are doing.',
    inputSchema: {
      message: z.string().min(1).describe('Short progress message.'),
      model: z.string().optional().describe('Model / agent name.'),
      agentId: z.string().optional().describe('Stable agent id for multi-agent sessions.'),
      commentId: z.string().optional().describe('Related comment id, if any.'),
      pct: z.number().min(0).max(100).optional().describe('Optional 0–100 progress.'),
    },
    outputSchema: { status: z.literal('ok') },
    annotations: MUTATING,
  }, async ({ message, model, agentId, commentId, pct }) => {
    await requestBaseJson<unknown>('/api/agent/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, model, agentId, commentId, pct }),
    })
    return textResult('Progress reported.', { status: 'ok' })
  })

  server.registerTool('edit_reply', {
    title: 'Edit a reply on a code review comment',
    description: 'Replace the body of an existing reply on a code-review thread.',
    inputSchema: {
      commentId: z.string().min(1).describe('Parent comment id.'),
      replyId: z.string().min(1).describe('Reply id to edit.'),
      body: z.string().min(1).describe('New Markdown body.'),
    },
    outputSchema: {
      status: z.literal('edited'),
      commentId: z.string(),
      replyId: z.string(),
    },
    annotations: MUTATING,
  }, async ({ commentId, replyId, body }) => {
    await requestBaseJson<unknown>(
      `/api/comments/${encodeURIComponent(commentId)}/replies/${encodeURIComponent(replyId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    )
    return textResult(`Edited reply ${replyId} on ${commentId}.`, {
      status: 'edited',
      commentId,
      replyId,
    })
  })

  server.registerTool('delete_reply', {
    title: 'Delete a reply on a code review comment',
    description: 'Permanently delete a reply from a code-review thread.',
    inputSchema: {
      commentId: z.string().min(1).describe('Parent comment id.'),
      replyId: z.string().min(1).describe('Reply id to delete.'),
    },
    outputSchema: {
      status: z.literal('deleted'),
      commentId: z.string(),
      replyId: z.string(),
    },
    annotations: MUTATING,
  }, async ({ commentId, replyId }) => {
    await requestBaseJson<unknown>(
      `/api/comments/${encodeURIComponent(commentId)}/replies/${encodeURIComponent(replyId)}`,
      { method: 'DELETE' },
    )
    return textResult(`Deleted reply ${replyId} on ${commentId}.`, {
      status: 'deleted',
      commentId,
      replyId,
    })
  })

  server.registerTool('submit_plan', {
    title: 'Submit or resubmit a plan',
    description: 'Submit Markdown for human plan review. To revise after changes-requested, pass the same planId so a new version is created.',
    inputSchema: {
      title: z.string().optional().describe('Human-readable plan title.'),
      body: z.string().min(1).describe('Complete Markdown plan body.'),
      source: z.string().optional().describe('Optional source filename or workflow label.'),
      model: z.string().optional().describe('Optional agent/model identifier.'),
      planId: z.string().optional().describe('Existing plan id when resubmitting a revised version.'),
    },
    outputSchema: {
      status: z.literal('submitted'), planId: z.string(), version: z.number(), url: z.string(),
    },
    annotations: MUTATING,
  }, async ({ title, body, source, model, planId }) => {
    const session = requireWebSession()
    const base = session.url
    // Capture the current round before POST. A human can decide immediately
    // after submission; await_plan_review must still ask from this pre-submit
    // cursor instead of reseeding past that fast verdict.
    await seedPlanCursor(session, undefined, true)
    const plan = await requestSessionJson<Plan>(session, '/api/plans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: planId, title, body, source, model }),
    })
    const url = `${base}/plan/${plan.id}`
    return textResult(
      `Submitted plan ${plan.id} (v${plan.version}) at ${url}. Call await_plan_review.`,
      { status: 'submitted', planId: plan.id, version: plan.version, url },
    )
  })

  server.registerTool('await_plan_review', {
    title: 'Wait for plan review verdict',
    description: 'Wait for a plan verdict. Returns status=released or status=timeout and always includes mode. Timeout is expected and safe to retry; progress notifications are sent between long polls.',
    inputSchema: {
      timeoutSeconds: z.number().positive().max(3600).optional().describe('Total wait budget in seconds; defaults to 570.'),
    },
    outputSchema: {
      status: z.enum(['released', 'timeout']),
      mode: z.enum(['standard', 'comment-only']),
      round: z.number(),
      planId: z.string().optional(),
      decision: z.enum(['pending', 'approved', 'changes-requested', 'rejected', 'comment-only']).optional(),
      decisionComment: z.string().optional(),
      openCommentCount: z.number().optional(),
      plan: z.unknown().optional(),
      nextAction: z.string(),
    },
    annotations: AWAIT,
  }, async ({ timeoutSeconds }, extra) => {
    const session = requireWebSession()
    const budgetMs = (timeoutSeconds ?? 570) * 1000
    const progressToken = extra?._meta?.progressToken
    let sinceRound = await seedPlanCursor(session, extra?.signal)
    const deadline = Date.now() + budgetMs
    let cycle = 0

    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now())
      const result = await requestSessionJson<any>(
        session,
        `/api/plan-review/await?timeoutMs=${Math.min(25000, remaining)}&sinceRound=${sinceRound}`,
        { signal: extra?.signal },
      )
      if (result.status === 'released') {
        const payload = result.payload
        sinceRound = payload.round
        planCursor = { identity: session.identity, round: sinceRound }
        const nextAction = payload.mode === 'comment-only'
          ? 'Reply to plan comments without changing implementation files.'
          : payload.decision === 'approved'
            ? 'Proceed with the approved plan.'
            : payload.decision === 'changes-requested'
              ? 'Revise the plan and call submit_plan with the same planId.'
              : 'Stop; the plan was rejected.'
        const structured = {
          status: 'released', mode: payload.mode ?? 'standard', round: payload.round,
          planId: payload.planId, decision: payload.decision,
          ...(payload.decisionComment ? { decisionComment: payload.decisionComment } : {}),
          openCommentCount: payload.openCommentCount, plan: payload.plan, nextAction,
        }
        return textResult(payload.reviewXml, structured)
      }
      sinceRound = result.round ?? sinceRound
      planCursor = { identity: session.identity, round: sinceRound }
      cycle += 1
      if (progressToken !== undefined) {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: cycle,
            total: Math.max(cycle, Math.ceil(budgetMs / 25000)),
            message: 'Still waiting for a plan verdict; long poll completed and will retry.',
          },
        }).catch(() => {})
      }
    }
    const structured = {
      status: 'timeout', mode: 'standard', round: sinceRound,
      nextAction: 'No plan verdict arrived within the wait budget. Call await_plan_review again to keep waiting.',
    }
    return textResult(structured.nextAction, structured)
  })

  server.registerTool('list_plans', {
    title: 'List submitted plans',
    description: 'List every submitted plan with its current verdict, version, and inline comments.',
    inputSchema: {},
    outputSchema: { plans: z.array(z.unknown()) },
    annotations: READ_ONLY,
  }, async () => {
    const plans = await requestBaseJson<Plan[]>('/api/plans')
    const summary = plans.map((plan) => {
      const open = (plan.comments ?? []).filter((comment) => comment.status === 'open').length
      return `${plan.id} [${plan.decision}] v${plan.version} — ${open} open comment(s) — ${plan.title}`
    }).join('\n')
    return textResult(summary || 'No plans submitted yet.', { plans })
  })

  server.registerTool('get_plan', {
    title: 'Get a plan',
    description: 'Fetch one current plan as plan-review XML and structured data, including verdict and inline comments.',
    inputSchema: { planId: z.string().min(1).describe('Plan id from submit_plan or list_plans.') },
    outputSchema: { plan: z.unknown() },
    annotations: READ_ONLY,
  }, async ({ planId }) => {
    const plan = await requestBaseJson<Plan>(`/api/plans/${encodeURIComponent(planId)}`)
    return textResult(formatPlanReview(plan), { plan })
  })

  server.registerTool('get_plan_versions', {
    title: 'List plan versions',
    description: 'List all submitted versions of a plan, oldest first.',
    inputSchema: { planId: z.string().min(1).describe('Plan id to inspect.') },
    outputSchema: { versions: z.array(z.unknown()) },
    annotations: READ_ONLY,
  }, async ({ planId }) => {
    const versions = await requestBaseJson<NonNullable<Plan['versions']>>(
      `/api/plans/${encodeURIComponent(planId)}/versions`,
    )
    const summary = versions.map((version) => {
      const date = new Date(version.createdAt).toISOString().slice(0, 16).replace('T', ' ')
      return `v${version.version} — ${date} — ${version.title}`
    }).join('\n')
    return textResult(summary || 'No versions recorded.', { versions })
  })

  server.registerTool('get_plan_version', {
    title: 'Get a plan version',
    description: 'Fetch the current or a historical plan version as plan-review XML with version-anchored comments.',
    inputSchema: {
      planId: z.string().min(1).describe('Plan id to inspect.'),
      version: z.number().int().positive().optional().describe('Historical version number; omit for current.'),
    },
    outputSchema: {
      plan: z.unknown(), version: z.unknown().optional(), currentVersion: z.number().optional(),
    },
    annotations: READ_ONLY,
  }, async ({ planId, version }) => {
    const encodedId = encodeURIComponent(planId)
    const plan = await requestBaseJson<Plan>(`/api/plans/${encodedId}`)
    if (version === undefined) return textResult(formatPlanReview(plan), { plan })
    const data = await requestBaseJson<{ version: NonNullable<Plan['versions']>[number]; plan: { currentVersion: number } }>(
      `/api/plans/${encodedId}/versions/${version}`,
    )
    return textResult(formatPlanReview(plan, { viewingVersion: data.version.version }), {
      plan, version: data.version, currentVersion: data.plan.currentVersion,
    })
  })

  async function findPlanForComment(commentId: string): Promise<Plan | null> {
    const plans = await requestBaseJson<Plan[]>('/api/plans')
    return plans.find((plan) => (plan.comments ?? []).some((comment) => comment.id === commentId)) ?? null
  }

  server.registerTool('reply_to_plan_comment', {
    title: 'Reply to a plan comment',
    description: 'Post an agent reply to an existing inline plan-review thread.',
    inputSchema: {
      commentId: z.string().min(1).describe('Plan comment id from get_plan or await_plan_review.'),
      body: z.string().min(1).describe('Reply body in Markdown.'),
      model: z.string().optional().describe('Optional agent/model identifier shown in the UI.'),
    },
    outputSchema: { status: z.literal('replied'), commentId: z.string(), planId: z.string() },
    annotations: MUTATING,
  }, async ({ commentId, body, model }) => {
    const plan = await findPlanForComment(commentId)
    if (!plan) throw new Error(`Plan comment ${commentId} was not found. Refresh the plan before retrying.`)
    await requestBaseJson<unknown>(
      `/api/plans/${encodeURIComponent(plan.id)}/comments/${encodeURIComponent(commentId)}/replies`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, role: 'agent', model }),
      },
    )
    return textResult(`Replied to plan comment ${commentId}.`, {
      status: 'replied', commentId, planId: plan.id,
    })
  })

  server.registerTool('resolve_plan_comment', {
    title: 'Resolve a plan comment',
    description: 'Mark an inline plan-review thread resolved after it is fully addressed. Safe to retry.',
    inputSchema: { commentId: z.string().min(1).describe('Plan comment id to resolve.') },
    outputSchema: { status: z.literal('resolved'), commentId: z.string(), planId: z.string() },
    annotations: IDEMPOTENT_MUTATION,
  }, async ({ commentId }) => {
    const plan = await findPlanForComment(commentId)
    if (!plan) throw new Error(`Plan comment ${commentId} was not found. Refresh the plan before retrying.`)
    await requestBaseJson<unknown>(
      `/api/plans/${encodeURIComponent(plan.id)}/comments/${encodeURIComponent(commentId)}`,
      {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      },
    )
    return textResult(`Resolved plan comment ${commentId}.`, {
      status: 'resolved', commentId, planId: plan.id,
    })
  })

  server.registerResource('agent-guide', 'diffing://agent-guide', {
    title: 'diffing agent guide',
    description: 'Portable quick reference for the native code-review and plan-review workflows.',
    mimeType: 'text/markdown',
  }, async () => ({
    contents: [{ uri: 'diffing://agent-guide', mimeType: 'text/markdown', text: `# diffing agent guide

This MCP connection is immutably bound to \`${repoRoot}\`.

## Code review
1. Call \`review_session_status\`; call \`start_review_session\` if needed.
2. Call \`get_diff\` and inspect every changed file.
3. Use \`create_comment\` for actionable inline findings.
4. Use \`await_review\` for a human handoff; a timeout is safe to retry.
5. In \`comment-only\` mode, reply without editing files.

## Plan review
1. Start or reuse a review session.
2. Call \`submit_plan\`, then \`await_plan_review\`.
3. On \`changes-requested\`, revise and resubmit with the same \`planId\`.
4. On \`approved\`, proceed; on \`rejected\`, stop.

All HTTP activity is loopback-only. MCP never terminates a user-owned session.` }],
  }))

  server.registerPrompt('review_local_changes', {
    title: 'Review local changes with diffing',
    description: 'Workflow prompt for inspecting a local diff and leaving inline review feedback.',
    argsSchema: {
      focus: z.string().optional().describe('Optional review focus such as security, correctness, or tests.'),
    },
  }, async ({ focus }) => ({
    messages: [{ role: 'user', content: { type: 'text', text:
      `Use diffing to review the local changes in ${repoRoot}. ` +
      'Check review_session_status, start_review_session if needed, inspect get_diff, and create only actionable inline comments. ' +
      `Review every changed file${focus ? ` with special attention to ${focus}` : ''}.`,
    } }],
  }))

  server.registerPrompt('submit_plan_for_review', {
    title: 'Submit an implementation plan for review',
    description: 'Workflow prompt for submitting a plan and acting on the human verdict.',
    argsSchema: {
      plan: z.string().describe('Complete Markdown implementation plan to submit.'),
    },
  }, async ({ plan }) => ({
    messages: [{ role: 'user', content: { type: 'text', text:
      `Use diffing for plan review in ${repoRoot}. Start or reuse a review session, submit this plan, and await the verdict. ` +
      'On changes-requested revise and resubmit the same planId; on rejected stop; on approved proceed.\n\n' + plan,
    } }],
  }))

  return server
}

export async function startMcpServer(options: { repoPath?: string } = {}): Promise<void> {
  const repoRoot = resolveMcpRepository(options.repoPath ?? process.cwd(), options.repoPath !== undefined)
  // diffing's git and file stores are intentionally process-scoped. Binding
  // once before constructing the server keeps every tool on the same repo.
  process.chdir(repoRoot)
  const ownerId = randomUUID()
  const server = createMcpServer({ repoRoot, ownerId })
  const cleanupOwnedSession = () => {
    removeServerLockIfOwned(repoRoot, process.pid, ownerId)
  }
  process.once('exit', cleanupOwnedSession)
  // Once the MCP client disconnects, an owned HTTP server would otherwise
  // keep the stdio process alive. Exiting tears down that in-process server;
  // the ownership check above ensures a reused user server is never touched.
  process.stdin.once('end', () => process.exit(0))
  await server.connect(new StdioServerTransport())
}
