import { describe, expect, it, vi } from 'vitest'
import { finishTuiChild } from '../tui-child-lifecycle.js'

describe('finishTuiChild', () => {
  it('settles immediately when normal TUI mode has no search bridge', async () => {
    const settle = vi.fn()

    await finishTuiChild(null, settle)

    expect(settle).toHaveBeenCalledOnce()
  })

  it('closes a viewer search bridge before settling', async () => {
    const calls: string[] = []
    const resource = {
      close: vi.fn(async () => {
        calls.push('close')
      }),
    }

    await finishTuiChild(resource, () => calls.push('settle'))

    expect(resource.close).toHaveBeenCalledOnce()
    expect(calls).toEqual(['close', 'settle'])
  })

  it('still settles when cleanup fails', async () => {
    const settle = vi.fn()
    const resource = {
      close: vi.fn(async () => {
        throw new Error('already closed')
      }),
    }

    await finishTuiChild(resource, settle)

    expect(settle).toHaveBeenCalledOnce()
  })
})
