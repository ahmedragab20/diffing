import { spawn } from 'node:child_process'

export const SKILLS_PACKAGE = 'ahmedragab20/diffing'

export function buildSkillsInstallCommand(): { command: string; args: string[] } {
  return {
    command: 'npx',
    args: ['skills', 'add', SKILLS_PACKAGE],
  }
}

export function formatSkillsInstallCommand(): string {
  const { command, args } = buildSkillsInstallCommand()
  return [command, ...args].join(' ')
}

export interface RunSkillsInstallOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** When true, only print the command without executing. */
  dryRun?: boolean
}

export function runSkillsInstall(options: RunSkillsInstallOptions = {}): Promise<number> {
  if (options.dryRun) {
    return Promise.resolve(0)
  }
  const { command, args } = buildSkillsInstallCommand()
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', () => resolve(1))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}
