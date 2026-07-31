// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  isColorEnabled,
  stripAnsi,
  box,
  rule,
  tone,
  hintLine,
  stepHeader,
  copyBlock,
  bold,
  dim,
  fg256,
} from '../terminal.js'

describe('terminal', () => {
  it('stripAnsi removes escape sequences', () => {
    const styled = `${fg256(220, true)}hello${'\x1b[0m'}`
    expect(stripAnsi(styled)).toBe('hello')
  })

  it('isColorEnabled is false when color explicitly disabled', () => {
    expect(isColorEnabled({ isTTY: true } as NodeJS.WriteStream)).toBe(
      process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb',
    )
  })

  it('box renders plain text without color', () => {
    const out = box('diffing setup', ['line one'], { color: false })
    expect(out).toContain('╭')
    expect(out).toContain('diffing setup')
    expect(out).toContain('line one')
    expect(stripAnsi(out)).toBe(out)
  })

  it('box includes ANSI when color enabled', () => {
    const out = box('title', ['body'], { color: true })
    expect(out).toContain('\x1b[')
    expect(stripAnsi(out)).toContain('title')
  })

  it('rule is plain without color', () => {
    const out = rule({ color: false })
    expect(out).toMatch(/^─+$/)
    expect(stripAnsi(out)).toBe(out)
  })

  it('tone prefixes semantic icons', () => {
    expect(tone('ok', 'saved', { color: false })).toBe('✓ saved')
    expect(tone('warn', 'note', { color: false })).toBe('! note')
    expect(tone('error', 'fail', { color: false })).toBe('✗ fail')
    expect(tone('info', 'step', { color: false })).toBe('▌ step')
  })

  it('hintLine formats key hints', () => {
    const plain = hintLine(
      [
        { key: 'Y', label: 'yes' },
        { key: 'n', label: 'no' },
      ],
      { color: false },
    )
    expect(plain).toBe('Y yes · n no')
  })

  it('stepHeader shows step fraction', () => {
    expect(stepHeader(2, 5, 'Default mode', { color: false })).toBe(
      'Step 2/5 · Default mode',
    )
  })

  it('copyBlock wraps content', () => {
    const out = copyBlock('paste me', '{"a":1}', { color: false })
    expect(out).toContain('paste me')
    expect(out).toContain('{"a":1}')
  })

  it('bold and dim are no-ops without color', () => {
    expect(bold('x', false)).toBe('x')
    expect(dim('y', false)).toBe('y')
  })
})
