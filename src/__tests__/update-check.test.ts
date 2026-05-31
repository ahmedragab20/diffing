// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isNewerVersion, checkForUpdates } from '../lib/update-check.js'

describe('update-check', () => {
  describe('isNewerVersion', () => {
    it('returns true if latest major version is higher', () => {
      expect(isNewerVersion('0.2.0', '1.0.0')).toBe(true)
      expect(isNewerVersion('v0.2.0', 'v1.0.0')).toBe(true)
    })

    it('returns true if latest minor version is higher', () => {
      expect(isNewerVersion('0.2.0', '0.3.0')).toBe(true)
    })

    it('returns true if latest patch version is higher', () => {
      expect(isNewerVersion('0.2.0', '0.2.1')).toBe(true)
    })

    it('returns false if versions are identical', () => {
      expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false)
      expect(isNewerVersion('v0.2.0', '0.2.0')).toBe(false)
    })

    it('returns false if latest version is older', () => {
      expect(isNewerVersion('0.2.0', '0.1.9')).toBe(false)
      expect(isNewerVersion('1.0.0', '0.9.9')).toBe(false)
    })

    it('handles potential single/double digit components correctly', () => {
      expect(isNewerVersion('0.2.0', '0.10.0')).toBe(true)
      expect(isNewerVersion('0.9.9', '0.9.10')).toBe(true)
    })
  })

  describe('checkForUpdates', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('returns hasUpdate true when registry version is newer', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '0.2.1' }),
      } as Response)

      const result = await checkForUpdates('0.2.0')
      expect(result).toEqual({
        hasUpdate: true,
        latestVersion: '0.2.1',
      })
    })

    it('returns hasUpdate false when registry version is not newer', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '0.2.0' }),
      } as Response)

      const result = await checkForUpdates('0.2.0')
      expect(result).toEqual({
        hasUpdate: false,
        latestVersion: '0.2.0',
      })
    })

    it('returns null on fetch failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const result = await checkForUpdates('0.2.0')
      expect(result).toBeNull()
    })

    it('returns null if response is not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
      } as Response)

      const result = await checkForUpdates('0.2.0')
      expect(result).toBeNull()
    })
  })
})
