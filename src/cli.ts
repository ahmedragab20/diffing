#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import getPort from 'get-port'
import { parseDiffOptions, DEFAULTS, printHelp, intoShowMode, buildTuiGitDiffArgs } from './lib/diff-options.js'
import { runTerminalDiff, validateEnvironment } from './lib/diff-engine.js'
import { startServer } from './server.js'
import { loadSettings } from './lib/settings.js'
import {
  acquireServerStartupLease,
  diffScopeKey,
  isLockAlive,
  readServerLock,
  removeServerLockIfOwned,
  writeServerLock,
  type ServerStartupLease,
} from './lib/server-lock.js'
import { getBranchName, getRepoRoot } from './lib/git.js'
import { playStartupDisplay } from './lib/startup-display.js'
import { buildTuiDiffContext } from './lib/tui-diff-context.js'
import { finishTuiChild } from './lib/tui-child-lifecycle.js'
import {
  conflictFailMessage,
  openExistingSession,
  resolveSessionConflictAction,
  stopLockOwner,
} from './lib/session-conflict.js'
import type { DiffOptions } from './lib/diff-options.js'
import type { TuiSearchBridge } from './lib/tui-search-bridge.js'

const args = process.argv.slice(2)

// ── GitHub PR mode (quoted `gh pr <ref>` or `--gh-pr <ref>`) ──────────────
// `diffing "gh pr 1234"` opens the same web UI pointed at a GitHub PR. The
// quoted form is checked *before* parseDiffOptions so it never collides with
// `git diff` revisions. The `--gh-pr <ref>` flag form is parsed later by
// parseDiffOptions and merged below.
//
// Two argv shapes are accepted:
//   1. Quoted:   `diffing "gh pr 1234"`           → argv = ['gh pr 1234', ...]
//   2. Unquoted: `diffing gh pr 1234`             → argv = ['gh', 'pr', '1234', ...]
// Shape (1) is the natural way most users pass a multi-word PR ref, so we
// re-split it. Only the leading `gh pr <ref>` tokens are consumed; trailing
// args (e.g. `--no-open`) survive for parseDiffOptions.
let prRef: string | null = null
let ghPrConsumed = 0
if (args[0]?.startsWith('gh pr ') === true) {
  const rest = args[0].slice('gh pr '.length).trim()
  if (rest) {
    prRef = rest
    ghPrConsumed = 1
  }
} else if (args[0] === 'gh' && args[1] === 'pr' && args[2] !== undefined) {
  prRef = args[2]
  ghPrConsumed = 3
}
if (ghPrConsumed > 0) {
  // Remove only the `gh pr <ref>` tokens from `args` so the SUBCOMMANDS check
  // below doesn't match the leading `gh` and route to the agent-side
  // `diffing gh ...` verbs (overview/threads/reviews plus review lifecycle)
  // instead of opening the web UI.
  args.splice(0, ghPrConsumed)
}

// ── Agent / DX subcommands ──────────────────────────────
// Reserved verbs for handoff, plan review, GH PR automation, MCP, and
// diagnostics. Checked before git-diff parsing so they never collide with
// revisions. Full contracts: docs/cli.md §4–§5 and Agents.md.
//
//   await-review | comments | reply | resolve | unresolve | comment
//   progress | url | plan | gh | mcp | inspect | doctor | completion | update
//   mode
//   view and show are handled separately (fall through to native/web modes).
const SUBCOMMANDS = new Set([
  'await-review',
  'reply',
  'resolve',
  'unresolve',
  'comment',
  'comments',
  'url',
  'mcp',
  'plan',
  'update',
  'gh',
  'doctor',
  'completion',
  'progress',
  'inspect',
  'mode',
])
if (SUBCOMMANDS.has(args[0])) {
  if (args[0] === 'mcp') {
    const mcpArgs = args.slice(1)
    if (mcpArgs.includes('--help') || mcpArgs.includes('-h')) {
      console.log(`Usage: diffing mcp [--repo <absolute-path>]

Run diffing as a local stdio MCP server bound to one Git repository.

The server advertises session, diff inspection, comment lifecycle, plan
review, progress, and history tools. Prefer MCP when the harness exposes
it; otherwise use the CLI mirrors (await-review, comments, plan, …).

Options:
  --repo <path>  Bind to this absolute Git repository path.
                 If omitted, the Git repository containing the current directory is used.
  -h, --help     Show this help.

See docs/cli.md §5 (MCP) for the full tool table.`)
      process.exit(0)
    }

    let repoPath: string | undefined
    for (let index = 0; index < mcpArgs.length; index += 1) {
      const arg = mcpArgs[index]
      if (arg === '--repo') {
        const value = mcpArgs[index + 1]
        if (!value || value.startsWith('-')) {
          console.error('diffing mcp: --repo requires an absolute path')
          process.exit(5)
        }
        if (repoPath !== undefined) {
          console.error('diffing mcp: --repo may be specified only once')
          process.exit(5)
        }
        repoPath = value
        index += 1
      } else if (arg.startsWith('--repo=')) {
        if (repoPath !== undefined) {
          console.error('diffing mcp: --repo may be specified only once')
          process.exit(5)
        }
        repoPath = arg.slice('--repo='.length)
      } else {
        console.error(`diffing mcp: unknown option ${arg}`)
        process.exit(5)
      }
    }
    if (repoPath !== undefined && !isAbsolute(repoPath)) {
      console.error('diffing mcp: --repo must be an absolute path')
      process.exit(5)
    }

    const { startMcpServer } = await import('./mcp.js')
    await startMcpServer({ repoPath })
    // The MCP server owns stdio until the client disconnects (at which point
    // the event loop empties and the process exits). Park here so we never fall
    // through to diff parsing.
    await new Promise<never>(() => {})
  }
  const { runSubcommand } = await import('./cli-agent.js')
  process.exit(await runSubcommand(args[0], args.slice(1)))
}

// ── `view` subcommand ──────────────────────────────────
// A focused native diff browser. `--view` remains available for scripts, but
// the verb is the intended replacement for interactive `git diff`.
if (args[0] === 'view') {
  args.shift()
  args.unshift('--view')
}

// ── `show` subcommand ──────────────────────────────────
// `diffing show <revspec>...` is a drop-in for `git show`. Unlike the agent
// subcommands above it is *not* a client-of-the-running-server — it just
// rewrites the parsed options to "show mode" and falls through to the normal
// web | terminal | tui flow. Strictly opt-in; `diffing <sha>` retains its
// `git diff <sha>` semantics.
let showSubcommand = false
if (args[0] === 'show') {
  showSubcommand = true
  args.shift()
}

// A saved mode only changes interactive auto-selection. Quoted GitHub PR
// sessions are web-only; explicit mode flags are resolved by the parser.
const defaultInteractiveMode = prRef ? 'web' : loadSettings().defaultMode
const opts = parseDiffOptions(args, defaultInteractiveMode)

// `--gh-pr <ref>` is parsed by parseDiffOptions; merge it with the quoted /
// unquoted `gh pr <ref>` forms detected above so both entry points work.
if (!prRef && opts.ghPr) {
  prRef = opts.ghPr
}

if (showSubcommand) {
  if (opts.revisions.length === 0 && !opts.help && !opts.version) {
    console.error('Usage: diffing show <revspec>... [-- <pathspec>...]')
    process.exit(5)
  }
  intoShowMode(opts)
}

if (opts.help) {
  printHelp()
  process.exit(0)
}

if (opts.version) {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'))
  console.log(pkg.version)
  process.exit(0)
}

const envErr = validateEnvironment()
if (envErr) {
  console.error(envErr)
  process.exit(1)
}

// ── TUI mode: spawn the native Rust binary ─────────────
// If the env cannot support a TUI (piped stdin, CI, no raw mode) or the Rust
// binary is missing/broken, print one line to stderr and run `git diff`.
if (opts.outputMode === 'tui') {
  const tuiResult = await launchTui(args, opts)
  // tuiResult === 0 means the TUI ran and exited cleanly. Any other value
  // means the fallback path ran; in that case runTerminalDiff already
  // printed the diff and we just propagate its exit code.
  process.exit(tuiResult)
}

// ── Terminal mode: behave exactly like `git diff` ───────
if (opts.outputMode === 'terminal') {
  const exitCode = runTerminalDiff(opts)
  process.exit(exitCode)
}

// ── Web mode: launch the review server ──────────────────
const __pkgDir = dirname(fileURLToPath(import.meta.url))
const currentVersion = JSON.parse(readFileSync(resolve(__pkgDir, '..', 'package.json'), 'utf-8')).version

const updateCheckPromise = (async () => {
  try {
    const { checkForUpdates } = await import('./lib/update-check.js')
    return await checkForUpdates(currentVersion)
  } catch {
    return null
  }
})()

const port = await getPort(opts.port ? { port: opts.port } : undefined)
const host = opts.host

const clientDir = resolve(__pkgDir, 'client')
const resolvedClientDir = existsSync(clientDir)
  ? clientDir
  : resolve(process.cwd(), 'dist/client')

// Kick off the browser module load in parallel with server start so open is
// ready the moment the port is bound.
const openModulePromise = opts.noOpen ? null : import('open')

let repoRoot: string
try {
  repoRoot = getRepoRoot()
} catch {
  repoRoot = process.cwd()
}
const sessionOwnerId = randomUUID()
let startupLease: ServerStartupLease | null = acquireServerStartupLease(repoRoot, sessionOwnerId)
if (!startupLease) {
  console.error('Another diffing process is starting a review for this repository. Retry in a moment.')
  process.exit(3)
}

const existingLock = readServerLock(repoRoot)
if (existingLock && isLockAlive(existingLock, repoRoot)) {
  // Release while prompting — the user may take a while, and holding the
  // startup lease would block other legitimate startups.
  startupLease.release()
  startupLease = null

  if (opts.reuseSession && opts.replaceSession) {
    console.error('Cannot combine --reuse-session and --replace-session.')
    process.exit(5)
  }

  let action: 'open' | 'replace' | 'cancel'
  try {
    action = await resolveSessionConflictAction({
      lock: existingLock,
      reuseSession: opts.reuseSession,
      replaceSession: opts.replaceSession,
      canPrompt: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(detail)
    process.exit(5)
  }

  if (action === 'cancel') {
    console.error(conflictFailMessage(existingLock))
    process.exit(3)
  }

  if (action === 'open') {
    const live = readServerLock(repoRoot)
    const target = live && isLockAlive(live, repoRoot) ? live : existingLock
    await openExistingSession(target, { noOpen: opts.noOpen })
    process.exit(0)
  }

  // Replace: re-acquire the lease, stop the owner, then continue startup.
  startupLease = acquireServerStartupLease(repoRoot, sessionOwnerId)
  if (!startupLease) {
    console.error('Another diffing process is starting a review for this repository. Retry in a moment.')
    process.exit(3)
  }

  const afterLease = readServerLock(repoRoot)
  if (afterLease && isLockAlive(afterLease, repoRoot)) {
    try {
      console.error(`Stopping existing diffing session (pid ${afterLease.pid})…`)
      await stopLockOwner(afterLease)
    } catch (error) {
      startupLease.release()
      const detail = error instanceof Error ? error.message : String(error)
      console.error(detail)
      process.exit(1)
    }
  }
}

let actualPort: number
let prMode: boolean
try {
  const started = await startServer({
    port,
    host,
    clientDir: resolvedClientDir,
    diffOpts: opts,
    prRef: prRef ?? undefined,
  })
  actualPort = started.port
  prMode = started.prMode
  writeServerLock({
    port: actualPort,
    host,
    pid: process.pid,
    repoRoot,
    startedAt: Date.now(),
    version: currentVersion,
    mode: prMode ? 'gh-pr' : 'web',
    prRef: prMode ? prRef ?? undefined : undefined,
    scope: diffScopeKey(opts),
    ownerId: sessionOwnerId,
  })
} catch (error) {
  startupLease?.release()
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`Failed to start diffing review safely: ${detail}`)
  process.exit(1)
}
startupLease?.release()
startupLease = null

const localUrl = `http://${host}:${actualPort}`

console.log(`diffing server running at ${localUrl}`)

// Open the browser as soon as the server is listening. The decorative quote
// animation used to block here (typewriter can take seconds) so the UI felt
// stuck until the quote finished — never gate the browser on that.
if (openModulePromise) {
  try {
    const settings = loadSettings()
    const openHost = host === '0.0.0.0' ? '127.0.0.1' : host
    // PR mode mounts <PrReviewApp> only on `/gh/pr` — open that path so the
    // user lands on Submit-to-GitHub instead of the local review surface.
    const openUrl = `http://${openHost}:${actualPort}${prMode ? '/gh/pr' : ''}`
    const openModule = await openModulePromise
    let appName: string | readonly string[] | undefined
    if (settings.browser) {
      const apps = openModule.apps as Record<string, string | readonly string[]>
      appName = apps[settings.browser] || settings.browser
    }
    const options = appName ? { app: { name: appName } } : {}
    void openModule.default(openUrl, options)
  } catch (err) {
    console.error('Failed to open browser:', err instanceof Error ? err.message : err)
  }
}

// Decorative startup quote — non-blocking; never delay the review UI for it.
void playStartupDisplay()

try {
  const updateInfo = await updateCheckPromise
  if (updateInfo?.hasUpdate) {
    const { printUpdateDisclaimer } = await import('./lib/update-check.js')
    printUpdateDisclaimer(currentVersion, updateInfo.latestVersion)
  }
} catch {
  // best-effort update check
}

const shutdown = () => {
  console.log('\nShutting down...')
  removeServerLockIfOwned(repoRoot, process.pid, sessionOwnerId)
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// ── TUI helpers ─────────────────────────────────────────

import {
  findTuiBinaries as _findTuiBinaries,
  findTuiBinary as _findTuiBinary,
} from './lib/find-tui-binary.js'

/**
 * Wrapper around `findTuiBinary` that passes this script's `import.meta.url`
 * so the search paths anchor to the bundled CLI's directory. The real
 * implementation lives in `lib/find-tui-binary.ts` and is unit-tested there.
 */
export function findTuiBinary(requireViewer = false): string | null {
  if (!requireViewer) return _findTuiBinary(import.meta.url)
  return _findTuiBinaries(import.meta.url).find((candidate) => {
    try {
      const help = execFileSync(candidate, ['--help'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
      })
      return help.includes('--view-only')
    } catch {
      return false
    }
  }) ?? null
}

/**
 * Fall back to default `git diff` output when the TUI cannot run.
 * Re-parses `args` so the terminal output exactly matches `diffing` (no flag)
 * in a non-TTY context.
 */
function runTerminalFallback(args: string[]): number {
  const terminalOpts = parseDiffOptions(args.filter(a => a !== '--tui' && a !== '--view'))
  // Force `outputMode: 'terminal'` so any auto-detection logic doesn't
  // second-guess the fallback path.
  terminalOpts.outputMode = 'terminal'
  terminalOpts.tui = false
  terminalOpts.viewOnly = false
  return runTerminalDiff(terminalOpts)
}

/**
 * Launch the native-Rust TUI binary as a child process. Returns the process
 * exit code. If the TUI cannot start (no TTY, missing binary), prints a
 * single stderr line and falls back to the default `git diff` output.
 */
async function launchTui(args: string[], opts: DiffOptions): Promise<number> {
  const viewOnly = args.includes('--view')
  const requestedMode = viewOnly ? 'diffing view' : 'diffing --tui'
  // Gate 1 — TTY. The TUI needs a real terminal for raw mode + alternate screen.
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error(`${requestedMode} requires a TTY; falling back to git diff`)
    return runTerminalFallback(args)
  }
  // Gate 2 — binary present and executable.
  const bin = findTuiBinary(viewOnly)
  if (!bin) {
    console.error(`${viewOnly ? 'compatible ' : ''}diffing-tui binary not found; build it with \`pnpm build:tui\`; falling back to git diff`)
    return runTerminalFallback(args)
  }
  // Strip --tui before forwarding so the TUI binary doesn't see it twice
  // (and so the rest of the args mirror the web/terminal flows). The TUI
  // binary accepts --repo as its only named option; everything else is
  // forwarded to `git diff`.
  const forwarded = buildTuiGitDiffArgs(opts)
  // Determine the repo root for the TUI. If we can't, fall back gracefully.
  let repoRoot: string
  try {
    repoRoot = getRepoRoot()
  } catch {
    repoRoot = process.cwd()
  }
  // Terminal workflows are latency-sensitive: enter the alternate screen as
  // soon as the compatible native binary is known. The web-only decorative
  // startup animation must never sit on the critical path for `diffing view`
  // or `diffing --tui`.
  let searchBridge: TuiSearchBridge | null = null
  try {
    const { startTuiSearchBridge } = await import('./lib/tui-search-bridge.js')
    searchBridge = await startTuiSearchBridge()
  } catch (error: any) {
    console.error(`diffing: fff search unavailable in TUI: ${error?.message ?? error}`)
  }
  const diffContext = buildTuiDiffContext(opts, getBranchName())
  return new Promise<number>((resolveP) => {
    // Place --repo BEFORE the forwarded args so the TUI's clap parser can
    // extract it before the trailing-vararg (which would otherwise swallow
    // it as part of the git-diff passthrough).
    const child = spawn(bin, [
      '--repo',
      repoRoot,
      ...(viewOnly ? ['--view-only'] : []),
      ...forwarded,
    ], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DIFFING_TUI_DIFF_CONTEXT: JSON.stringify(diffContext),
        ...(searchBridge
          ? {
              DIFFING_TUI_SEARCH_ENDPOINT: searchBridge.endpoint,
              DIFFING_TUI_SEARCH_CAPABILITY: searchBridge.capability,
            }
          : {}),
      },
    })
    child.on('exit', code => {
      void finishTuiChild(searchBridge, () => resolveP(code ?? 0))
    })
    child.on('error', err => {
      console.error(`diffing-tui failed to start: ${err.message}; falling back to git diff`)
      void finishTuiChild(searchBridge, () => resolveP(runTerminalFallback(args)))
    })
  })
}
