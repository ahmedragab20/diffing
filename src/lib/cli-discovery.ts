import { completionFor } from './completions.js'

export function runCompletionCommand(args: string[]): number {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(`Usage: diffing completion <bash|zsh|fish>

  diffing completion bash >> ~/.bashrc
  diffing completion zsh  > ~/.zfunc/_diffing
  diffing completion fish > ~/.config/fish/completions/diffing.fish`)
    return 0
  }
  const script = args.length === 1 ? completionFor(args[0]) : null
  if (!script) {
    console.error('Usage: diffing completion <bash|zsh|fish>')
    return 5
  }
  process.stdout.write(script)
  return 0
}
