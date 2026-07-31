// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatPostinstallBanner, shouldPrintPostinstallBanner } from '../postinstall-banner.js'

describe('postinstall banner', () => {
  it('is quiet in CI', () => {
    expect(shouldPrintPostinstallBanner({ CI: 'true' }, true)).toBe(false)
  })

  it('is quiet when stdout is not a TTY', () => {
    expect(shouldPrintPostinstallBanner({}, false)).toBe(false)
  })

  it('prints on interactive local installs', () => {
    expect(shouldPrintPostinstallBanner({}, true)).toBe(true)
    const banner = formatPostinstallBanner('1.2.3', { color: false })
    expect(banner).toContain('diffing v1.2.3 installed')
    expect(banner).toContain('diffing setup')
    expect(banner).not.toMatch(/\x1b\[[0-9;]*m/)
  })

  it('can render with color', () => {
    const banner = formatPostinstallBanner('1.0.0', { color: true })
    expect(banner).toMatch(/\x1b\[[0-9;]*m/)
  })
})
