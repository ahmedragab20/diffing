#!/usr/bin/env node
import { readFileSync } from 'node:fs'

// Keep discovery independent of Git, settings, native bindings, and the server.
// This entry stays small in both the source runner and the packaged CLI.
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--version') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  console.log(pkg.version)
} else if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
  const { printHelp } = await import('./lib/diff-options.js')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  printHelp(pkg.version)
} else if (args[0] === 'commands') {
  const { runCommands } = await import('./lib/cli-commands.js')
  process.exitCode = runCommands(args.slice(1))
} else if (args[0] === 'completion') {
  const { runCompletionCommand } = await import('./lib/cli-discovery.js')
  process.exitCode = runCompletionCommand(args.slice(1))
} else {
  await import('./cli-main.js')
}
