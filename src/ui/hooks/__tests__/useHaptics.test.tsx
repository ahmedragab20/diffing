import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HapticsProvider } from '../useHaptics'

afterEach(cleanup)

describe('HapticsProvider', () => {
  it('keeps the haptic switch fallback click from reaching document listeners', () => {
    // jsdom has no navigator.vibrate, like Safari: web-haptics falls back to
    // clicking a hidden <label> in <body>. Popovers treat that click as an
    // outside press and close, so it must never reach document listeners.
    const seen: string[] = []
    const record = (e: MouseEvent) => seen.push((e.target as HTMLElement).tagName)
    document.addEventListener('click', record, true)
    try {
      render(
        <HapticsProvider enabled soundsEnabled={false}>
          <button type="button">Approve</button>
        </HapticsProvider>,
      )
      screen.getByRole('button', { name: 'Approve' }).click()
      expect(document.querySelector('label[for^="web-haptics-"]')).not.toBeNull()
      expect(seen).toEqual(['BUTTON'])
    } finally {
      document.removeEventListener('click', record, true)
    }
  })
})
