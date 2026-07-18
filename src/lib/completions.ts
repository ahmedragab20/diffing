/**
 * Shell completion scripts for bash / zsh / fish.
 */

const SUBCOMMANDS = [
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
  'show',
  'completion',
  'progress',
]

const PLAN_ACTIONS = ['submit', 'await', 'list', 'show', 'versions', 'reply', 'resolve']
const GH_ACTIONS = ['status', 'pr-fetch', 'pr-review', 'pr-list-comments']
const GLOBAL_FLAGS = [
  '--help',
  '--version',
  '--web',
  '--terminal',
  '--tui',
  '--no-open',
  '--port',
  '--host',
  '--staged',
  '--cached',
  '--gh-pr',
]

export function bashCompletion(): string {
  return `# diffing bash completion
_diffing() {
  local cur prev words cword
  _init_completion || return
  case "\${words[1]}" in
    plan) COMPREPLY=( $(compgen -W "${PLAN_ACTIONS.join(' ')}" -- "$cur") ) ;;
    gh) COMPREPLY=( $(compgen -W "${GH_ACTIONS.join(' ')}" -- "$cur") ) ;;
    completion) COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") ) ;;
    comments) COMPREPLY=( $(compgen -W "--open --json --format" -- "$cur") ) ;;
    *)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "${GLOBAL_FLAGS.join(' ')}" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "${SUBCOMMANDS.join(' ')}" -- "$cur") )
      fi
      ;;
  esac
}
complete -F _diffing diffing
`
}

export function zshCompletion(): string {
  return `#compdef diffing
_diffing() {
  local -a commands
  commands=(
    'await-review:Block until human sends review'
    'reply:Reply to a comment'
    'resolve:Resolve a comment'
    'comments:Dump comments'
    'url:Print server URL'
    'mcp:Run MCP server'
    'plan:Plan review commands'
    'update:Upgrade diffing'
    'gh:GitHub PR commands'
    'doctor:Diagnose setup'
    'show:Show commit(s) like git show'
    'completion:Print shell completions'
  )
  _arguments -C \\
    '1: :->cmd' \\
    '*::arg:->args'
  case $state in
    cmd) _describe 'command' commands ;;
    args)
      case $words[1] in
        plan) _values 'plan action' ${PLAN_ACTIONS.map((a) => `'${a}'`).join(' ')} ;;
        gh) _values 'gh action' ${GH_ACTIONS.map((a) => `'${a}'`).join(' ')} ;;
        completion) _values 'shell' bash zsh fish ;;
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
    ...SUBCOMMANDS.map(
      (s) => `complete -c diffing -n "__fish_use_subcommand" -a ${s}`,
    ),
    ...GLOBAL_FLAGS.map(
      (f) => `complete -c diffing -n "__fish_use_subcommand" -l ${f.replace(/^--/, '')}`,
    ),
    ...PLAN_ACTIONS.map(
      (a) =>
        `complete -c diffing -n "__fish_seen_subcommand_from plan" -a ${a}`,
    ),
    ...GH_ACTIONS.map(
      (a) => `complete -c diffing -n "__fish_seen_subcommand_from gh" -a ${a}`,
    ),
    'complete -c diffing -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"',
  ]
  return lines.join('\n') + '\n'
}

export function completionFor(shell: string): string | null {
  switch (shell.toLowerCase()) {
    case 'bash':
      return bashCompletion()
    case 'zsh':
      return zshCompletion()
    case 'fish':
      return fishCompletion()
    default:
      return null
  }
}
