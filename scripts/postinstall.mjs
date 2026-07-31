import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function shouldPrintPostinstallBanner(env = process.env, isTTY = Boolean(process.stdout.isTTY)) {
  if (!isTTY) return false
  if (
    env.CI ||
    env.CONTINUOUS_INTEGRATION ||
    env.BUILD_NUMBER ||
    env.GITHUB_ACTIONS ||
    env.GITLAB_CI ||
    env.CIRCLECI ||
    env.JENKINS_URL
  ) {
    return false
  }
  return true
}

function readPackageVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf-8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function main() {
  if (!shouldPrintPostinstallBanner()) return
  const version = readPackageVersion()
  try {
    const { formatPostinstallBanner } = await import('../dist/lib/postinstall-banner.mjs')
    process.stdout.write(formatPostinstallBanner(version, { color: true }))
  } catch {
    process.stdout.write(
      [
        '',
        `diffing v${version} installed.`,
        '',
        '  Quick start:  cd your-repo && diffing',
        '  First-time:   diffing setup        (skills, MCP, doctor)',
        '  Docs:         docs/getting-started.md',
        '',
      ].join('\n'),
    )
  }
}

main()
