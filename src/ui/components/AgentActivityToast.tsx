import { useEffect } from 'react'
import { Bot, X } from 'lucide-react'
import type { AgentActivity } from '../hooks/useComments'

interface AgentActivityToastProps {
  activity: AgentActivity | null
  onDismiss: () => void
  onJump: (filePath: string) => void
}

export function AgentActivityToast({ activity, onDismiss, onJump }: AgentActivityToastProps) {
  useEffect(() => {
    if (!activity) return
    const timer = setTimeout(onDismiss, 8000)
    return () => clearTimeout(timer)
  }, [activity, onDismiss])

  if (!activity) return null

  const preview = activity.body.length > 120 ? `${activity.body.slice(0, 120)}…` : activity.body

  return (
    <div className="agent-toast" role="status" aria-live="polite">
      <button
        className="agent-toast-body"
        onClick={() => {
          onJump(activity.filePath)
          onDismiss()
        }}
        title="Jump to the file"
      >
        <span className="agent-toast-icon">
          <Bot size={16} />
        </span>
        <span className="agent-toast-text">
          <span className="agent-toast-title">
            Agent replied{activity.model ? ` · ${activity.model}` : ''}
          </span>
          <span className="agent-toast-file">{activity.filePath}</span>
          <span className="agent-toast-preview">{preview}</span>
        </span>
      </button>
      <button className="agent-toast-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}
