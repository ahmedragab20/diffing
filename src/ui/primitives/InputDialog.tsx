import { useEffect, useId, useRef, useState } from 'react'
import { PencilLine } from 'lucide-react'
import { Modal } from './Modal'

interface InputDialogProps {
  open: boolean
  title: string
  description?: string
  label: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  maxLength?: number
  onConfirm: (value: string) => void
  onCancel: () => void
}

/** Design-system text-entry dialog for short, blocking naming flows. */
export function InputDialog({
  open,
  title,
  description,
  label,
  initialValue = '',
  placeholder,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  maxLength,
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [initialValue, open])

  const submit = () => {
    const trimmed = value.trim()
    if (trimmed) onConfirm(trimmed)
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      className="confirm-dialog input-dialog"
      ariaLabel={title}
      initialFocus={inputRef}
    >
      <div className="confirm-dialog-header">
        <span className="confirm-dialog-icon confirm-dialog-icon-primary" aria-hidden="true">
          <PencilLine size={18} />
        </span>
        <h2 className="confirm-dialog-title">{title}</h2>
      </div>
      {description && <p className="confirm-dialog-desc">{description}</p>}
      <form
        className="input-dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label className="input-dialog-label" htmlFor={inputId}>
          {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="input-dialog-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
        />
        <div className="confirm-dialog-footer">
          <button type="button" className="btn btn-sm confirm-dialog-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="btn btn-sm confirm-dialog-confirm confirm-dialog-confirm-primary"
            disabled={!value.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
