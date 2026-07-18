import { AlertTriangle } from 'lucide-react'
import { Modal } from './Modal'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  /** Preview snippet shown in a muted block (e.g. draft quote). */
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  /**
   * Visual weight of the confirm action.
   * `danger` for discard/delete, `primary` for generic continues.
   */
  variant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Design-system confirm dialog (replaces `window.confirm`).
 * Uses the shared Modal surface + app button tokens.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} className="confirm-dialog" ariaLabel={title}>
      <div className="confirm-dialog-header">
        <span className={`confirm-dialog-icon confirm-dialog-icon-${variant}`} aria-hidden="true">
          <AlertTriangle size={18} />
        </span>
        <h2 className="confirm-dialog-title">{title}</h2>
      </div>
      {description && <p className="confirm-dialog-desc">{description}</p>}
      {detail?.trim() && (
        <blockquote className="confirm-dialog-detail" title={detail}>
          {detail.trim()}
        </blockquote>
      )}
      <div className="confirm-dialog-footer">
        <button type="button" className="btn btn-sm confirm-dialog-cancel" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn btn-sm confirm-dialog-confirm confirm-dialog-confirm-${variant}`}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
