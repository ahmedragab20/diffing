import { useRef, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Modal } from './Modal'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  /** Preview snippet shown in a muted block (e.g. draft quote). */
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  busyLabel?: string
  /**
   * Visual weight of the confirm action.
   * `danger` for discard/delete, `warning` for bypasses, `primary` otherwise.
   */
  variant?: 'danger' | 'primary' | 'warning'
  icon?: ReactNode
  busy?: boolean
  error?: string | null
  onConfirm: () => void | Promise<void>
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
  busyLabel = 'Working…',
  variant = 'danger',
  icon,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onCancel()
      }}
      className="confirm-dialog"
      ariaLabel={title}
      initialFocus={cancelRef}
      role="alertdialog"
      ariaBusy={busy}
    >
      <div className="confirm-dialog-header">
        <span className={`confirm-dialog-icon confirm-dialog-icon-${variant}`} aria-hidden="true">
          {icon ?? <AlertTriangle size={18} />}
        </span>
        <h2 className="confirm-dialog-title">{title}</h2>
      </div>
      {description && <p className="confirm-dialog-desc">{description}</p>}
      {detail?.trim() && (
        <blockquote className="confirm-dialog-detail" title={detail}>
          {detail.trim()}
        </blockquote>
      )}
      {error && (
        <p className="confirm-dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-dialog-footer">
        <button
          ref={cancelRef}
          type="button"
          className="btn btn-sm confirm-dialog-cancel"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn btn-sm confirm-dialog-confirm confirm-dialog-confirm-${variant}`}
          onClick={() => void onConfirm()}
          disabled={busy}
        >
          {busy && <Loader2 size={13} className="spin" aria-hidden="true" />}
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
