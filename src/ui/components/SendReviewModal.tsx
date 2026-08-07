import { useRef } from 'react'
import { Modal } from '../primitives/Modal'
import { SendReviewPanel, type SendReviewPanelProps } from './SendReviewPanel'

interface SendReviewModalProps extends Omit<SendReviewPanelProps, 'onCancel' | 'showLeftResize'> {
  open: boolean
  onClose: () => void
}

/**
 * Centered dialog variant of the "finish your review" flow, opened with
 * ⌘Enter (Cmd/Ctrl+Enter) — available in every diffs-page mode, including zen
 * where the toolbar (and its Send button) is hidden. Mounted conditionally by
 * the App so each open starts with a fresh panel. Resizing reuses the same
 * useSubmitPanelSize state as the toolbar popover (bottom + corner handles;
 * no left handle on a centered dialog).
 */
export function SendReviewModal({ open, onClose, ...panelProps }: SendReviewModalProps) {
  const approveRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      open={open}
      onClose={onClose}
      className="send-review-modal"
      ariaLabel="Submit your review to the agent"
      initialFocus={approveRef}
    >
      <SendReviewPanel {...panelProps} onCancel={onClose} showLeftResize={false} initialFocusRef={approveRef} />
    </Modal>
  )
}
