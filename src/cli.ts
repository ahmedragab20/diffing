#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import getPort from 'get-port'
import { parseDiffOptions, DEFAULTS, printHelp } from './lib/diff-options.js'
import { runTerminalDiff, validateEnvironment } from './lib/diff-engine.js'
import { startServer } from './server.js'
import { loadSettings } from './lib/settings.js'
import type { DiffOptions } from './lib/diff-options.js'

const args = process.argv.slice(2)
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
const port = await getPort(opts.port ? { port: opts.port } : undefined)
const host = opts.host

const __dirname = dirname(fileURLToPath(import.meta.url))
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

console.log(`diffit server running at ${localUrl}`)

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

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  process.exit(0)
})
