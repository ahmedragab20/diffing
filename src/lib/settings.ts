import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_DIR = join(homedir(), '.config', 'diffing')
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
  /** Tactile feedback (web-haptics) on interaction. */
  haptics: boolean
  /** Synthesized audio feedback on interaction. */
  sounds: boolean
  /** UI font family override. null = default (Geist Mono from CDN). */
  uiFont?: string | null
  /** Code/diff/plans font family override. null = default (JetBrains Mono from CDN). */
  monoFont?: string | null
  /** UI density — compact tightens padding / control heights. */
  density: 'comfortable' | 'compact'
  /**
   * Auto-collapse file cards whose added+deleted line count exceeds this.
   * Set 0 to disable.
   */
  autoCollapseLineThreshold: number
  /**
   * When true, "Send to agent" warns (and blocks until acknowledged) if any
   * files in the current diff are still unviewed.
   */
  requireViewAllBeforeSend: boolean
  /** Whether the vim-style status bar at the bottom is visible. */
  showStatusBar: boolean
  /**
   * Saved reply templates for quick insert into comment forms.
   * Stored globally in settings.json.
   */
  savedReplies: SavedReply[]
  /** Ignore changes in amount of whitespace (`git diff -b`). Live-toggled from UI. */
  ignoreSpaceChange: boolean
  /** Ignore all whitespace (`git diff -w`). Live-toggled from UI. */
  ignoreAllSpace: boolean
}

export interface SavedReply {
  id: string
  title: string
  body: string
}

const DEFAULTS: Settings = {
  staged: true,
  untracked: true,
  diffStyle: 'split',
  defaultTabSize: 4,
  theme: 'rose-pine',
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
  haptics: true,
  sounds: true,
  uiFont: null,
  monoFont: null,
  density: 'comfortable',
  autoCollapseLineThreshold: 400,
  requireViewAllBeforeSend: false,
  showStatusBar: true,
  savedReplies: [],
  ignoreSpaceChange: false,
  ignoreAllSpace: false,
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
