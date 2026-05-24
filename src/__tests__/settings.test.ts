// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockHomedir = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, homedir: mockHomedir }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync, mkdirSync: mockMkdirSync }
})

const DEFAULTS = {
  staged: true,
  untracked: true,
  diffStyle: 'split' as const,
  defaultTabSize: 4,
  theme: 'nord',
}

describe('settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHomedir.mockReturnValue('/home/test')
  })

  describe('loadSettings', () => {
    it('returns defaults when file missing', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT') })
      const { loadSettings } = await import('../settings.js')
      expect(loadSettings()).toEqual(DEFAULTS)
    })

    it('merges persisted values with defaults', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ staged: false, defaultTabSize: 2 }))
      const { loadSettings } = await import('../settings.js')
      expect(loadSettings()).toEqual({ ...DEFAULTS, staged: false, defaultTabSize: 2 })
    })

    it('preserves browser setting', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ browser: 'firefox' }))
      const { loadSettings } = await import('../settings.js')
      expect(loadSettings().browser).toBe('firefox')
    })
  })

  describe('saveSettings', () => {
    it('merges partial and writes config', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(DEFAULTS))
      const { saveSettings } = await import('../settings.js')

      const result = saveSettings({ staged: false })
      expect(result.staged).toBe(false)
      expect(result.untracked).toBe(true)
      expect(mockMkdirSync).toHaveBeenCalledWith('/home/test/.config/diffit', { recursive: true })
      expect(mockWriteFileSync).toHaveBeenCalled()
    })

    it('preserves existing fields when merging', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ defaultTabSize: 8 }))
      const { saveSettings } = await import('../settings.js')

      const result = saveSettings({ diffStyle: 'unified' })
      expect(result.defaultTabSize).toBe(8)
      expect(result.diffStyle).toBe('unified')
      expect(result.staged).toBe(true)
    })
  })
})
