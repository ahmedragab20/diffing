/** Shell completion scripts generated from the command catalog. */
import { CLI_COMMANDS } from './cli-commands.js'

const GLOBAL_FLAGS = [
  '--help',
  '--version',
  '--web',
  '--terminal',
  '--tui',
  '--view',
  '--no-open',
  '--reuse-session',
  '--replace-session',
  '--new-session',
  '--skip-setup',
  '--port',
  '--host',
  '--insecure-no-auth',
  '--staged',
  '--cached',
  '--gh-pr',
]

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

export function bashCompletion(): string {
  const actions = CLI_COMMANDS.filter((command) => command.actions).map(
    (command) => `      ${command.name}) candidates=${shellQuote(command.actions!.join(' '))} ;;`,
  ).join('\n')
  return `# diffing bash completion
_diffing() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" candidates="" item
  COMPREPLY=()
  compopt +o filenames 2>/dev/null || true
  if [[ "$cur" == -* ]]; then
    candidates=${shellQuote(GLOBAL_FLAGS.join(' '))}
  elif (( COMP_CWORD == 1 )); then
    candidates=${shellQuote(CLI_COMMANDS.map(({ name }) => name).join(' '))}
  elif (( COMP_CWORD == 2 )); then
    case "\${COMP_WORDS[1]}" in
${actions}
    esac
  fi
  if [[ -n "$candidates" ]]; then
    while IFS= read -r item; do COMPREPLY+=("$item"); done < <(compgen -W "$candidates" -- "$cur")
  else
    compopt -o filenames 2>/dev/null || true
    while IFS= read -r item; do COMPREPLY+=("$item"); done < <(compgen -f -- "$cur")
  fi
}
complete -F _diffing diffing
`
}

export function zshCompletion(): string {
  const commands = CLI_COMMANDS.map(({ name, description }) =>
    `    ${shellQuote(`${name}:${description.replaceAll(':', '\\:')}`)}`,
  ).join('\n')
  const actions = CLI_COMMANDS.filter((command) => command.actions).map(
    (command) => `        ${command.name}) _values ${shellQuote(`${command.name} action`)} ${command.actions!.map(shellQuote).join(' ')} ;;`,
  ).join('\n')
  return `#compdef diffing
_diffing() {
  local context state state_descr line
  typeset -A opt_args
  local -a commands
  commands=(
${commands}
  )
  _arguments -C \\
    '1: :->cmd' \\
    '*::arg:->args'
  case $state in
    cmd) _describe 'command' commands ;;
    args)
      if (( CURRENT != 2 )); then
        _files
        return
      fi
      case $words[1] in
${actions}
        *) _files ;;
      esac
      ;;
  esac
}
compdef _diffing diffing
`
}

export function fishCompletion(): string {
  const lines = [
    'complete -c diffing -f',
    ...CLI_COMMANDS.map(({ name, description }) =>
      `complete -c diffing -n ${shellQuote('__fish_use_subcommand')} -a ${shellQuote(name)} -d ${shellQuote(description)}`,
    ),
    ...GLOBAL_FLAGS.map((flag) =>
      `complete -c diffing -n ${shellQuote('__fish_use_subcommand')} -l ${shellQuote(flag.replace(/^--/, ''))}`,
    ),
    ...CLI_COMMANDS.filter((command) => command.actions).flatMap((command) =>
      command.actions!.map((action) =>
        `complete -c diffing -n ${shellQuote(`__fish_seen_subcommand_from ${command.name}; and test (count (commandline -opc)) -eq 2`)} -a ${shellQuote(action)}`,
      ),
    ),
    `complete -c diffing -n ${shellQuote('test (count (commandline -opc)) -ge 3')} -F`,
  ]
  return lines.join('\n') + '\n'
}

export function completionFor(shell: string): string | null {
  switch (shell.toLowerCase()) {
    case 'bash': return bashCompletion()
    case 'zsh': return zshCompletion()
    case 'fish': return fishCompletion()
    default: return null
  }
}
