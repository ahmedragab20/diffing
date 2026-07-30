import { describe, expect, it } from 'vitest'
import {
  buildUnsafeCSS,
  canAnchorPrComment,
  filterSupportedLineAnnotations,
} from '../FileDiffCard'

const file = {
  name: 'src/example.ts',
  hunks: [{ additionStart: 10, additionCount: 5, deletionStart: 8, deletionCount: 3 }],
} as any

const comment = {
  line: 12,
  side: 'RIGHT',
  isOutdated: false,
} as any

describe('published PR comment anchoring', () => {
  it('anchors a current GitHub thread directly to its diff line', () => {
    expect(canAnchorPrComment(file, comment)).toBe(true)
  })

  it('uses file-level context for outdated or unavailable anchors', () => {
    expect(canAnchorPrComment(file, { ...comment, isOutdated: true })).toBe(false)
    expect(canAnchorPrComment(file, { ...comment, line: 40 })).toBe(false)
    expect(canAnchorPrComment(file, { ...comment, line: null })).toBe(false)
  })
})

describe('local comment annotation safety', () => {
  it('keeps unsupported sides away from the diff renderer', () => {
    const valid = { side: 'additions', lineNumber: 12, metadata: {} } as any
    const malformed = { side: 'right', lineNumber: 35, metadata: {} } as any
    const fileLevel = { side: 'additions', lineNumber: 0, metadata: {} } as any

    expect(filterSupportedLineAnnotations([valid, malformed, fileLevel])).toEqual([valid])
  })

  it('uses vivid semantic diff roles and viewport-safe review cards', () => {
    const css = buildUnsafeCSS(2, 13, 'monospace')

    expect(css).toContain('var(--gl-added-surface)')
    expect(css).toContain('var(--gl-removed-surface)')
    expect(css).toContain('inset 2px 0 var(--gl-positive)')
    expect(css).toContain('inset 2px 0 var(--gl-negative)')
    expect(css).toContain('calc(100vw - 80px)')
    expect(css).not.toMatch(/border-left:\s*3px/)
  })
})
