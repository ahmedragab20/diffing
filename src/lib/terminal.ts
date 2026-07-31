import { stdout } from 'node:process'

export const reset = '\x1b[0m'

const GOLD = 220
const OK = 82
const OK_BRIGHT = 118
const WARN = 214
const WARN_BRIGHT = 220
const ERROR = 196
const INFO = 75

/** Whether ANSI styling is allowed (TTY, no NO_COLOR, TERM≠dumb). */
export function isColorEnabled(stream: NodeJS.WriteStream = stdout): boolean {
  if (!stream.isTTY) return false
  if (process.env.NO_COLOR !== undefined) return false
  if (process.env.TERM === 'dumb') return false
  return true
}

export function fg256(code: number, enabled = isColorEnabled()): string {
  return enabled ? `\x1b[38;5;${code}m` : ''
}

export function bold(text: string, enabled = isColorEnabled()): string {
  return enabled ? `\x1b[1m${text}${reset}` : text
}

export function dim(text: string, enabled = isColorEnabled()): string {
  return enabled ? `\x1b[2m${text}${reset}` : text
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

export interface TerminalStyleOptions {
  color?: boolean
  width?: number
}

function borderColor(enabled: boolean): string {
  return fg256(GOLD, enabled)
}

function visibleLength(text: string): number {
  return stripAnsi(text).length
}

function padRow(content: string, innerWidth: number): string {
  const pad = Math.max(0, innerWidth - visibleLength(content))
  return content + ' '.repeat(pad)
}

/** Gold Unicode box (╭─╮╰─╯│) with optional title row. */
export function box(
  title: string | undefined,
  lines: string[],
  options: TerminalStyleOptions = {},
): string {
  const color = options.color ?? isColorEnabled()
  const innerWidth = options.width ?? 62
  const border = borderColor(color)
  const r = color ? reset : ''
  const top = `${border}╭${'─'.repeat(innerWidth)}╮${r}`
  const bottom = `${border}╰${'─'.repeat(innerWidth)}╯${r}`
  const side = `${border}│${r}`

  const body: string[] = []
  if (title) {
    body.push(padRow(bold(title, color), innerWidth - 4))
    if (lines.length > 0) body.push('')
  }
  body.push(...lines)

  const rows = body.map((line) => {
    if (!line) return `${side}  ${' '.repeat(innerWidth - 4)}  ${side}`
    return `${side}  ${padRow(line, innerWidth - 4)}  ${side}`
  })

  return ['', top, ...rows, bottom, ''].join('\n')
}

/** Horizontal gold rule. */
export function rule(options: TerminalStyleOptions = {}): string {
  const color = options.color ?? isColorEnabled()
  const border = borderColor(color)
  const r = color ? reset : ''
  return `${border}${'─'.repeat(40)}${r}`
}

const TONE_ICON: Record<'ok' | 'warn' | 'error' | 'info', string> = {
  ok: '✓',
  warn: '!',
  error: '✗',
  info: '▌',
}

const TONE_COLOR: Record<'ok' | 'warn' | 'error' | 'info', number> = {
  ok: OK,
  warn: WARN,
  error: ERROR,
  info: INFO,
}

/** Semantic status line with icon and 256-color foreground. */
export function tone(
  level: 'ok' | 'warn' | 'error' | 'info',
  text: string,
  options: TerminalStyleOptions = {},
): string {
  const color = options.color ?? isColorEnabled()
  const icon = TONE_ICON[level]
  if (!color) return `${icon} ${text}`
  const code = level === 'ok' && text.includes('Overall: OK') ? OK_BRIGHT : TONE_COLOR[level]
  const accent = fg256(code, true)
  const iconCol = level === 'warn' ? fg256(WARN_BRIGHT, true) : accent
  return `${iconCol}${icon}${reset} ${accent}${text}${reset}`
}

/** Faint hint row: bold keys with dim labels (e.g. Y yes · n no). */
export function hintLine(
  parts: Array<{ key: string; label: string }>,
  options: TerminalStyleOptions = {},
): string {
  const color = options.color ?? isColorEnabled()
  const sep = color ? dim(' · ', true) : ' · '
  return parts
    .map(({ key, label }) => {
      const k = bold(key, color)
      const l = color ? dim(label, true) : label
      return `${k} ${l}`
    })
    .join(sep)
}

/** Step focus rail: ▌ Step 2/5 · Title */
export function stepHeader(
  step: number,
  total: number,
  title: string,
  options: TerminalStyleOptions = {},
): string {
  const color = options.color ?? isColorEnabled()
  if (!color) return `Step ${step}/${total} · ${title}`
  const rail = fg256(INFO, true)
  const label = fg256(INFO, true)
  const r = reset
  return `${rail}▌${r} ${label}Step ${step}/${total}${r} ${dim('·', true)} ${title}`
}

/** Bordered “copy me” block with dim label above content lines. */
export function copyBlock(
  label: string,
  content: string,
  options: TerminalStyleOptions = {},
): string {
  const color = options.color ?? isColorEnabled()
  const lines = content.trimEnd().split('\n')
  const header = color ? dim(label, true) : label
  return box(undefined, [header, ...lines], options)
}
