import { Dialog } from '@base-ui-components/react/dialog'
import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Size/look class applied to the popup (e.g. "shortcuts-modal"). */
  className?: string
  /** Accessible label when the popup has no visible heading. */
  ariaLabel?: string
  /** Where keyboard focus lands on open; defaults to Base UI's behaviour. */
  initialFocus?: React.RefObject<HTMLElement | null>
  /** Key handler on the popup (e.g. command-palette arrow / enter nav). */
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  children: ReactNode
}

/**
 * Bare modal surface built on Base UI's Dialog. Provides backdrop, focus trap,
 * scroll lock and Escape-to-close for free; callers render their own header /
 * body markup inside. This replaces the hand-rolled overlay + stopPropagation +
 * manual Escape listener pattern that each modal used to duplicate.
 */
export function Modal({ open, onClose, className, ariaLabel, initialFocus, onKeyDown, children }: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-modal-backdrop" />
        <Dialog.Popup
          className={`ui-modal-popup ${className ?? ''}`}
          aria-label={ariaLabel}
          initialFocus={initialFocus}
          onKeyDown={onKeyDown}
        >
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
