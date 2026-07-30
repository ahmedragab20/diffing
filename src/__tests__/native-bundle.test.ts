// @vitest-environment node
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const targets = [
  ['tui-darwin-arm64', 'diffing-tui'],
  ['tui-darwin-x64', 'diffing-tui'],
  ['tui-linux-arm64-gnu', 'diffing-tui'],
  ['tui-linux-arm64-musl', 'diffing-tui'],
  ['tui-linux-x64-gnu', 'diffing-tui'],
  ['tui-linux-x64-musl', 'diffing-tui'],
  ['tui-win32-x64-msvc', 'diffing-tui.exe'],
] as const

const temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('native TUI bundle', () => {
  it('keeps the native binary version locked to the root package', () => {
    const cargoManifest = readFileSync(resolve(repoRoot, 'Cargo.toml'), 'utf8')
    const cargoVersion = cargoManifest.match(
      /\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
    )?.[1]

    expect(cargoVersion).toBe(rootPackage.version)
  })

  it('ships native binaries only through the root package', () => {
    expect(rootPackage.files).toContain('dist')
    expect(rootPackage.optionalDependencies).toBeUndefined()
  })

  it('stages a release binary in its target-specific bundle directory', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'diffing-tui-bundle-'))
    temporaryDirectories.push(temporaryDirectory)
    const binary = resolve(temporaryDirectory, 'input-binary')
    writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 })

    execFileSync('node', [
      'scripts/stage-tui-binary.mjs',
      '--target',
      'tui-darwin-arm64',
      '--binary',
      binary,
      '--output-root',
      temporaryDirectory,
    ], { cwd: repoRoot })

    const stagedBinary = resolve(temporaryDirectory, 'tui-darwin-arm64', 'diffing-tui')
    expect(readFileSync(stagedBinary, 'utf8')).toContain('exit 0')
    expect(statSync(stagedBinary).mode & 0o111).not.toBe(0)
  })

  it('verifies a complete seven-target release bundle', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'diffing-tui-release-'))
    temporaryDirectories.push(temporaryDirectory)

    for (const [slug, binaryName] of targets) {
      const directory = resolve(temporaryDirectory, slug)
      mkdirSync(directory, { recursive: true })
      writeFileSync(resolve(directory, binaryName), 'native-binary', { mode: 0o755 })
    }

    const output = execFileSync(
      'node',
      ['scripts/verify-tui-bundle.mjs', temporaryDirectory],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(output).toContain('verified 7 native TUI binaries')
  })
})
