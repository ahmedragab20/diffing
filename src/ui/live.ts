/**
 * Shared live channel over a single Server-Sent Events connection.
 *
 * diffit's UI and any connected agent talk over one stable, named-event
 * protocol on `/api/live`:
 *   - `change`    the working tree / git state changed → re-read the diff
 *   - `comments`  the comment store changed (a user or agent added / replied /
 *                 resolved / deleted) → re-read comments
 *   - `agent-status` an agent connected to / disconnected from the review
 *                 handoff, or a new round was sent → update the "Send to agent"
 *                 button state
 *   - `heartbeat` keep-alive, ignored by subscribers
 *
 * One EventSource is shared across the whole app (lazily opened on first
 * subscribe, closed when the last subscriber leaves) so multiple hooks don't
 * each hold their own socket.
 */

export type LiveEvent = 'change' | 'comments' | 'agent-status' | 'heartbeat'

type Handler = (data: string) => void

const handlers = new Map<LiveEvent, Set<Handler>>()
let source: EventSource | null = null

function ensureConnected() {
  if (source || typeof EventSource === 'undefined') return
  source = new EventSource('/api/live')
  for (const event of handlers.keys()) {
    attach(event)
  }
}

function attach(event: LiveEvent) {
  source?.addEventListener(event, (e) => {
    const data = (e as MessageEvent).data as string
    for (const handler of handlers.get(event) ?? []) {
      try {
        handler(data)
      } catch (err) {
        console.error(`live channel handler for "${event}" threw:`, err)
      }
    }
  })
}

function maybeDisconnect() {
  const empty = [...handlers.values()].every((set) => set.size === 0)
  if (empty && source) {
    source.close()
    source = null
  }
}

/** Subscribe to a named live event. Returns an unsubscribe function. */
export function subscribeLive(event: LiveEvent, handler: Handler): () => void {
  let set = handlers.get(event)
  if (!set) {
    set = new Set()
    handlers.set(event, set)
    if (source) attach(event)
  }
  set.add(handler)
  ensureConnected()

  return () => {
    set!.delete(handler)
    maybeDisconnect()
  }
}
