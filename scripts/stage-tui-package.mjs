#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`--${name} requires a value`)
  }
  return value
}

function hostPackage() {
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
  throw new Error(`diffing TUI packages do not support ${process.platform}-${process.arch}`)
}

const packageSlug = option('package') ?? hostPackage()
const packageSource = resolve(repoRoot, 'npm', packageSlug)
const manifestSource = resolve(packageSource, 'package.json')
if (!existsSync(manifestSource)) {
  throw new Error(`unknown TUI package: ${packageSlug}`)
}

const manifest = JSON.parse(readFileSync(manifestSource, 'utf8'))
const rootManifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const expectedVersion = rootManifest.optionalDependencies?.[manifest.name]
if (manifest.version !== rootManifest.version || expectedVersion !== rootManifest.version) {
  throw new Error(
    `${manifest.name} must match diffing@${rootManifest.version}; ` +
      `found package=${manifest.version}, optionalDependency=${expectedVersion ?? 'missing'}`,
  )
}

const binaryName = packageSlug.startsWith('tui-win32-')
  ? 'diffing-tui.exe'
  : 'diffing-tui'
const binEntry = `bin/${binaryName}`
manifest.bin = { 'diffing-tui': binEntry }

const binarySource = resolve(
  repoRoot,
  option('binary') ?? `target/release/${process.platform === 'win32' ? 'diffing-tui.exe' : 'diffing-tui'}`,
)
if (!existsSync(binarySource)) {
  throw new Error(`TUI binary not found: ${binarySource}; run pnpm build:tui first`)
}

const output = resolve(repoRoot, option('output') ?? `target/npm/${packageSlug}`)
rmSync(output, { recursive: true, force: true })
mkdirSync(resolve(output, 'bin'), { recursive: true })
writeFileSync(resolve(output, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const binaryOutput = resolve(output, binEntry)
copyFileSync(binarySource, binaryOutput)
if (!binaryOutput.endsWith('.exe')) chmodSync(binaryOutput, 0o755)

process.stdout.write(`${output}\n`)
