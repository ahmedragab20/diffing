import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip'
import type { ReactElement, ReactNode } from 'react'

export const TooltipProvider = BaseTooltip.Provider

interface TooltipProps {
  /** The trigger element. Rendered as the tooltip anchor via Base UI's `render`. */
  children: ReactElement<Record<string, unknown>>
  content: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * Accessible tooltip on Base UI. Wrap the app once in <TooltipProvider> so
 * hovering between triggers shares a single open delay (IDE-like behaviour).
 */
export function Tooltip({ children, content, side = 'bottom' }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        {/* Positioner needs the z-index — sticky headers (toolbar, plan head)
            paint above a bare popup when only the popup carries z-index. */}
        <BaseTooltip.Positioner className="ui-tooltip-positioner" side={side} sideOffset={6}>
          <BaseTooltip.Popup className="ui-tooltip">{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
