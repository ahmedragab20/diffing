#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tuiTargets } from './stage-tui-binary.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundleRoot = resolve(repoRoot, process.argv[2] ?? 'dist/native')
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

for (const target of tuiTargets) {
  const binary = resolve(bundleRoot, target.slug, target.binary)
  if (!existsSync(binary)) {
    throw new Error(`bundled TUI binary is missing: ${binary}`)
  }
  const stats = statSync(binary)
  if (!stats.isFile() || stats.size === 0) {
    throw new Error(`bundled TUI binary is invalid: ${binary}`)
  }
  if (!binary.endsWith('.exe') && (stats.mode & 0o111) === 0) {
    throw new Error(`bundled TUI binary is not executable: ${binary}`)
  }
}

process.stdout.write(`verified ${tuiTargets.length} native TUI binaries for diffing@${rootManifest.version}\n`)
