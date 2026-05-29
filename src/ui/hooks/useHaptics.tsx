import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useWebHaptics } from 'web-haptics/react'

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

export type SoundPreset =
  | 'click'
  | 'toggle'
  | 'navigate'
  | 'open'
  | 'close'
  | 'success'
  | 'resolve'
  | 'send'
  | 'error'
  | 'warning'
  | 'remove'

interface FeedbackContextValue {
  hapticsEnabled: boolean
  soundsEnabled: boolean
  haptic: (preset?: HapticPreset) => void
  sound: (preset?: SoundPreset) => void
}

const FeedbackContext = createContext<FeedbackContextValue>({
  hapticsEnabled: false,
  soundsEnabled: false,
  haptic: () => {},
  sound: () => {},
})

// ─── Audio synthesis ──────────────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (_audioCtx) return _audioCtx
  try {
    _audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  } catch {
    _audioCtx = null
  }
  return _audioCtx
}

function synth(ctx: AudioContext, preset: SoundPreset) {
  const t = ctx.currentTime
  const d = ctx.destination

  const note = (
    freq: number,
    type: OscillatorType,
    vol: number,
    delay: number,
    dur: number,
    freqEnd?: number,
  ) => {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.connect(g)
    g.connect(d)
    osc.type = type
    osc.frequency.setValueAtTime(freq, t + delay)
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, t + delay + dur)
    }
    g.gain.setValueAtTime(vol, t + delay)
    g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur)
    osc.start(t + delay)
    osc.stop(t + delay + dur)
  }

  switch (preset) {
    case 'click':
      note(700, 'sine', 0.16, 0, 0.03, 350)
      break
    case 'toggle':
      note(460, 'square', 0.06, 0, 0.04, 230)
      break
    case 'navigate':
      note(520, 'sine', 0.07, 0, 0.02)
      break
    case 'open':
      note(210, 'sine', 0.12, 0, 0.13, 560)
      break
    case 'close':
      note(560, 'sine', 0.10, 0, 0.11, 210)
      break
    case 'success':
      note(523, 'sine', 0.17, 0, 0.10)      // C5
      note(784, 'sine', 0.17, 0.09, 0.13)   // G5
      break
    case 'resolve':
      note(659, 'sine', 0.15, 0, 0.10)      // E5
      note(988, 'sine', 0.15, 0.09, 0.13)   // B5
      break
    case 'send':
      note(523, 'sine', 0.15, 0,    0.10)   // C5
      note(659, 'sine', 0.15, 0.07, 0.10)   // E5
      note(784, 'sine', 0.15, 0.14, 0.14)   // G5
      break
    case 'error':
      note(280, 'sawtooth', 0.16, 0, 0.15, 80)
      break
    case 'warning':
      note(330, 'sine', 0.13, 0,    0.09)
      note(330, 'sine', 0.09, 0.12, 0.09)
      break
    case 'remove':
      note(380, 'sine', 0.13, 0, 0.08, 140)
      break
  }
}

// ─── Module-level imperative API (callable outside React tree) ────────────────

// These refs are kept in sync by HapticsProvider so other modules can call
// playSound / fireHaptic without needing the React context.
const _soundEnabled = { current: false }
const _hapticsEnabled = { current: false }
let _vibrate: ((p: HapticPreset) => void) | null = null

export function playSound(preset: SoundPreset = 'click') {
  if (!_soundEnabled.current) return
  const ctx = getAudioCtx()
  if (!ctx) return
  const work = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
  work.then(() => { try { synth(ctx, preset) } catch {} }).catch(() => {})
}

export function fireHaptic(preset: HapticPreset = 'selection') {
  if (!_hapticsEnabled.current || !_vibrate) return
  try { _vibrate(preset) } catch {}
}

/** Fire both haptic and sound. Safe to call anywhere — no-ops when disabled. */
export function fireFeedback(hapticPreset: HapticPreset = 'selection', soundPreset: SoundPreset = 'click') {
  fireHaptic(hapticPreset)
  playSound(soundPreset)
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function HapticsProvider({
  enabled,
  soundsEnabled,
  children,
}: {
  enabled: boolean
  soundsEnabled: boolean
  children: ReactNode
}) {
  const { trigger, isSupported } = useWebHaptics({ showSwitch: false })

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const soundsRef = useRef(soundsEnabled)
  soundsRef.current = soundsEnabled
  const triggerRef = useRef(trigger)
  triggerRef.current = trigger

  // Keep module-level refs in sync so the imperative API works
  useEffect(() => {
    _hapticsEnabled.current = enabled && isSupported
    _vibrate = trigger
  })
  useEffect(() => {
    _soundEnabled.current = soundsEnabled
  })

  const haptic = useMemo<FeedbackContextValue['haptic']>(
    () => (preset = 'selection') => {
      if (!enabledRef.current) return
      try { triggerRef.current(preset) } catch {}
    },
    [],
  )

  const sound = useMemo<FeedbackContextValue['sound']>(
    () => (preset = 'click') => {
      if (!soundsRef.current) return
      const ctx = getAudioCtx()
      if (!ctx) return
      const work = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
      work.then(() => { try { synth(ctx, preset) } catch {} }).catch(() => {})
    },
    [],
  )

  // Delegated listener — every interactive element gets a tap + sound on click
  useEffect(() => {
    if (!enabled && !soundsEnabled) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const el = target?.closest<HTMLElement>(
        'button, a[href], [role="button"], input[type="checkbox"], [role="option"]',
      )
      if (!el || (el as HTMLButtonElement).disabled) return
      const isCheckbox = el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox'
      if (enabledRef.current) {
        try { triggerRef.current('selection') } catch {}
      }
      if (soundsRef.current) {
        const ctx = getAudioCtx()
        if (ctx) {
          const work = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
          work.then(() => { try { synth(ctx, isCheckbox ? 'toggle' : 'click') } catch {} }).catch(() => {})
        }
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [enabled, soundsEnabled])

  const value = useMemo<FeedbackContextValue>(
    () => ({
      hapticsEnabled: enabled && isSupported,
      soundsEnabled,
      haptic,
      sound,
    }),
    [enabled, isSupported, soundsEnabled, haptic, sound],
  )

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useHaptic() {
  return useContext(FeedbackContext).haptic
}

export function useSound() {
  return useContext(FeedbackContext).sound
}

export function useFeedback() {
  const { haptic, sound } = useContext(FeedbackContext)
  return { haptic, sound }
}
