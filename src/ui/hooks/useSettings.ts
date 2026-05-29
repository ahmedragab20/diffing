import { useState, useEffect, useCallback, useRef } from 'react'

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
  /** Synthesized audio feedback on interaction. */
  sounds: boolean
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
  sounds: true,
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  // Skip persisting the very first state we hydrate from the server.
  const skipPersistRef = useRef(true)

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        skipPersistRef.current = true
        setSettings({ ...DEFAULTS, ...data })
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  // Persist settings whenever they change, debounced. Keeping the network
  // write out of the state updater keeps the updater pure (no double PUT in
  // StrictMode) and coalesces rapid changes (e.g. dragging font size).
  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    const id = setTimeout(() => {
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }).catch(() => {})
    }, 300)
    return () => clearTimeout(id)
  }, [settings])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  return { settings, loaded, updateSettings }
}
