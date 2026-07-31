// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { shouldOfferFirstRunSetup, isCiEnvironment, formatFirstRunWelcome } from '../setup-first-run.js'

describe('setup-first-run gate', () => {
  it('offers setup when TTY, not CI, and marker missing', () => {
    expect(
      shouldOfferFirstRunSetup({
        isTTY: true,
        isStdinTTY: true,
        env: {},
        setupCompleted: false,
        skipSetup: false,
      }),
    ).toBe(true)
  })

  it('does not offer when setup completed', () => {
    expect(
      shouldOfferFirstRunSetup({
        isTTY: true,
        isStdinTTY: true,
        env: {},
        setupCompleted: true,
      }),
    ).toBe(false)
  })

  it('does not offer when --skip-setup', () => {
    expect(
      shouldOfferFirstRunSetup({
        isTTY: true,
        isStdinTTY: true,
        env: {},
        setupCompleted: false,
        skipSetup: true,
      }),
    ).toBe(false)
  })

  it('does not offer on non-TTY', () => {
    expect(
      shouldOfferFirstRunSetup({
        isTTY: false,
        isStdinTTY: false,
        env: {},
        setupCompleted: false,
      }),
    ).toBe(false)
  })

  it('does not offer in CI', () => {
    expect(isCiEnvironment({ CI: 'true' })).toBe(true)
    expect(
      shouldOfferFirstRunSetup({
        isTTY: true,
        isStdinTTY: true,
        env: { CI: 'true' },
        setupCompleted: false,
      }),
    ).toBe(false)
  })
})

describe('formatFirstRunWelcome', () => {
  it('renders plain welcome without color', () => {
    const welcome = formatFirstRunWelcome({ color: false })
    expect(welcome).toContain('Welcome')
    expect(welcome).toContain('Y Run setup now')
    expect(welcome).not.toMatch(/\x1b\[[0-9;]*m/)
  })
})
