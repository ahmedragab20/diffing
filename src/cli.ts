#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, isAbsolute } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import getPort from 'get-port'
import { parseDiffOptions, DEFAULTS, printHelp } from './lib/diff-options.js'
import { runTerminalDiff, validateEnvironment } from './lib/diff-engine.js'
import { startServer } from './server.js'
import { loadSettings } from './lib/settings.js'
import { writeServerLock, removeServerLock } from './lib/server-lock.js'
import { getRepoRoot } from './lib/git.js'
import { playStartupDisplay } from './lib/startup-display.js'
import type { DiffOptions } from './lib/diff-options.js'

const args = process.argv.slice(2)

// ── Agent subcommands ───────────────────────────────────
// A small reserved set of verbs drives the user→agent handoff. They're checked
// before diff parsing so they never collide with `git diff` revisions.
const SUBCOMMANDS = new Set(['await-review', 'reply', 'resolve', 'comments', 'url', 'mcp', 'plan', 'update'])
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

const opts = parseDiffOptions(args)

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

const { port: actualPort } = await startServer({
  port,
  host,
  clientDir: resolvedClientDir,
  diffOpts: opts,
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
  writeServerLock({ port: actualPort, host, pid: process.pid, repoRoot, startedAt: Date.now(), version: currentVersion })
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

/**
 * Locate the `diffing-tui` native binary. Looks, in order:
 *   1. Sibling of this bundled `cli.mjs` (`dist/diffing-tui[.exe]`).
 *   2. `bin/diffing-tui[.exe]` next to the package root.
 *   3. `target/release/diffing-tui[.exe]` next to the package root
 *      (handy for `cargo build` during development).
 *   4. `$PATH` lookup via `which` / `where`.
 * Returns the absolute path of the first match, or `null` if none are found.
 */
export function findTuiBinary(): string | null {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const here = dirname(fileURLToPath(import.meta.url))
  // `here` is `dist/` after the tsdown build, and the package root sits one
  // level up. Allow either sibling-of-cli or sibling-of-package for the
  // various build layouts.
  const candidates: string[] = [
    resolve(here, `diffing-tui${ext}`),
    resolve(here, '..', 'bin', `diffing-tui${ext}`),
    resolve(here, '..', 'target', 'release', `diffing-tui${ext}`),
    resolve(here, '..', '..', 'target', 'release', `diffing-tui${ext}`),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  // Final fallback: $PATH lookup.
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(which, ['diffing-tui'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (out) {
      const first = out.split(/\r?\n/)[0]?.trim()
      if (first && isAbsolute(first)) return first
    }
  } catch {
    // not on $PATH — fall through
  }
  return null
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

