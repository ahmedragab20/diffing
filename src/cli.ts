#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
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

const clientDir = resolve(__dirname, 'client')
const { existsSync } = await import('node:fs')
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
