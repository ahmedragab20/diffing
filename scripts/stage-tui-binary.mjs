#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const tuiTargets = [
  { slug: 'tui-darwin-arm64', binary: 'diffing-tui' },
  { slug: 'tui-darwin-x64', binary: 'diffing-tui' },
  { slug: 'tui-linux-arm64-gnu', binary: 'diffing-tui' },
  { slug: 'tui-linux-arm64-musl', binary: 'diffing-tui' },
  { slug: 'tui-linux-x64-gnu', binary: 'diffing-tui' },
  { slug: 'tui-linux-x64-musl', binary: 'diffing-tui' },
  { slug: 'tui-win32-x64-msvc', binary: 'diffing-tui.exe' },
]

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`--${name} requires a value`)
  }
  return value
}

function hostTarget() {
  if (process.platform === 'darwin') {
    return `tui-darwin-${process.arch}`
  }
  if (process.platform === 'win32') {
    return `tui-win32-${process.arch}-msvc`
  }
  if (process.platform === 'linux') {
    const report = process.report?.getReport()
    const runtime = report?.header?.glibcVersionRuntime ? 'gnu' : 'musl'
    return `tui-linux-${process.arch}-${runtime}`
  }
  throw new Error(`diffing TUI binaries do not support ${process.platform}-${process.arch}`)
}

function verifyVersion() {
  const rootManifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
  const cargoManifest = readFileSync(resolve(repoRoot, 'Cargo.toml'), 'utf8')
  const cargoVersion = cargoManifest.match(
    /\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
  )?.[1]
  if (cargoVersion !== rootManifest.version) {
    throw new Error(
      `diffing TUI must match diffing@${rootManifest.version}; ` +
        `found cargo=${cargoVersion ?? 'missing'}`,
    )
  }
}

function main() {
  const targetSlug = option('target') ?? hostTarget()
  const target = tuiTargets.find(candidate => candidate.slug === targetSlug)
  if (!target) {
    throw new Error(`unknown TUI target: ${targetSlug}`)
  }
  verifyVersion()

  const binarySource = resolve(
    repoRoot,
    option('binary') ?? `target/release/${process.platform === 'win32' ? 'diffing-tui.exe' : 'diffing-tui'}`,
  )
  if (!existsSync(binarySource)) {
    throw new Error(`TUI binary not found: ${binarySource}; run pnpm build:tui first`)
  }

  const outputRoot = resolve(repoRoot, option('output-root') ?? 'dist/native')
  const output = resolve(outputRoot, target.slug)
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })

  const binaryOutput = resolve(output, target.binary)
  copyFileSync(binarySource, binaryOutput)
  if (!binaryOutput.endsWith('.exe')) chmodSync(binaryOutput, 0o755)

  process.stdout.write(`${binaryOutput}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
