import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { isSetupCompleted } from './settings.js'
import { box, hintLine, dim, isColorEnabled } from './terminal.js'

export const DOCS_GETTING_STARTED_URL = 'https://github.com/ahmedragab20/diffing/blob/main/docs/getting-started.md'

export interface FirstRunGateOptions {
  skipSetup?: boolean
  isTTY?: boolean
  isStdinTTY?: boolean
  env?: NodeJS.ProcessEnv
  setupCompleted?: boolean
}

export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.CI ||
      env.CONTINUOUS_INTEGRATION ||
      env.BUILD_NUMBER ||
      env.GITHUB_ACTIONS ||
      env.GITLAB_CI ||
      env.CIRCLECI ||
      env.JENKINS_URL,
  )
}

export function shouldOfferFirstRunSetup(options: FirstRunGateOptions = {}): boolean {
  const env = options.env ?? process.env
  const tty = options.isTTY ?? Boolean(process.stdout.isTTY)
  const stdinTty = options.isStdinTTY ?? Boolean(process.stdin.isTTY)
  if (options.skipSetup) return false
  if (!tty || !stdinTty) return false
  if (isCiEnvironment(env)) return false
  const completed = options.setupCompleted ?? isSetupCompleted()
  return !completed
}

export type FirstRunChoice = 'run' | 'skip' | 'docs'

export function formatFirstRunWelcome(options: { color?: boolean } = {}): string {
  const color = options.color ?? isColorEnabled()
  const hint = hintLine(
    [
      { key: 'Y', label: 'Run setup now' },
      { key: 'n', label: 'Skip' },
      { key: '?', label: 'Docs' },
    ],
    { color },
  )
  const docsNote = dim(`Getting started: ${DOCS_GETTING_STARTED_URL}`, color)
  return box(
    'diffing',
    [
      'Welcome — local-first code review for git diffs and AI handoff.',
      '',
      hint,
      docsNote,
    ],
    { color },
  )
}

export async function promptFirstRunSetup(
  write: (line: string) => void = (line) => output.write(line),
): Promise<FirstRunChoice> {
  const color = isColorEnabled()
  write(formatFirstRunWelcome({ color }))
  const rl = createInterface({ input, output })
  try {
    while (true) {
      const answer = (await rl.question('> ')).trim().toLowerCase()
      if (!answer || answer === 'y' || answer === 'yes') return 'run'
      if (answer === 'n' || answer === 'no') return 'skip'
      if (answer === '?' || answer === 'docs' || answer === 'help') return 'docs'
      write(hintLine(
        [
          { key: 'Y', label: 'yes' },
          { key: 'n', label: 'no' },
          { key: '?', label: 'help' },
        ],
        { color },
      ) + '\n')
    }
  } finally {
    rl.close()
  }
}
