// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildPermalink, parsePermalink } from '../permalink.js'

describe('parsePermalink', () => {
  it('parses file, line, side, comment', () => {
    expect(parsePermalink('?file=src/a.ts&line=42&side=additions&comment=abc')).toEqual({
      file: 'src/a.ts',
      line: 42,
      side: 'additions',
      comment: 'abc',
    })
  })

  it('tolerates empty search', () => {
    expect(parsePermalink('')).toEqual({
      file: undefined,
      line: undefined,
      side: undefined,
      comment: undefined,
    })
  })
})

describe('buildPermalink', () => {
  it('builds a path-relative query string', () => {
    const url = buildPermalink({ file: 'a.ts', line: 1, side: 'deletions' }, '/')
    expect(url).toContain('/?file=a.ts&line=1&side=deletions')
  })
})
