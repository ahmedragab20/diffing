/** Top-level command discovery shared by help and shell completions. */
export interface CliCommand {
  name: string
  description: string
  actions?: readonly string[]
  aliasFor?: string
}

export const CLI_COMMANDS: readonly CliCommand[] = [
  { name: 'setup', description: 'Run the first-time setup wizard', actions: ['skills', 'mcp'] },
  { name: 'init', description: 'Alias for setup', aliasFor: 'setup', actions: ['skills', 'mcp'] },
  { name: 'onboard', description: 'Alias for setup', aliasFor: 'setup', actions: ['skills', 'mcp'] },
  { name: 'await-review', description: 'Wait until the human sends a review' },
  { name: 'reply', description: 'Reply to a comment' },
  { name: 'resolve', description: 'Resolve a comment' },
  { name: 'unresolve', description: 'Reopen a comment' },
  { name: 'comment', description: 'Edit or delete a comment', actions: ['edit', 'delete'] },
  { name: 'comments', description: 'Export review comments' },
  { name: 'url', description: 'Print the active server URL' },
  { name: 'mcp', description: 'Run the MCP server' },
  { name: 'plan', description: 'Review implementation plans', actions: ['submit', 'await', 'list', 'show', 'versions', 'reply', 'resolve'] },
  { name: 'mockup', description: 'Review HTML mockups', actions: ['submit', 'await', 'list', 'show', 'versions', 'reply', 'resolve', 'unresolve', 'apply-suggestion', 'inspect', 'screen', 'threads', 'handoff'] },
  { name: 'design', description: 'Manage design systems', actions: ['show', 'list', 'extract', 'propose', 'publish'] },
  { name: 'update', description: 'Upgrade diffing' },
  { name: 'gh', description: 'Inspect and manage GitHub pull requests', actions: ['pr', 'status', 'overview', 'threads', 'reviews', 'timeline', 'pending', 'pr-fetch', 'pr-review', 'pr-list-comments', 'pr-update', 'pr-close', 'pr-reopen', 'pr-merge'] },
  { name: 'doctor', description: 'Diagnose setup' },
  { name: 'view', description: 'Browse diffs in the native TUI' },
  { name: 'show', description: 'Show commits like git show' },
  { name: 'completion', description: 'Print shell completions', actions: ['bash', 'zsh', 'fish'] },
  { name: 'progress', description: 'Report agent progress' },
  { name: 'inspect', description: 'Read bounded diff data', actions: ['summary', 'files', 'hunks', 'slice', 'search'] },
  { name: 'evidence', description: 'Inspect repository evidence', actions: ['list', 'map', 'read', 'search', 'symbols', 'verify', 'notebook', 'decide'] },
  { name: 'mode', description: 'Get or set the default interactive mode', actions: ['web', 'tui'] },
  { name: 'sessions', description: 'Manage running review sessions', actions: ['list', 'use', 'open', 'stop', 'kill'] },
  { name: 'commands', description: 'List available commands' },
]

export const AGENT_SUBCOMMANDS = new Set(
  CLI_COMMANDS.filter(({ name }) => name !== 'view' && name !== 'show').map(({ name }) => name),
)

export function commandCatalog() {
  return { schemaVersion: 1 as const, commands: CLI_COMMANDS }
}

export function runCommands(args: string[]): number {
  let json = false
  let help = false
  let name: string | undefined
  for (const arg of args) {
    if (arg === '--json') json = true
    else if (arg === '--help' || arg === '-h') help = true
    else if (arg.startsWith('-')) {
      console.error(`diffing commands: unknown option ${arg}`)
      return 5
    } else if (name !== undefined) {
      console.error('diffing commands: expected at most one command name')
      return 5
    } else name = arg
  }
  const commands = name === undefined ? CLI_COMMANDS : CLI_COMMANDS.filter((entry) => entry.name === name)
  if (commands.length === 0) {
    console.error(`diffing commands: unknown command ${name}`)
    return 5
  }
  if (help) {
    console.log('Usage: diffing commands [--json] [command]')
  } else if (json) {
    console.log(JSON.stringify({ ...commandCatalog(), commands }, null, 2))
  } else {
    for (const command of commands) {
      console.log(`${command.name.padEnd(14)} ${command.description}`)
      if (command.actions) console.log(`  Actions: ${command.actions.join(' ')}`)
    }
  }
  return 0
}
