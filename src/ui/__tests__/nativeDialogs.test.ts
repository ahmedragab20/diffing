import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const uiRoot = resolve(process.cwd(), 'src/ui')
const nativeDialogCall = /\b(?:window\.|globalThis\.)?(?:alert|confirm|prompt)\s*\(/

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.tsx', '.js', '.jsx'].includes(extname(entry.name)) ? [path] : []
  })
}

describe('browser interaction contracts', () => {
  it('does not use browser-native alert, confirm, or prompt dialogs', () => {
    const violations = sourceFiles(uiRoot).flatMap((path) => {
      const lines = readFileSync(path, 'utf8').split('\n')
      return lines.flatMap((line, index) =>
        nativeDialogCall.test(line) ? [`${path.slice(uiRoot.length + 1)}:${index + 1}`] : [],
      )
    })

    expect(violations).toEqual([])
  })
})
