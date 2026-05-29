import { useState, useEffect, useCallback } from 'react'

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
  lineDiffType: LineDiffType
  lineWrap: boolean
  diffIndicators: DiffIndicators
  showLineNumbers: boolean
  hunkSeparators: HunkSeparatorStyle
  lineHoverHighlight: LineHoverHighlight
  fontSize: number
  expandContextByDefault: boolean
  collapsedContextThreshold: number
  expansionLineCount: number
  /** Tactile feedback (web-haptics) on interaction. */
  haptics: boolean
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
  haptics: true,
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        setSettings({ ...DEFAULTS, ...data })
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      return next
    })
  }, [])

  return { settings, loaded, updateSettings }
}
