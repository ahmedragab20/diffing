import { useEffect, useState } from 'react'
import { Bot, X } from 'lucide-react'
import { subscribeLive } from '../live'

export interface AgentProgressEvent {
  at: number
  message: string
  model?: string
  agentId?: string
  commentId?: string
  pct?: number
}

/**
 * Live toast for agent progress reports (`POST /api/agent/progress` → SSE).
 */
export function AgentProgressToast() {
  const [event, setEvent] = useState<AgentProgressEvent | null>(null)

  useEffect(() => {
    return subscribeLive('agent-progress', (data) => {
      try {
        setEvent(JSON.parse(data) as AgentProgressEvent)
      } catch {
        /* ignore */
      }
    })
  }, [])

  useEffect(() => {
    if (!event) return
    const t = setTimeout(() => setEvent(null), 10000)
    return () => clearTimeout(t)
  }, [event])

  if (!event) return null

  return (
    <div className="agent-progress-toast" role="status" aria-live="polite">
      <div className="agent-progress-toast-icon">
        <Bot size={16} />
      </div>
      <div className="agent-progress-toast-body">
        <div className="agent-progress-toast-title">
          {event.model || event.agentId || 'Agent'}
          {event.pct != null && (
            <span className="agent-progress-toast-pct">{Math.round(event.pct)}%</span>
          )}
        </div>
        <div className="agent-progress-toast-msg">{event.message}</div>
        {event.pct != null && (
          <div className="agent-progress-bar" aria-hidden="true">
            <div className="agent-progress-bar-fill" style={{ width: `${event.pct}%` }} />
          </div>
        )}
      </div>
      <button
        type="button"
        className="agent-progress-toast-close"
        onClick={() => setEvent(null)}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}
