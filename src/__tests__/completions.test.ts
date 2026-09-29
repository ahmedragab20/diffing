// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLI_COMMANDS } from '../lib/cli-commands.js'
import { bashCompletion, completionFor, fishCompletion, zshCompletion } from '../lib/completions.js'

describe('shell completions', () => {
  it('bash mentions plan and doctor', () => {
    const s = bashCompletion()
    expect(s).toContain('doctor')
    expect(s).toContain('plan')
    expect(s).toContain('complete -F _diffing diffing')
    expect(s).toContain('overview threads reviews')
    expect(s).toContain('summary files hunks slice search')
    expect(s).toContain('mode')
    expect(s).toContain('web tui')
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

  it('includes every catalog command and action in each shell', () => {
    for (const script of [bashCompletion(), zshCompletion(), fishCompletion()]) {
      for (const command of CLI_COMMANDS) {
        expect(script).toContain(command.name)
        for (const action of command.actions ?? []) expect(script).toContain(action)
      }
    }
  })

  it('bash works without bash-completion and stops offering actions after the action', () => {
    const directory = mkdtempSync(join(tmpdir(), 'diffing-completion-'))
    try {
      writeFileSync(join(directory, 'review file.md'), '')
      const run = (words: string[], cword: number) => execFileSync('bash', ['--noprofile', '--norc', '-c', `
${bashCompletion()}
COMP_WORDS=("$@")
COMP_CWORD=${cword}
_diffing
printf '%s\\n' "\${COMPREPLY[@]}"
`, 'completion-test', ...words], { cwd: directory, encoding: 'utf8' }).trim().split('\n')
      expect(run(['diffing', ''], 1)).toContain('design')
      expect(run(['diffing', 'mockup', ''], 2)).toContain('handoff')
      expect(run(['diffing', 'plan', 'submit', 'review'], 3)).toEqual(['review file.md'])
      expect(run(['diffing', 'plan', 'submit', ''], 3)).not.toContain('await')
      expect(run(['diffing', '--no'], 1)).toContain('--no-open')
      expect(bashCompletion()).not.toContain('_init_completion')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fish action completions require the second argument position', () => {
    const actions = fishCompletion().split('\n').filter((line) => line.includes('__fish_seen_subcommand_from'))
    expect(actions.length).toBeGreaterThan(0)
    expect(actions.every((line) => line.includes('test (count (commandline -opc)) -eq 2'))).toBe(true)
  })
})
