import { useSyncExternalStore } from 'react'

/**
 * Minimal client-side router. diffing is a single-page app with exactly two
 * top-level surfaces — the diff review (`/`) and the plan review (`/plan`,
 * `/plan/:id`) — so a full router would be overkill. This tracks the pathname
 * via the History API and lets components navigate without a reload. The server
 * serves index.html for any non-API path, so deep links to `/plan/:id` work.
 */

const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const current = window.location.pathname + window.location.search
  if (to === current) return
  if (opts.replace) {
    window.history.replaceState(null, '', to)
  } else {
    window.history.pushState(null, '', to)
  }
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  window.addEventListener('popstate', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('popstate', cb)
  }
}

function getSnapshot(): string {
  return window.location.pathname
}

function getServerSnapshot(): string {
  return '/'
}

export function useRoutePath(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
