// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  formatModeLabel: (mode: string) => (mode === 'tui' ? 'TUI' : mode === 'web' ? 'Web' : mode),
}))

vi.mock('../lib/settings.js', () => settings)

import { runSubcommand } from '../cli-agent.js'

describe('mode subcommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settings.loadSettings.mockReturnValue({ defaultMode: 'web' })
    settings.saveSettings.mockImplementation((patch) => patch)
  })

  it('prints the current preference when no mode is provided', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    expect(await runSubcommand('mode', [])).toBe(0)
    expect(stdout).toHaveBeenCalledWith('web\n')

    stdout.mockRestore()
  })

  it.each([
    ['web', 'Web'],
    ['tui', 'TUI'],
  ] as const)('saves %s as the default mode', async (mode, label) => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    expect(await runSubcommand('mode', [mode])).toBe(0)
    expect(settings.saveSettings).toHaveBeenCalledWith({ defaultMode: mode })
    expect(stdout).toHaveBeenCalledWith(`Default mode set to ${label}.\n`)

    stdout.mockRestore()
  })

  it('rejects unsupported modes without changing settings', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await runSubcommand('mode', ['terminal'])).toBe(5)
    expect(settings.saveSettings).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith('Usage: diffing mode <web|tui>')

    stderr.mockRestore()
  })
})
