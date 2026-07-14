// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULTS, intoShowMode, parseDiffOptions } from '../lib/diff-options.js'

describe('parseDiffOptions isolation', () => {
  it('returns fresh revision and pathspec arrays on sequential calls', () => {
    const first = parseDiffOptions(['HEAD~2', '--', 'src/'])
    const second = parseDiffOptions([])

    expect(first.revisions).toEqual(['HEAD~2'])
    expect(first.pathspecs).toEqual(['src/'])
    expect(second.revisions).toEqual([])
    expect(second.pathspecs).toEqual([])
    expect(DEFAULTS.revisions).toEqual([])
    expect(DEFAULTS.pathspecs).toEqual([])
  })

  it('does not leak show revspec mutations into later parses or DEFAULTS', () => {
    const shown = intoShowMode(parseDiffOptions(['HEAD']))
    const next = parseDiffOptions(['main'])

    expect(shown.showRevspecs).toEqual(['HEAD'])
    expect(shown.revisions).toEqual([])
    expect(next.showRevspecs).toEqual([])
    expect(next.revisions).toEqual(['main'])
    expect(DEFAULTS.showRevspecs).toEqual([])
  })
})
