import { describe, it, expect } from 'vitest'
import { effectiveDiffStyle, SPLIT_DIFF_MIN_WIDTH } from '../diffLayout'

describe('effectiveDiffStyle', () => {
  it('downgrades split to unified when the card is narrower than SPLIT_DIFF_MIN_WIDTH', () => {
    expect(effectiveDiffStyle('split', SPLIT_DIFF_MIN_WIDTH - 1)).toBe('unified')
    expect(effectiveDiffStyle('split', 520)).toBe('unified')
  })

  it('keeps split at the minimum width and above', () => {
    expect(effectiveDiffStyle('split', SPLIT_DIFF_MIN_WIDTH)).toBe('split')
    expect(effectiveDiffStyle('split', 1200)).toBe('split')
  })

  it('does not treat an unmeasured 0 width as narrow', () => {
    expect(effectiveDiffStyle('split', 0)).toBe('split')
  })

  it('leaves unified unchanged at any width', () => {
    expect(effectiveDiffStyle('unified', 400)).toBe('unified')
    expect(effectiveDiffStyle('unified', 1200)).toBe('unified')
  })
})
