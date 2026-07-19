// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { bashCompletion, completionFor, fishCompletion, zshCompletion } from '../lib/completions.js'

describe('shell completions', () => {
  it('bash mentions plan and doctor', () => {
    const s = bashCompletion()
    expect(s).toContain('doctor')
    expect(s).toContain('plan')
    expect(s).toContain('complete -F _diffing diffing')
    expect(s).toContain('overview threads reviews')
    expect(s).toContain('summary files hunks slice search')
  })

  it('zsh is a compdef script', () => {
    const s = zshCompletion()
    expect(s).toContain('#compdef diffing')
    expect(s).toContain('await-review')
  })

  it('fish lists subcommands', () => {
    const s = fishCompletion()
    expect(s).toContain('complete -c diffing')
    expect(s).toContain('doctor')
  })

  it('completionFor routes shells', () => {
    expect(completionFor('bash')).toContain('complete -F')
    expect(completionFor('ZSH')).toContain('#compdef')
    expect(completionFor('fish')).toContain('complete -c diffing')
    expect(completionFor('powershell')).toBeNull()
  })
})
