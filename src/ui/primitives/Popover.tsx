import { Popover as BasePopover } from '@base-ui-components/react/popover'
import type { ReactElement, ReactNode } from 'react'

interface PopoverProps {
  trigger: ReactElement<Record<string, unknown>>
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  className?: string
  ariaLabel?: string
}

/**
 * Anchored content panel on Base UI's Popover. Handles outside-click, Escape,
 * focus management and positioning, replacing the hand-rolled dropdown +
 * mousedown-outside listeners the toolbar used to carry.
 */
export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'end',
  className,
  ariaLabel,
}: PopoverProps) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner className="ui-popover-positioner" side={side} align={align} sideOffset={8}>
          <BasePopover.Popup className={`ui-popover ${className ?? ''}`} aria-label={ariaLabel}>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}

export const PopoverClose = BasePopover.Close
