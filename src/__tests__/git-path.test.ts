import { describe, expect, it } from 'vitest'
import { decodeGitPath, parseGitDiffHeaderPaths } from '../lib/git-path.js'

describe('git-path', () => {
  it('decodes C-quoted paths with non-ASCII bytes', () => {
    const quoted = '"src/caf\\303\\251.txt"'
    expect(decodeGitPath(quoted)).toBe('src/café.txt')
  })

  it('splits diff headers on the last b/ segment', () => {
    const line = 'diff --git a/foo b/bar b/real.txt'
    expect(parseGitDiffHeaderPaths(line)).toEqual(['foo b/bar', 'real.txt'])
  })

  it('parses quoted paths with spaces', () => {
    const line = 'diff --git "a/src/my file.ts" "b/src/my file.ts"'
    expect(parseGitDiffHeaderPaths(line)).toEqual(['src/my file.ts', 'src/my file.ts'])
  })
})
