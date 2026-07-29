// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type NativePackage = {
  name: string
  version: string
  os: string[]
  cpu: string[]
  libc?: string[]
  files: string[]
  publishConfig?: { access?: string }
}

const repoRoot = process.cwd()
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const targets = [
  ['tui-darwin-arm64', 'darwin', 'arm64', undefined, 'diffing-tui'],
  ['tui-darwin-x64', 'darwin', 'x64', undefined, 'diffing-tui'],
  ['tui-linux-arm64-gnu', 'linux', 'arm64', 'glibc', 'diffing-tui'],
  ['tui-linux-arm64-musl', 'linux', 'arm64', 'musl', 'diffing-tui'],
  ['tui-linux-x64-gnu', 'linux', 'x64', 'glibc', 'diffing-tui'],
  ['tui-linux-x64-musl', 'linux', 'x64', 'musl', 'diffing-tui'],
  ['tui-win32-x64-msvc', 'win32', 'x64', undefined, 'diffing-tui.exe'],
] as const

const temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('native TUI npm packages', () => {
  it.each(targets)(
    'keeps %s installable and version-locked to the root package',
    (slug, os, cpu, libc) => {
      const manifest: NativePackage = JSON.parse(
        readFileSync(resolve(repoRoot, 'npm', slug, 'package.json'), 'utf8'),
      )
      expect(manifest.name).toBe(`@diffing/${slug}`)
      expect(manifest.version).toBe(rootPackage.version)
      expect(rootPackage.optionalDependencies[manifest.name]).toBe(rootPackage.version)
      expect(manifest.os).toEqual([os])
      expect(manifest.cpu).toEqual([cpu])
      expect(manifest.libc).toEqual(libc ? [libc] : undefined)
      expect(manifest.files).toContain('bin')
      expect(manifest.publishConfig?.access).toBe('public')
    },
  )

  it('stages a release binary without dirtying the package templates', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'diffing-tui-package-'))
    temporaryDirectories.push(temporaryDirectory)
    const binary = resolve(temporaryDirectory, 'input-binary')
    const output = resolve(temporaryDirectory, 'package')
    writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 })

    execFileSync('node', [
      'scripts/stage-tui-package.mjs',
      '--package',
      'tui-darwin-arm64',
      '--binary',
      binary,
      '--output',
      output,
    ], { cwd: repoRoot })

    const stagedManifest = JSON.parse(readFileSync(resolve(output, 'package.json'), 'utf8'))
    expect(stagedManifest.name).toBe('@diffing/tui-darwin-arm64')
    expect(stagedManifest.bin).toEqual({ 'diffing-tui': 'bin/diffing-tui' })
    expect(statSync(resolve(output, 'bin', 'diffing-tui')).mode & 0o111).not.toBe(0)
  })
})
