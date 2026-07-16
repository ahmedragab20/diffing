import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { getUiStateItem, setUiStateItem } from '../utils/uiState'

/**
 * Persisted height (in px) of the three "submit" popovers (SendReview,
 * SubmitPlanReview, SubmitToGitHub). All three read/write the same key, so
 * resizing one panel remembers the size for the other two — a single mental
 * model and one source of truth on the server.
 */
export const SUBMIT_PANEL_SIZE_KEY = 'diffing-submit-panel-height'

/**
 * Persisted width (in px) of the three "submit" popovers. Same sharing model
 * as `SUBMIT_PANEL_SIZE_KEY`: one key, all three popovers, single mental model.
 */
export const SUBMIT_PANEL_WIDTH_KEY = 'diffing-submit-panel-width'

export const SUBMIT_PANEL_MIN = 280
export const SUBMIT_PANEL_MAX = 760

export const SUBMIT_PANEL_MIN_WIDTH = 360
export const SUBMIT_PANEL_MAX_WIDTH = 720

export interface SubmitPanelPreset {
  label: string
  width: number
  height: number
}

export const SUBMIT_PANEL_PRESETS: SubmitPanelPreset[] = [
  { label: 'S',  width: 420, height: 340 },
  { label: 'M',  width: 480, height: 440 },
  { label: 'L',  width: 560, height: 560 },
  { label: 'XL', width: 640, height: SUBMIT_PANEL_MAX },
]

const DEFAULT_HEIGHT = 480
const DEFAULT_WIDTH = 520

function clampHeight(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HEIGHT
  return Math.max(SUBMIT_PANEL_MIN, Math.min(SUBMIT_PANEL_MAX, value))
}

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WIDTH
  return Math.max(SUBMIT_PANEL_MIN_WIDTH, Math.min(SUBMIT_PANEL_MAX_WIDTH, value))
}

function loadStoredHeight(): number {
  const raw = getUiStateItem(SUBMIT_PANEL_SIZE_KEY)
  if (raw === null || raw === undefined) return DEFAULT_HEIGHT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_HEIGHT
  return clampHeight(parsed)
}

function loadStoredWidth(): number {
  const raw = getUiStateItem(SUBMIT_PANEL_WIDTH_KEY)
  if (raw === null || raw === undefined) return DEFAULT_WIDTH
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_WIDTH
  return clampWidth(parsed)
}

export interface UseSubmitPanelSize {
  /** Current height in px. Spread as a style on the panel root. */
  height: number
  /** Current width in px. Spread as a style on the panel root. */
  width: number
  /** Imperative setter; clamps and persists. */
  setHeight: (next: number) => void
  /** Imperative setter; clamps and persists. */
  setWidth: (next: number) => void
  /** Set height to a preset value; convenience over `setHeight`. */
  applyPreset: (preset: SubmitPanelPreset) => void
  /** Index of the preset whose value matches `height` (±1px tolerance), or -1. */
  activePreset: number
  /** `onMouseDown` handler for the bottom resize handle. */
  startResize: (e: MouseEvent) => void
  /** `onMouseDown` handler for the left width resize handle. */
  startLeftResize: (e: MouseEvent) => void
  /** CSS var style object to spread on the panel root (`--submit-panel-height`, `--submit-panel-width`). */
  popoverStyle: CSSProperties
  /** Ref to attach to the panel root element so the resize drag can write the
   *  CSS var directly to it (bypassing React reconciliation on every frame). */
  panelRef: React.RefObject<HTMLDivElement>
}

/**
 * Shared state + drag logic for the three "submit" popovers. The hook owns
 * the persisted height, exposes a `popoverStyle` (CSS var) and a `startResize`
 * handler to wire to a bottom handle, and lets the header render a row of
 * preset buttons (`applyPreset` / `activePreset`).
 */
export function useSubmitPanelSize(): UseSubmitPanelSize {
  // Lazy initializer — reads once at mount so a stored-but-out-of-bounds value
  // is clamped to a safe starting point before the first paint.
  const [height, setHeightState] = useState<number>(() => loadStoredHeight())
  const [width, setWidthState] = useState<number>(() => loadStoredWidth())
  const panelRef = useRef<HTMLDivElement>(null)
  // Mirror of `height` that the resize handler can read on every mousemove
  // without re-binding the global listeners when state changes.
  const heightRef = useRef(height)
  heightRef.current = height
  // Mirror of `width` used by the left-resize handler.
  const widthRef = useRef(width)
  widthRef.current = width

  const setHeight = useCallback((next: number) => {
    const clamped = clampHeight(next)
    setHeightState(clamped)
    // `setUiStateItem` already coalesces writes with a 200ms debounce, so
    // firing it on every state change is safe.
    setUiStateItem(SUBMIT_PANEL_SIZE_KEY, String(clamped))
  }, [])

  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next)
    setWidthState(clamped)
    setUiStateItem(SUBMIT_PANEL_WIDTH_KEY, String(clamped))
  }, [])

  const applyPreset = useCallback(
    (preset: SubmitPanelPreset) => {
      setWidth(preset.width)
      setHeight(preset.height)
    },
    [setWidth, setHeight],
  )

  const activePreset = (() => {
    for (let i = 0; i < SUBMIT_PANEL_PRESETS.length; i++) {
      const p = SUBMIT_PANEL_PRESETS[i]!
      if (Math.abs(height - p.height) < 1 && Math.abs(width - p.width) < 1) return i
    }
    return -1
  })()

  const startResize = useCallback((e: MouseEvent) => {
    e.preventDefault()
    const target = panelRef.current
    if (!target) return
    const startY = e.clientY
    const startHeight = heightRef.current
    let latest = startHeight
    let rafId = 0

    const flush = () => {
      rafId = 0
      target.style.setProperty('--submit-panel-height', `${latest}px`)
    }

    const handleMove = (ev: MouseEvent) => {
      // Bottom handle: dragging DOWN (larger clientY) grows the panel.
      const delta = ev.clientY - startY
      latest = clampHeight(startHeight + delta)
      if (!rafId) rafId = requestAnimationFrame(flush)
    }

    const handleUp = () => {
      if (rafId) cancelAnimationFrame(rafId)
      setHeightState(latest)
      setUiStateItem(SUBMIT_PANEL_SIZE_KEY, String(latest))
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const startLeftResize = useCallback((e: MouseEvent) => {
    e.preventDefault()
    const target = panelRef.current
    if (!target) return
    const startX = e.clientX
    const startWidth = widthRef.current
    let latest = startWidth
    let rafId = 0

    const flush = () => {
      rafId = 0
      target.style.setProperty('--submit-panel-width', `${latest}px`)
    }

    const handleMove = (ev: MouseEvent) => {
      // Left handle: dragging LEFT (smaller clientX) → positive delta → width grows.
      const delta = startX - ev.clientX
      latest = clampWidth(startWidth + delta)
      if (!rafId) rafId = requestAnimationFrame(flush)
    }

    const handleUp = () => {
      if (rafId) cancelAnimationFrame(rafId)
      setWidthState(latest)
      setUiStateItem(SUBMIT_PANEL_WIDTH_KEY, String(latest))
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // Cleanup on unmount: if a drag is in flight, restore the body styles
  // (listeners are on `document` and will be GC'd with the closure, but
  // body.style would otherwise stay stuck on `row-resize`).
  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const popoverStyle: CSSProperties = {
    ['--submit-panel-height' as never]: `${height}px`,
    ['--submit-panel-width' as never]: `${width}px`,
  } as CSSProperties

  return { height, width, setHeight, setWidth, applyPreset, activePreset, startResize, startLeftResize, popoverStyle, panelRef }
}
