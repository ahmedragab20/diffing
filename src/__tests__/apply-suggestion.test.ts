// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applySuggestionToContent,
  extractSuggestionBlock,
} from '../lib/apply-suggestion.js'

describe('extractSuggestionBlock', () => {
  it('pulls the first suggestion fence', () => {
    const body = 'Please fix:\n```suggestion\nconst x = 1\n```\nthanks'
    expect(extractSuggestionBlock(body)).toBe('const x = 1\n')
  })

  it('returns null when no fence', () => {
    expect(extractSuggestionBlock('no fence here')).toBeNull()
  })
})

describe('applySuggestionToContent', () => {
  it('replaces a single line', () => {
    const content = 'a\nb\nc\n'
    const result = applySuggestionToContent({
      content,
      lineNumber: 2,
      body: '```suggestion\nB\n```',
      side: 'additions',
    })
    expect(result).toEqual({ ok: true, content: 'a\nB\nc\n', replacedLines: 1 })
  })

  it('replaces a multi-line range with a multi-line suggestion', () => {
    const content = 'one\ntwo\nthree\nfour\n'
    const result = applySuggestionToContent({
      content,
      startLineNumber: 2,
      lineNumber: 3,
      body: '```suggestion\nTWO\nTHREE\nEXTRA\n```',
      side: 'additions',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe('one\nTWO\nTHREE\nEXTRA\nfour\n')
      expect(result.replacedLines).toBe(2)
    }
  })

  it('rejects deletions side', () => {
    const result = applySuggestionToContent({
      content: 'a\n',
      lineNumber: 1,
      body: '```suggestion\nx\n```',
      side: 'deletions',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects missing fence', () => {
    const result = applySuggestionToContent({
      content: 'a\n',
      lineNumber: 1,
      body: 'please change this',
      side: 'additions',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects out-of-range line', () => {
    const result = applySuggestionToContent({
      content: 'a\n',
      lineNumber: 5,
      body: '```suggestion\nx\n```',
      side: 'additions',
    })
    expect(result.ok).toBe(false)
  })

  it('preserves CRLF line endings', () => {
    const content = 'a\r\nb\r\nc\r\n'
    const result = applySuggestionToContent({
      content,
      lineNumber: 2,
      body: '```suggestion\nB\n```',
      side: 'additions',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toBe('a\r\nB\r\nc\r\n')
  })
})
