// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildTuiGitDiffArgs, DEFAULTS, intoShowMode, parseDiffOptions, buildGitDiffArgs } from '../lib/diff-options.js'

function withStdoutTty<T>(isTTY: boolean, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: isTTY })
  try {
    return run()
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, 'isTTY', descriptor)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
  }
}

describe('default interactive mode', () => {
  it('uses the saved TUI preference for interactive output', () => {
    const opts = withStdoutTty(true, () => parseDiffOptions([], 'tui'))
    expect(opts.outputMode).toBe('tui')
  })

  it.each([
    ['--web', 'tui', 'web'],
    ['--tui', 'web', 'tui'],
    ['--terminal', 'tui', 'terminal'],
  ] as const)('lets %s override the saved %s preference', (flag, saved, expected) => {
    const opts = withStdoutTty(true, () => parseDiffOptions([flag], saved))
    expect(opts.outputMode).toBe(expected)
  })

  it('keeps non-interactive output in terminal mode', () => {
    const opts = withStdoutTty(false, () => parseDiffOptions([], 'tui'))
    expect(opts.outputMode).toBe('terminal')
  })

  it('keeps GitHub PR reviews in web mode', () => {
    const opts = withStdoutTty(true, () => parseDiffOptions(['--gh-pr', '42'], 'tui'))
    expect(opts.outputMode).toBe('web')
  })
})

describe('parseDiffOptions --gh-pr', () => {
  it('parses --gh-pr <ref> into opts.ghPr', () => {
    const opts = parseDiffOptions(['--gh-pr', '1234', '--no-open'])
    expect(opts.ghPr).toBe('1234')
    expect(opts.noOpen).toBe(true)
  })

  it('parses --gh-pr=owner/repo#N form', () => {
    const opts = parseDiffOptions(['--gh-pr=acme/widget#42'])
    expect(opts.ghPr).toBe('acme/widget#42')
  })

  it('leaves ghPr undefined when the flag is absent', () => {
    const opts = parseDiffOptions(['HEAD'])
    expect(opts.ghPr).toBeUndefined()
  })
})

describe('parseDiffOptions session conflict flags', () => {
  it('parses --reuse-session and --replace-session', () => {
    expect(parseDiffOptions(['--reuse-session']).reuseSession).toBe(true)
    expect(parseDiffOptions(['--replace-session']).replaceSession).toBe(true)
    expect(parseDiffOptions([]).reuseSession).toBe(false)
    expect(parseDiffOptions([]).replaceSession).toBe(false)
  })
})

describe('native view mode', () => {
  it('selects the focused TUI without leaking --view into revisions', () => {
    const opts = parseDiffOptions(['--view', '--staged', 'HEAD~2'])
    expect(opts.outputMode).toBe('tui')
    expect(opts.viewOnly).toBe(true)
    expect(opts.staged).toBe(true)
    expect(opts.revisions).toEqual(['HEAD~2'])
  })

  it('is disabled by default', () => {
    expect(parseDiffOptions([]).viewOnly).toBe(false)
  })

  it.each([
    ['--stat'],
    ['--name-only'],
    ['--no-patch'],
    ['--check'],
    ['--color-moved=zebra'],
    ['--line-prefix=review:'],
    ['--submodule=short'],
  ])('routes non-unified %s output back to terminal mode', (flag) => {
    const opts = parseDiffOptions(['--view', flag])
    expect(opts.outputMode).toBe('terminal')
  })

  it('keeps word-diff intent in the TUI for native intraline rendering', () => {
    const opts = parseDiffOptions(['--view', '--word-diff=plain'])
    expect(opts.outputMode).toBe('tui')
    expect(opts.wordDiff).toBe('plain')
    expect(buildTuiGitDiffArgs(opts)).not.toContain('--word-diff=plain')
  })

  it('builds a stable patch stream while preserving diff semantics', () => {
    const opts = parseDiffOptions([
      '--view',
      '--word-diff=plain',
      '--ignore-space-change',
      '--diff-algorithm=histogram',
      'main..feature',
      '--',
      'src/',
    ])
    expect(buildTuiGitDiffArgs(opts)).toEqual([
      '--diff-algorithm=histogram',
      '--ignore-space-change',
      'main..feature',
      '--',
      'src/',
    ])
  })
})

describe('parseDiffOptions -- separator revisions', () => {
  it('does not treat option values before -- as revisions', () => {
    const opts = parseDiffOptions(['--port', '8080', 'main', '--', 'src/'])
    expect(opts.port).toBe(8080)
    expect(opts.revisions).toEqual(['main'])
    expect(opts.pathspecs).toEqual(['src/'])
  })
})

describe('attached-value-only git flags', () => {
  it('parses --stat=width without swallowing the next revision', () => {
    const opts = parseDiffOptions(['--stat=32', 'main..feature'])
    expect(opts.outputFormat).toBe('stat')
    expect(opts.statParam).toBe('32')
    expect(opts.revisions).toEqual(['main..feature'])
    expect(buildTuiGitDiffArgs(opts)).toContain('--stat=32')
  })

  it('parses standalone --stat without consuming the following revision', () => {
    const opts = parseDiffOptions(['--stat', 'main..feature'])
    expect(opts.outputFormat).toBe('stat')
    expect(opts.statParam).toBeUndefined()
    expect(opts.revisions).toEqual(['main..feature'])
  })

  it('parses --word-diff=plain without consuming revision', () => {
    const opts = parseDiffOptions(['--word-diff=plain', 'HEAD'])
    expect(opts.wordDiff).toBe('plain')
    expect(opts.revisions).toEqual(['HEAD'])
  })

  it('parses standalone --submodule without consuming revision', () => {
    const opts = parseDiffOptions(['--submodule', 'main..feature'])
    expect(opts.submodule).toBeUndefined()
    expect(opts.revisions).toEqual(['main..feature'])
  })
})

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

describe('range notation', () => {
  it('parses A..B as a single revision', () => {
    const opts = parseDiffOptions(['main..feature'])
    expect(opts.revisions).toEqual(['main..feature'])
    expect(opts.pathspecs).toEqual([])
  })

  it('parses A...B as a single revision (symmetric diff)', () => {
    const opts = parseDiffOptions(['main...feature'])
    expect(opts.revisions).toEqual(['main...feature'])
  })

  it('parses HEAD~3..HEAD range', () => {
    const opts = parseDiffOptions(['HEAD~3..HEAD'])
    expect(opts.revisions).toEqual(['HEAD~3..HEAD'])
  })

  it('parses tag range', () => {
    const opts = parseDiffOptions(['v1.0..v2.0'])
    expect(opts.revisions).toEqual(['v1.0..v2.0'])
  })

  it('parses range with --staged', () => {
    const opts = parseDiffOptions(['--staged', 'main..feature'])
    expect(opts.revisions).toEqual(['main..feature'])
    expect(opts.staged).toBe(true)
  })

  it('parses range with pathspec', () => {
    const opts = parseDiffOptions(['main..feature', '--', 'src/'])
    expect(opts.revisions).toEqual(['main..feature'])
    expect(opts.pathspecs).toEqual(['src/'])
  })

  it('parses two individual revisions (A B) as two revisions', () => {
    const opts = parseDiffOptions(['HEAD~3', 'HEAD'])
    expect(opts.revisions).toEqual(['HEAD~3', 'HEAD'])
  })

  it('parses range with diff-filter', () => {
    const opts = parseDiffOptions(['--diff-filter=AM', 'main..feature'])
    expect(opts.revisions).toEqual(['main..feature'])
    expect(opts.diffFilter).toBe('AM')
  })
})

describe('--no-renames', () => {
  it('parses --no-renames flag', () => {
    const opts = parseDiffOptions(['--no-renames'])
    expect(opts.noRenames).toBe(true)
  })

  it('defaults to false', () => {
    const opts = parseDiffOptions([])
    expect(opts.noRenames).toBe(false)
  })

  it('works with ranges', () => {
    const opts = parseDiffOptions(['--no-renames', 'main..feature'])
    expect(opts.noRenames).toBe(true)
    expect(opts.revisions).toEqual(['main..feature'])
  })
})

describe('merge conflict stage options', () => {
  it('parses --base', () => {
    const opts = parseDiffOptions(['--base'])
    expect(opts.base).toBe(true)
  })

  it('parses --ours', () => {
    const opts = parseDiffOptions(['--ours'])
    expect(opts.ours).toBe(true)
  })

  it('parses --theirs', () => {
    const opts = parseDiffOptions(['--theirs'])
    expect(opts.theirs).toBe(true)
  })

  it('defaults all three to false', () => {
    const opts = parseDiffOptions([])
    expect(opts.base).toBe(false)
    expect(opts.ours).toBe(false)
    expect(opts.theirs).toBe(false)
  })

  it('works with ranges', () => {
    const opts = parseDiffOptions(['--ours', 'main..feature'])
    expect(opts.ours).toBe(true)
    expect(opts.revisions).toEqual(['main..feature'])
  })
})

describe('optional-value arg preprocessor', () => {
  describe('-C / --find-copies', () => {
    it('-C with no value uses default 40 and keeps revision', () => {
      const opts = parseDiffOptions(['-C', 'main..feature'])
      expect(opts.findCopies).toBe(40)
      expect(opts.revisions).toEqual(['main..feature'])
    })

    it('-C with attached value 40 uses 40', () => {
      const opts = parseDiffOptions(['-C40', 'main..feature'])
      expect(opts.findCopies).toBe(40)
      expect(opts.revisions).toEqual(['main..feature'])
    })

    it('-C with space-separated value 40 uses 40', () => {
      const opts = parseDiffOptions(['-C', '40', 'main..feature'])
      expect(opts.findCopies).toBe(40)
      expect(opts.revisions).toEqual(['main..feature'])
    })

    it('--find-copies with =value uses that value', () => {
      const opts = parseDiffOptions(['--find-copies=60', 'main..feature'])
      expect(opts.findCopies).toBe(60)
      expect(opts.revisions).toEqual(['main..feature'])
    })

    it('--find-copies without = followed by digit uses digit', () => {
      const opts = parseDiffOptions(['--find-copies', '60', 'main..feature'])
      expect(opts.findCopies).toBe(60)
      expect(opts.revisions).toEqual(['main..feature'])
    })

    it('--find-copies without = followed by non-digit uses default 40', () => {
      const opts = parseDiffOptions(['--find-copies', 'main..feature'])
      expect(opts.findCopies).toBe(40)
      expect(opts.revisions).toEqual(['main..feature'])
    })
  })

  describe('-M / --find-renames', () => {
    it('-M with no value uses default 50 and keeps revision', () => {
      const opts = parseDiffOptions(['-M', 'main..feature'])
      expect(opts.findRenames).toBe(50)
      expect(opts.revisions).toEqual(['main..feature'])
    })

    it('-M with attached value 80 uses 80', () => {
      const opts = parseDiffOptions(['-M80', 'main..feature'])
      expect(opts.findRenames).toBe(80)
      expect(opts.revisions).toEqual(['main..feature'])
    })

    it('--find-renames without = followed by non-digit uses default 50', () => {
      const opts = parseDiffOptions(['--find-renames', 'main..feature'])
      expect(opts.findRenames).toBe(50)
      expect(opts.revisions).toEqual(['main..feature'])
    })
  })

  describe('-B / --break-rewrites', () => {
    it('-B with no value uses default and keeps revision', () => {
      const opts = parseDiffOptions(['-B', 'main..feature'])
      // breakRewrites is set to the default string
      expect(opts.breakRewrites).toBe('50/60')
      expect(opts.revisions).toEqual(['main..feature'])
    })

    it('-B with attached value 75 uses 75', () => {
      const opts = parseDiffOptions(['-B75', 'main..feature'])
      expect(opts.breakRewrites).toBe('75')
      expect(opts.revisions).toEqual(['main..feature'])
    })
  })

  describe('mixed flags', () => {
    it('-C and -M together with range', () => {
      const opts = parseDiffOptions(['-C', '-M', 'main..feature'])
      expect(opts.findCopies).toBe(40)
      expect(opts.findRenames).toBe(50)
      expect(opts.revisions).toEqual(['main..feature'])
    })

    it('-C with other flags and range', () => {
      const opts = parseDiffOptions(['-C', '--staged', 'main..feature', '--', 'src/'])
      expect(opts.findCopies).toBe(40)
      expect(opts.staged).toBe(true)
      expect(opts.revisions).toEqual(['main..feature'])
      expect(opts.pathspecs).toEqual(['src/'])
    })
  })
})
