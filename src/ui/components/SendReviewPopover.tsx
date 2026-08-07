import { useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import type { ReviewComment, ReviewDecision, ReviewMode } from '../../lib/types'
import { Popover } from '../primitives/Popover'
import { useSubmitPanelSize } from '../hooks/useSubmitPanelSize'
import { SendReviewPanel } from './SendReviewPanel'

interface SendReviewPopoverProps {
  comments: ReviewComment[]
  totalFileCount: number
  viewedFileCount: number
  requireViewAllBeforeSend: boolean
  onEditComment: (id: string, body: string) => void
  onDeleteComment: (id: string) => void
  onSend: (
    decision: ReviewDecision,
    generalComment?: string,
    mode?: ReviewMode,
    force?: boolean,
  ) => Promise<unknown>
  sending: boolean
  agentWaiting: boolean
  waitingAgents?: Array<{ id: string; model?: string; label?: string; connectedAt: number }>
  onCopyComments?: () => Promise<void>
  onCopyMarkdown?: () => Promise<void>
  /**
   * Controlled open state. When provided, the App (⌘Enter out of zen mode)
   * drives the popover instead of the trigger button alone.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Toolbar entry point for the "finish your review" flow. Thin wrapper: owns
 * the popover's open state (or defers to the controlled `open`/`onOpenChange`
 * pair used by ⌘Enter outside zen) and its trigger button; the shared
 * SendReviewPanel (also used by the zen-mode centered dialog) does all the work.
 */
export function SendReviewPopover({
  comments,
  totalFileCount,
  viewedFileCount,
  requireViewAllBeforeSend,
  onEditComment,
  onDeleteComment,
  onSend,
  sending,
  agentWaiting,
  waitingAgents = [],
  onCopyComments,
  onCopyMarkdown,
  open: openProp,
  onOpenChange,
}: SendReviewPopoverProps) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = openProp ?? localOpen
  const setOpen = (next: boolean) => {
    setLocalOpen(next)
    onOpenChange?.(next)
  }
  const { handleOpenChange } = useSubmitPanelSize()
  const count = comments.length
  // Landing focus on the Approve verdict (not the size presets) on open.
  const approveRef = useRef<HTMLButtonElement>(null)

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => handleOpenChange(next, details, setOpen)}
      ariaLabel="Submit your review to the agent"
      className="send-review-popover"
      initialFocus={approveRef}
      trigger={
        <button
          className="btn btn-primary btn-sm send-review-btn"
          disabled={sending}
          title={
            waitingAgents.length > 0
              ? `Waiting: ${waitingAgents.map((a) => a.label || a.model || a.id.slice(0, 8)).join(', ')}`
              : agentWaiting
                ? 'Agent waiting for your review'
                : 'Submit review to agent'
          }
          aria-label={
            sending
              ? 'Sending review'
              : count > 0
                ? `Send review with ${count} comment${count === 1 ? '' : 's'}`
                : 'Send review to agent'
          }
        >
          {agentWaiting && <span className="agent-waiting-dot" aria-hidden="true" />}
          <Bot size={14} aria-hidden="true" />
          <span className="btn-label">
            {sending
              ? 'Sending…'
              : waitingAgents.length > 1
                ? `Send (${waitingAgents.length})`
                : count > 0
                  ? `Send (${count})`
                  : 'Send review'}
          </span>
        </button>
      }
    >
      <SendReviewPanel
        comments={comments}
        totalFileCount={totalFileCount}
        viewedFileCount={viewedFileCount}
        requireViewAllBeforeSend={requireViewAllBeforeSend}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        onSend={onSend}
        sending={sending}
        agentWaiting={agentWaiting}
        waitingAgents={waitingAgents}
        onCopyComments={onCopyComments}
        onCopyMarkdown={onCopyMarkdown}
        onCancel={() => setOpen(false)}
        initialFocusRef={approveRef}
      />
    </Popover>
  )
}
