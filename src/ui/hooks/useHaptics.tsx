import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useWebHaptics } from 'web-haptics/react'

/** Named feedback presets shipped by web-haptics. */
export type HapticPreset =
  | 'success'
  | 'warning'
  | 'error'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'soft'
  | 'rigid'
  | 'selection'
  | 'nudge'

interface HapticsContextValue {
  /** Whether haptics are both enabled in settings and supported by the device. */
  enabled: boolean
  /** Fire a feedback preset. No-ops when disabled/unsupported. */
  haptic: (preset?: HapticPreset) => void
}

const HapticsContext = createContext<HapticsContextValue>({
  enabled: false,
  haptic: () => {},
})

/**
 * Wires lochie/web-haptics into the app. A single delegated click listener
 * gives every button / link a subtle tap so the whole UI feels tactile without
 * threading a handler through each control; richer presets are available via
 * `useHaptic()` for explicit moments (resolve, send, errors). The whole thing
 * is gated by the `enabled` setting and the device's actual support.
 */
export function HapticsProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const { trigger, isSupported } = useWebHaptics({ showSwitch: false })

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const triggerRef = useRef(trigger)
  triggerRef.current = trigger

  const haptic = useMemo<HapticsContextValue['haptic']>(
    () => (preset = 'selection') => {
      if (!enabledRef.current) return
      try {
        triggerRef.current(preset)
      } catch {
        /* vibration can throw if blocked by the platform — ignore */
      }
    },
    [],
  )

  useEffect(() => {
    if (!enabled) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const el = target?.closest<HTMLElement>(
        'button, a[href], [role="button"], input[type="checkbox"]',
      )
      if (!el || (el as HTMLButtonElement).disabled) return
      try {
        triggerRef.current('selection')
      } catch {
        /* ignore */
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [enabled])

  const value = useMemo<HapticsContextValue>(
    () => ({ enabled: enabled && isSupported, haptic }),
    [enabled, isSupported, haptic],
  )

  return <HapticsContext.Provider value={value}>{children}</HapticsContext.Provider>
}

/** Returns a stable `haptic(preset)` trigger. Safe to call when disabled. */
export function useHaptic() {
  return useContext(HapticsContext).haptic
}
