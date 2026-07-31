import { isColorEnabled, box, tone, dim } from './terminal.js'

export function shouldPrintPostinstallBanner(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = Boolean(process.stdout.isTTY),
): boolean {
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

export function formatPostinstallBanner(
  version = 'unknown',
  options: { color?: boolean } = {},
): string {
  const color = options.color ?? isColorEnabled()
  const lines = [
    tone('ok', `diffing v${version} installed.`, { color }),
    '',
    dim('Quick start:', color) + '  cd your-repo && diffing',
    dim('First-time:', color) + '   diffing setup        (skills, MCP, doctor)',
    dim('Docs:', color) + '         docs/getting-started.md',
  ]
  return box('diffing', lines, { color })
}
