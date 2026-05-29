import { Select as BaseSelect } from '@base-ui-components/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  ariaLabel?: string
  className?: string
}

/**
 * Compact Base UI Select — a tokenized, keyboard-accessible replacement for
 * native <select> in dense IDE chrome.
 */
export function Select({ value, onValueChange, options, ariaLabel, className }: SelectProps) {
  return (
    // modal={false} + alignItemWithTrigger={false}: these are the two flags that
    // gate Base UI's scroll lock. With either on, opening the Select sets
    // `body { overflow: hidden }`, the document scrollbar vanishes, and the whole
    // page (incl. the sticky toolbar) jumps ~8px — the "sub-dropdown layout shift".
    // Disabling both keeps the page scrollable and the layout rock-steady.
    <BaseSelect.Root value={value} onValueChange={(v) => onValueChange(v as string)} modal={false}>
      <BaseSelect.Trigger className={`ui-select-trigger ${className ?? ''}`} aria-label={ariaLabel}>
        <BaseSelect.Value>
          {(val: string) => options.find((o) => o.value === val)?.label ?? val}
        </BaseSelect.Value>
        <BaseSelect.Icon className="ui-select-icon">
          <ChevronsUpDown size={12} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="ui-select-positioner" sideOffset={4} align="end" side="bottom" alignItemWithTrigger={false}>
          <BaseSelect.Popup className="ui-select-popup">
            {options.map((o) => (
              <BaseSelect.Item key={o.value} value={o.value} className="ui-select-item">
                <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="ui-select-indicator">
                  <Check size={13} />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
