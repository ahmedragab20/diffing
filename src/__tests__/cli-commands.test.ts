// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SUBCOMMANDS, CLI_COMMANDS, commandCatalog, runCommands } from '../lib/cli-commands.js'

afterEach(() => vi.restoreAllMocks())

describe('command catalog', () => {
  it('contains each dispatched top-level command exactly once', () => {
    const source = readFileSync(new URL('../cli-agent.ts', import.meta.url), 'utf8')
    const dispatch = source.slice(source.indexOf('export async function runSubcommand('))
    const actual = [...dispatch.matchAll(/case "([^"]+)":/g)].map((match) => match[1])
    const names = CLI_COMMANDS.map(({ name }) => name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual([...actual, 'mcp', 'init', 'onboard', 'view', 'show', 'commands'].sort())
    expect(AGENT_SUBCOMMANDS).toEqual(new Set(names.filter((name) => !['view', 'show'].includes(name))))
    expect(commandCatalog()).toEqual({ schemaVersion: 1, commands: CLI_COMMANDS })
  })

  it('describes aliases and complete action lists', () => {
    expect(CLI_COMMANDS.find(({ name }) => name === 'init')?.aliasFor).toBe('setup')
    expect(CLI_COMMANDS.find(({ name }) => name === 'gh')?.actions).toContain('pr')
    expect(CLI_COMMANDS.find(({ name }) => name === 'mockup')?.actions).toEqual([
      'submit', 'await', 'list', 'show', 'versions', 'reply', 'resolve', 'unresolve',
      'apply-suggestion', 'inspect', 'screen', 'threads', 'handoff',
    ])
    expect(CLI_COMMANDS.find(({ name }) => name === 'evidence')?.actions).toEqual([
      'list', 'map', 'read', 'search', 'symbols', 'verify', 'notebook', 'decide',
    ])
  })
})

describe('commands discovery', () => {
  it.each(['--help', '-h'])('prints help for %s', (flag) => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(runCommands([flag])).toBe(0)
    expect(output).toHaveBeenCalledWith('Usage: diffing commands [--json] [command]')
  })

  it('prints the JSON catalog and supports a command filter', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(runCommands(['--json'])).toBe(0)
    expect(JSON.parse(output.mock.calls[0][0])).toEqual(commandCatalog())
    output.mockClear()
    expect(runCommands(['design', '--json'])).toBe(0)
    expect(JSON.parse(output.mock.calls[0][0])).toEqual({
      schemaVersion: 1, commands: [CLI_COMMANDS.find(({ name }) => name === 'design')],
    })
  })

  it('prints human descriptions and actions', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(runCommands(['inspect'])).toBe(0)
    expect(output.mock.calls.flat().join('\n')).toContain('Read bounded diff data')
    expect(output.mock.calls.flat().join('\n')).toContain('Actions: summary files hunks slice search')
  })

  it.each([
    [['missing'], 'unknown command missing'],
    [['--bogus'], 'unknown option --bogus'],
    [['plan', 'submit'], 'expected at most one command name'],
  ])('rejects invalid arguments %j with usage exit code', (args, error) => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(runCommands(args as string[])).toBe(5)
    expect(stderr).toHaveBeenCalledWith(`diffing commands: ${error}`)
    expect(output).not.toHaveBeenCalled()
  })
})
