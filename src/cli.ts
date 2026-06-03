#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import getPort from 'get-port'
import { parseDiffOptions, DEFAULTS, printHelp, intoShowMode } from './lib/diff-options.js'
import { runTerminalDiff, validateEnvironment } from './lib/diff-engine.js'
import { startServer } from './server.js'
import { loadSettings } from './lib/settings.js'
import { writeServerLock, removeServerLock } from './lib/server-lock.js'
import { getRepoRoot } from './lib/git.js'
import { playStartupDisplay } from './lib/startup-display.js'
import type { DiffOptions } from './lib/diff-options.js'

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
  // `diffing gh ...` verbs (status, pr-fetch, pr-review, pr-list-comments)
  // instead of opening the web UI.
  args.splice(0, ghPrConsumed)
}

// ── Agent subcommands ───────────────────────────────────
// A small reserved set of verbs drives the user→agent handoff. They're checked
// before diff parsing so they never collide with `git diff` revisions.
const SUBCOMMANDS = new Set(['await-review', 'reply', 'resolve', 'comments', 'url', 'mcp', 'plan', 'update', 'gh'])
if (SUBCOMMANDS.has(args[0])) {
  if (args[0] === 'mcp') {
    const { startMcpServer } = await import('./mcp.js')
    await startMcpServer()
    // The MCP server owns stdio until the client disconnects (at which point
    // the event loop empties and the process exits). Park here so we never fall
    // through to diff parsing.
    await new Promise<never>(() => {})
  }
  const { runSubcommand } = await import('./cli-agent.js')
  process.exit(await runSubcommand(args[0], args.slice(1)))
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

const opts = parseDiffOptions(args)

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
// `--tui` is strictly opt-in. If the env cannot support a TUI (piped stdin,
// CI, no raw mode) or the Rust binary is missing/broken, we print one line
// to stderr and run the default `git diff` output. We never auto-promote
// to the TUI; the user must pass `--tui` explicitly.
if (opts.outputMode === 'tui') {
  const tuiResult = await launchTui(args)
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

const { port: actualPort, prMode } = await startServer({
  port,
  host,
  clientDir: resolvedClientDir,
  diffOpts: opts,
  prRef: prRef ?? undefined,
})

const localUrl = `http://${host}:${actualPort}`

// Advertise the running server so the agent subcommands / MCP server can find
// the port without the user telling them. Best-effort: a failure here only
// disables port-agnostic discovery, not the server itself.
try {
  let repoRoot: string
  try {
    repoRoot = getRepoRoot()
  } catch {
    repoRoot = process.cwd()
  }
  writeServerLock({
    port: actualPort,
    host,
    pid: process.pid,
    repoRoot,
    startedAt: Date.now(),
    version: currentVersion,
    mode: prMode ? 'gh-pr' : 'web',
    prRef: prMode ? prRef ?? undefined : undefined,
  })
} catch {
  // discovery is optional
}

console.log(`diffing server running at ${localUrl}`)
await playStartupDisplay()

try {
  const updateInfo = await updateCheckPromise
  if (updateInfo?.hasUpdate) {
    const { printUpdateDisclaimer } = await import('./lib/update-check.js')
    printUpdateDisclaimer(currentVersion, updateInfo.latestVersion)
  }
} catch {
  // best-effort update check
}

if (!opts.noOpen) {
  const settings = loadSettings()
  const openHost = host === '0.0.0.0' ? '127.0.0.1' : host
  const openUrl = `http://${openHost}:${actualPort}`
  const openModule = await import('open')
  let appName: string | readonly string[] | undefined
  if (settings.browser) {
    const apps = openModule.apps as Record<string, string | readonly string[]>
    appName = apps[settings.browser] || settings.browser
  }
  const options = appName ? { app: { name: appName } } : {}
  openModule.default(openUrl, options)
}

const shutdown = () => {
  console.log('\nShutting down...')
  removeServerLock()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// ── TUI helpers ─────────────────────────────────────────

import { findTuiBinary as _findTuiBinary } from './lib/find-tui-binary.js'

/**
 * Wrapper around `findTuiBinary` that passes this script's `import.meta.url`
 * so the search paths anchor to the bundled CLI's directory. The real
 * implementation lives in `lib/find-tui-binary.ts` and is unit-tested there.
 */
export function findTuiBinary(): string | null {
  return _findTuiBinary(import.meta.url)
}

/**
 * Fall back to default `git diff` output when the TUI cannot run.
 * Re-parses `args` so the terminal output exactly matches `diffing` (no flag)
 * in a non-TTY context.
 */
function runTerminalFallback(args: string[]): number {
  const terminalOpts = parseDiffOptions(args.filter(a => a !== '--tui'))
  // Force `outputMode: 'terminal'` so any auto-detection logic doesn't
  // second-guess the fallback path.
  terminalOpts.outputMode = 'terminal'
  terminalOpts.tui = false
  return runTerminalDiff(terminalOpts)
}

/**
 * Launch the native-Rust TUI binary as a child process. Returns the process
 * exit code. If the TUI cannot start (no TTY, missing binary), prints a
 * single stderr line and falls back to the default `git diff` output.
 */
async function launchTui(args: string[]): Promise<number> {
  // Gate 1 — TTY. The TUI needs a real terminal for raw mode + alternate screen.
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('diffing --tui requires a TTY; falling back to git diff')
    return runTerminalFallback(args)
  }
  // Gate 2 — binary present and executable.
  const bin = findTuiBinary()
  if (!bin) {
    console.error('diffing-tui binary not found; build it with `pnpm build:tui`; falling back to git diff')
    return runTerminalFallback(args)
  }
  // Strip --tui before forwarding so the TUI binary doesn't see it twice
  // (and so the rest of the args mirror the web/terminal flows). The TUI
  // binary accepts --repo as its only named option; everything else is
  // forwarded to `git diff`.
  const forwarded = args.filter(a => a !== '--tui')
  // Determine the repo root for the TUI. If we can't, fall back gracefully.
  let repoRoot: string
  try {
    repoRoot = getRepoRoot()
  } catch {
    repoRoot = process.cwd()
  }
  // Play the same startup animation the web server plays, then hand off.
  // playStartupDisplay is a no-op when !stdout.isTTY (already gated above).
  console.log(`diffing TUI starting (binary: ${bin})`)
  await playStartupDisplay()
  return new Promise<number>((resolveP) => {
    // Place --repo BEFORE the forwarded args so the TUI's clap parser can
    // extract it before the trailing-vararg (which would otherwise swallow
    // it as part of the git-diff passthrough).
    const child = spawn(bin, ['--repo', repoRoot, ...forwarded], {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('exit', code => resolveP(code ?? 0))
    child.on('error', err => {
      console.error(`diffing-tui failed to start: ${err.message}; falling back to git diff`)
      resolveP(runTerminalFallback(args))
    })
  })
}

