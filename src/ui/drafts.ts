import { getUiStateItem, setUiStateItem, removeUiStateItem } from './utils/uiState'

interface DraftEntry {
  body: string
  timestamp: number
}

const PREFIX = 'diffing-draft-'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

function makeKey(...parts: string[]): string {
  return PREFIX + parts.join(':')
}

const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}
/** Latest body per key while its debounced write is still pending. */
const pendingBodies: Record<string, string> = {}

export function getDraft(...parts: string[]): string | null {
  const key = makeKey(...parts)
  if (key in pendingBodies) return pendingBodies[key] || null
  try {
    const raw = getUiStateItem(makeKey(...parts))
    if (!raw) return null
    const entry: DraftEntry = JSON.parse(raw)
    if (Date.now() - entry.timestamp > TTL_MS) {
      removeUiStateItem(makeKey(...parts))
      return null
    }
    return entry.body
  } catch {
    return null
  }
}

function cancelPending(key: string): void {
  if (debounceTimers[key]) clearTimeout(debounceTimers[key])
  delete debounceTimers[key]
  delete pendingBodies[key]
}

export function setDraft(body: string, ...parts: string[]): void {
  const key = makeKey(...parts)
  if (debounceTimers[key]) clearTimeout(debounceTimers[key])
  pendingBodies[key] = body
  debounceTimers[key] = setTimeout(() => {
    saveDraftNow(body, ...parts)
  }, 500)
}

export function saveDraftNow(body: string, ...parts: string[]): void {
  const key = makeKey(...parts)
  cancelPending(key)
  try {
    if (body.trim()) {
      setUiStateItem(key, JSON.stringify({ body, timestamp: Date.now() }))
    } else {
      removeUiStateItem(key)
    }
  } catch {
    /* ignore */
  }
}

export function clearDraft(...parts: string[]): void {
  const key = makeKey(...parts)
  // A pending debounced write would otherwise resurrect the cleared draft.
  cancelPending(key)
  try {
    removeUiStateItem(key)
  } catch {
    /* ignore */
  }
}

