import { describe, expect, it } from 'vitest'
import { canAnchorPrComment } from '../FileDiffCard'

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
