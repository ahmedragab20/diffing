import { stdout } from 'node:process'
import { bold, dim, fg256, isColorEnabled, reset } from './terminal.js'

/** A single, deterministic frame: no sleeps, cursor ownership, or signal handlers. */
export function renderStartupDisplay(options: { width?: number; color?: boolean; plain?: boolean } = {}): string {
  const width = Math.max(1, Math.floor(Number.isFinite(options.width) ? options.width! : 80))
  const color = options.color ?? false
  if (width < 48 || options.plain) {
    const label = width >= 28 ? 'diffing  /  local code review' : 'diffing'
    return bold(label.slice(0, width), color) + '\n'
  }
  const removed = fg256(174, color)
  const added = fg256(108, color)
  const neutral = fg256(245, color)
  const end = color ? reset : ''
  return [
    `${neutral}  ╭───╮${end}`,
    `${neutral}  │${end} ${removed}−${end} ${neutral}│${end}  ${bold('diffing', color)}`,
    `${neutral}  │${end} ${added}+${end} ${neutral}│${end}  ${dim('Review the change. Keep the context.', color)}`,
    `${neutral}  ╰───╯${end}`,
    '',
  ].join('\n')
}

export function playStartupDisplay(): Promise<void> {
  if (stdout.isTTY) {
    stdout.write(renderStartupDisplay({
      width: stdout.columns,
      color: isColorEnabled(stdout),
      plain: process.env.TERM === 'dumb',
    }))
  }
  return Promise.resolve()
}
