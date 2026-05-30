let globalUiState: Record<string, any> = {}

export async function initUiState(): Promise<void> {
  try {
    const res = await fetch('/api/ui-state')
    if (res.ok) {
      globalUiState = await res.json()
    }
  } catch (err) {
    console.error('Failed to load UI state:', err)
  }
}

export function getUiStateItem(key: string): string | null {
  const val = globalUiState[key]
  if (val === undefined || val === null) return null
  return String(val)
}

let pendingUpdates: Record<string, any> = {}
let saveTimeout: NodeJS.Timeout | null = null

function flushUpdates() {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
  const updates = { ...pendingUpdates }
  pendingUpdates = {}

  fetch('/api/ui-state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }).catch((err) => {
    console.error('Failed to save UI state:', err)
  })
}

export function setUiStateItem(key: string, value: string): void {
  globalUiState[key] = value
  pendingUpdates[key] = value

  if (!saveTimeout) {
    saveTimeout = setTimeout(flushUpdates, 200)
  }
}

export function removeUiStateItem(key: string): void {
  delete globalUiState[key]
  pendingUpdates[key] = null

  if (!saveTimeout) {
    saveTimeout = setTimeout(flushUpdates, 200)
  }
}
