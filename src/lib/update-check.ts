import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface UpdateInfo {
  hasUpdate: boolean
  latestVersion: string
}

/**
 * Strips ANSI escape sequences from a string to compute its visible/display length.
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

/**
 * Compare two semver version strings to see if the latest version is newer.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const clean = (v: string) => v.replace(/^v/, '')
  const cParts = clean(current).split('.').map(Number)
  const lParts = clean(latest).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const cVal = cParts[i] ?? 0
    const lVal = lParts[i] ?? 0
    if (Number.isNaN(cVal) || Number.isNaN(lVal)) continue
    if (lVal > cVal) return true
    if (lVal < cVal) return false
  }
  return false
}

/**
 * Queries the npm registry asynchronously with a 1-second timeout.
 */
export async function checkForUpdates(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), 1000)
    const res = await fetch('https://registry.npmjs.org/diffing/latest', {
      signal: controller.signal,
    })
    clearTimeout(id)
    if (!res.ok) return null
    const data = (await res.json()) as { version: string }
    if (!data.version) return null
    return {
      hasUpdate: isNewerVersion(currentVersion, data.version),
      latestVersion: data.version,
    }
  } catch {
    return null
  }
}

/**
 * Prints a beautifully styled console box letting the user know a new version is available.
 */
export function printUpdateDisclaimer(current: string, latest: string): void {
  const borderCol = '\x1b[38;5;220m' // Gold/Yellow
  const bold = '\x1b[1m'
  const reset = '\x1b[0m'

  const boxWidth = 66
  const top = borderCol + '╭' + '─'.repeat(boxWidth) + '╮' + reset
  const bottom = borderCol + '╰' + '─'.repeat(boxWidth) + '╯' + reset
  const side = borderCol + '│' + reset

  const l1 = `🚀  ${bold}Update available!${reset}  v${current} → \x1b[38;5;82mv${latest}${reset}`
  const l2 = `Run ${bold}diffing update${reset} to easily upgrade to the latest version.`

  const printRow = (content: string) => {
    const visibleLength = stripAnsi(content).length
    // Adjust length by 1 for terminal display alignment because of the rocket emoji
    const displayLength = visibleLength + (content.includes('🚀') ? 1 : 0)
    const totalPadding = boxWidth - 4 - displayLength
    const pad = ' '.repeat(Math.max(0, totalPadding))
    console.log(`${side}  ${content}${pad}  ${side}`)
  }

  console.log()
  console.log(top)
  printRow('')
  printRow(l1)
  printRow(l2)
  printRow('')
  console.log(bottom)
  console.log()
}

/**
 * Executes the update command process.
 */
export async function runUpdateCommand(): Promise<number> {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const pkgPath = existsSync(resolve(__dirname, '..', 'package.json'))
    ? resolve(__dirname, '..', 'package.json')
    : resolve(__dirname, '..', '..', 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  const currentVersion = pkg.version

  console.log('Checking for updates...')
  const updateInfo = await checkForUpdates(currentVersion)

  if (!updateInfo || !updateInfo.hasUpdate) {
    console.log(`\x1b[38;5;82mYou are already on the latest version of diffing (v${currentVersion})!\x1b[0m`)
    return 0
  }

  const latest = updateInfo.latestVersion
  console.log(`\n\x1b[38;5;75mUpdating diffing: v${currentVersion} → v${latest}...\x1b[0m\n`)

  let cmd = 'npm'
  let args = ['install', '-g', 'diffing@latest']

  try {
    const { execSync } = await import('node:child_process')
    execSync('pnpm --version', { stdio: 'ignore' })
    cmd = 'pnpm'
    args = ['add', '-g', 'diffing@latest']
  } catch {
    // pnpm not available, use npm
  }

  console.log(`Running: ${cmd} ${args.join(' ')}\n`)

  const spawnPromise = new Promise<number>((res) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true })
    child.on('close', (code) => {
      res(code ?? 0)
    })
    child.on('error', (err) => {
      console.error(`Failed to start update process: ${err.message}`)
      res(1)
    })
  })

  const exitCode = await spawnPromise
  if (exitCode === 0) {
    console.log(`\n\x1b[38;5;82mSuccessfully updated diffing to v${latest}!\x1b[0m\n`)
  } else {
    console.error(`\n\x1b[38;5;196mFailed to update diffing. Please try running the command manually with sudo if required:\x1b[0m`)
    console.error(`  sudo ${cmd} ${args.join(' ')}\n`)
  }

  return exitCode
}
