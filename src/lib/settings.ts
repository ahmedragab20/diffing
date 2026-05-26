import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_DIR = join(homedir(), '.config', 'diffit')
const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json')

export type LineDiffType = 'word' | 'word-alt' | 'char' | 'none'
export type DiffIndicators = 'classic' | 'bars' | 'none'
export type HunkSeparatorStyle = 'simple' | 'metadata' | 'line-info' | 'line-info-basic'
export type LineHoverHighlight = 'disabled' | 'both' | 'number' | 'line'

export interface Settings {
  staged: boolean
  untracked: boolean
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  browser?: string
  theme: string
  editorIDE?: 'default' | 'vscode' | 'zed' | 'vim' | 'neovim'
  /** Inline change highlight algorithm — pinpoint exact diff inside a line. */
  lineDiffType: LineDiffType
  /** Soft-wrap long lines instead of horizontal scroll. */
  lineWrap: boolean
  /** Visual style for added/removed line indicators. */
  diffIndicators: DiffIndicators
  /** Show gutter line numbers. */
  showLineNumbers: boolean
  /** Display style for the divider between hunks (includes function context). */
  hunkSeparators: HunkSeparatorStyle
  /** How a hovered line should be highlighted. */
  lineHoverHighlight: LineHoverHighlight
  /** Render code at this base font-size (px). */
  fontSize: number
  /** Auto-load full file contents so hunk context becomes expandable. */
  expandContextByDefault: boolean
  /** Only collapse unchanged context gaps larger than this. */
  collapsedContextThreshold: number
  /** How many lines to reveal per expand-up / expand-down click. */
  expansionLineCount: number
}

const DEFAULTS: Settings = {
  staged: true,
  untracked: true,
  diffStyle: 'split',
  defaultTabSize: 4,
  theme: 'nord',
  editorIDE: 'default',
  lineDiffType: 'word',
  lineWrap: false,
  diffIndicators: 'classic',
  showLineNumbers: true,
  hunkSeparators: 'line-info',
  lineHoverHighlight: 'both',
  fontSize: 13,
  expandContextByDefault: false,
  collapsedContextThreshold: 10,
  expansionLineCount: 20,
}

export function loadSettings(): Settings {
  try {
    const data = readFileSync(SETTINGS_FILE, 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(data) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: Partial<Settings>): Settings {
  const current = loadSettings()
  const merged = { ...current, ...settings }
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2))
  return merged
}
