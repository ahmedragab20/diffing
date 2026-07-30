import { useRef } from 'react'
import { CircleAlert } from 'lucide-react'
import { Modal } from './Modal'

interface NoticeDialogProps {
  open: boolean
  title: string
  description: string
  closeLabel?: string
  tone?: 'danger' | 'warning' | 'primary'
  onClose: () => void
}

/** Design-system acknowledgement dialog for errors and blocking notices. */
export function NoticeDialog({
  open,
  title,
  description,
  closeLabel = 'Close',
  tone = 'danger',
  onClose,
}: NoticeDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="confirm-dialog notice-dialog"
      ariaLabel={title}
      role="alertdialog"
      initialFocus={closeRef}
    >
      <div className="confirm-dialog-header">
        <span className={`confirm-dialog-icon confirm-dialog-icon-${tone}`} aria-hidden="true">
          <CircleAlert size={18} />
        </span>
        <h2 className="confirm-dialog-title">{title}</h2>
      </div>
      <p className="confirm-dialog-desc">{description}</p>
      <div className="confirm-dialog-footer">
        <button
          ref={closeRef}
          type="button"
          className="btn btn-sm confirm-dialog-confirm confirm-dialog-confirm-primary"
          onClick={onClose}
        >
          {closeLabel}
        </button>
      </div>
    </Modal>
  )
}
