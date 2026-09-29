// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stdout } from 'node:process'
import { playStartupDisplay, renderStartupDisplay } from '../startup-display.js'
import { stripAnsi } from '../terminal.js'

const ttyDescriptor = Object.getOwnPropertyDescriptor(stdout, 'isTTY')
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs()
  if (ttyDescriptor) Object.defineProperty(stdout, 'isTTY', ttyDescriptor)
  else Reflect.deleteProperty(stdout, 'isTTY')
})

describe('startup display', () => {
  it.each([1, 8, 24, 40, 48, 80])('fits a %i-column terminal without cursor controls', (width) => {
    const output = renderStartupDisplay({ width, color: true })
    for (const line of stripAnsi(output).split('\n')) expect(line.length).toBeLessThanOrEqual(width)
    expect(output).not.toMatch(/\x1b\[(?:\?|\d*[AHJK])/)
  })

  it('prints nothing to a pipe', async () => {
    Object.defineProperty(stdout, 'isTTY', { configurable: true, value: false })
    const write = vi.spyOn(stdout, 'write').mockReturnValue(true)
    await playStartupDisplay()
    expect(write).not.toHaveBeenCalled()
  })

  it('honors NO_COLOR and never schedules animation timers', async () => {
    Object.defineProperty(stdout, 'isTTY', { configurable: true, value: true })
    vi.stubEnv('NO_COLOR', '1')
    const write = vi.spyOn(stdout, 'write').mockReturnValue(true)
    const timer = vi.spyOn(globalThis, 'setTimeout')
    await playStartupDisplay()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).not.toContain('\x1b')
    expect(timer).not.toHaveBeenCalled()
  })

  it('provides plain output for dumb terminals', () => {
    expect(renderStartupDisplay({ plain: true })).toBe('diffing  /  local code review\n')
  })
})
