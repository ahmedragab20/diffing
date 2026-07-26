import { describe, expect, it } from 'vitest'
import { DEFAULTS, type DiffOptions } from '../diff-options.js'
import { buildTuiDiffContext } from '../tui-diff-context.js'

function options(overrides: Partial<DiffOptions> = {}): DiffOptions {
  return {
    ...DEFAULTS,
    revisions: [],
    pathspecs: [],
    showRevspecs: [],
    ...overrides,
  }
}

describe('buildTuiDiffContext', () => {
  it('identifies working-tree and staged diffs', () => {
    expect(buildTuiDiffContext(options(), 'main')).toEqual({
      kind: 'working-tree',
      headline: 'Working-tree changes on main',
    })
    expect(buildTuiDiffContext(options({ staged: true }), 'feature')).toEqual({
      kind: 'staged-only',
      headline: 'Staged changes on feature',
    })
  })

  it('preserves the compared revisions and path filter', () => {
    expect(buildTuiDiffContext(
      options({ revisions: ['main..feature'], pathspecs: ['src'] }),
      'feature',
    )).toEqual({
      kind: 'range',
      headline: 'Comparing main..feature (current: feature)',
      detail: 'Path: src',
    })
  })

  it('uses show revspecs for commit context', () => {
    expect(buildTuiDiffContext(
      options({ showMode: true, showRevspecs: ['HEAD~2..HEAD'] }),
      'main',
    )).toEqual({
      kind: 'commit',
      headline: 'Showing HEAD~2..HEAD',
    })
  })
})
