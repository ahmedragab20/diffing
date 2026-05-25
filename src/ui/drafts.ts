interface DraftEntry {
  body: string
  timestamp: number
}

const PREFIX = 'diffit-draft-'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

function makeKey(...parts: string[]): string {
  return PREFIX + parts.join(':')
}

export function getDraft(...parts: string[]): string | null {
  try {
    const raw = localStorage.getItem(makeKey(...parts))
    if (!raw) return null
    const entry: DraftEntry = JSON.parse(raw)
    if (Date.now() - entry.timestamp > TTL_MS) {
      localStorage.removeItem(makeKey(...parts))
      return null
    }
    return entry.body
  } catch {
    return null
  }
}

const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}

export function setDraft(body: string, ...parts: string[]): void {
  const key = makeKey(...parts)
  if (debounceTimers[key]) clearTimeout(debounceTimers[key])
  debounceTimers[key] = setTimeout(() => {
    saveDraftNow(body, ...parts)
    delete debounceTimers[key]
  }, 500)
}

export function saveDraftNow(body: string, ...parts: string[]): void {
  const key = makeKey(...parts)
  try {
    if (body.trim()) {
      localStorage.setItem(key, JSON.stringify({ body, timestamp: Date.now() }))
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    /* quota exceeded, ignore */
  }
}

export function clearDraft(...parts: string[]): void {
  try {
    localStorage.removeItem(makeKey(...parts))
  } catch {
    /* ignore */
  }
}
