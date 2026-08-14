// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  pinPercent,
  pinStackOffset,
  hitLabel,
  VIEWPORT_LABEL,
  VIEWPORT_OPTIONS,
} from '../MockupAnchors'

describe('MockupAnchors', () => {
  it('maps layout widths to mockup viewports', () => {
    expect(VIEWPORT_LABEL).toEqual({
      1280: 'desktop',
      768: 'tablet',
      390: 'mobile',
    })
    expect(VIEWPORT_OPTIONS.map((o) => o.viewport)).toEqual([
      'desktop',
      'tablet',
      'mobile',
    ])
  })

  it('pinPercent prefers the click point, then the rect, then the default', () => {
    expect(pinPercent({ kind: 'block', x: 42, y: 13 })).toEqual({
      x: 42,
      y: 13,
    })
    expect(
      pinPercent({ kind: 'section', rect: { x: 10, y: 20, w: 30, h: 40 } }),
    ).toEqual({ x: 14, y: 24 })
    expect(pinPercent({ kind: 'point' })).toEqual({ x: 4, y: 4 })
  })

  it('pinStackOffset counts only earlier pins at the same spot', () => {
    const comments = [
      { kind: 'block' as const, x: 10, y: 10 },
      { kind: 'block' as const, x: 10.1, y: 10.2 },
      { kind: 'block' as const, x: 90, y: 90 },
      { kind: 'block' as const, x: 10, y: 10 },
    ]
    expect(pinStackOffset(comments, 0)).toBe(0)
    expect(pinStackOffset(comments, 1)).toBe(1)
    expect(pinStackOffset(comments, 2)).toBe(0)
    expect(pinStackOffset(comments, 3)).toBe(2)
  })

  it('hitLabel words each anchor kind', () => {
    expect(hitLabel({ kind: 'section', target: 'hero' })).toBe('section · hero')
    expect(hitLabel({ kind: 'section' })).toBe('section · region')
    expect(hitLabel({ kind: 'point', x: 12.5, y: 33.3 })).toBe(
      'pin · 12.5%, 33.3%',
    )
    expect(hitLabel({ kind: 'block', selector: 'button.pay' })).toBe(
      'block · button.pay',
    )
    expect(hitLabel({ kind: 'block' })).toBe('block · element')
  })
})
