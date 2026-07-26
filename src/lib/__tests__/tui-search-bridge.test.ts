import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getFileContent } = vi.hoisted(() => ({
  getFileContent: vi.fn(),
}))

vi.mock('../git.js', () => ({ getFileContent }))

import { loadTuiPreview } from '../tui-search-bridge.js'

describe('TUI search preview bridge', () => {
  beforeEach(() => {
    getFileContent.mockReset()
  })

  it('returns UTF-8 working-tree text', () => {
    getFileContent.mockReturnValue(Buffer.from('const answer = 42\n'))

    expect(loadTuiPreview({ path: 'src/answer.ts' })).toEqual({
      path: 'src/answer.ts',
      content: 'const answer = 42\n',
      missing: false,
      binary: false,
      truncated: false,
    })
    expect(getFileContent).toHaveBeenCalledWith('src/answer.ts', 'new')
  })

  it('distinguishes missing and binary files', () => {
    getFileContent.mockReturnValueOnce(null)
    expect(loadTuiPreview({ path: 'deleted.ts' })).toMatchObject({
      missing: true,
      binary: false,
    })

    getFileContent.mockReturnValueOnce(Buffer.from([0x66, 0x6f, 0x00, 0x6f]))
    expect(loadTuiPreview({ path: 'image.bin' })).toMatchObject({
      missing: false,
      binary: true,
    })
  })

  it('rejects an empty path', () => {
    expect(() => loadTuiPreview({})).toThrow('preview path is required')
  })
})
