import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { isGitRepo, getRepoRoot } from './git.js'
import { runDoctor, formatDoctorReport } from './doctor.js'
import { completionFor } from './completions.js'
import {
  ensureConfigDir,
  formatModeLabel,
  loadSettings,
  markSetupCompleted,
  resetSetupCompleted,
  saveSettings,
  isSetupCompleted,
  type DefaultMode,
} from './settings.js'
import {
  buildDiffingMcpEntry,
  detectGlobalMcpClients,
  formatMcpSnippet,
  writeGlobalMcpConfigs,
  writeProjectMcpConfig,
} from './setup-mcp.js'
import { formatSkillsInstallCommand, runSkillsInstall } from './setup-skills.js'
import { DOCS_GETTING_STARTED_URL } from './setup-first-run.js'
import {
  box,
  bold,
  copyBlock,
  dim,
  hintLine,
  isColorEnabled,
  rule,
  stepHeader,
  tone,
} from './terminal.js'

export interface SetupOptions {
  yes?: boolean
  check?: boolean
  reset?: boolean
  writeMcp?: boolean
  writeProjectMcp?: boolean
  writeCompletions?: boolean
  skillsOnly?: boolean
  mcpOnly?: boolean
  cwd?: string
  cliImportMetaUrl?: string
  interactive?: boolean
}

export interface SetupCheckResult {
  ok: boolean
  nodeOk: boolean
  gitOk: boolean
  inGitRepo: boolean
  setupCompleted: boolean
  configDirReady: boolean
  messages: string[]
}

const SETUP_STEPS = 6

function packageVersion(cliImportMetaUrl?: string): string {
  const candidates: string[] = []
  if (cliImportMetaUrl) {
    const base = dirname(fileURLToPath(cliImportMetaUrl))
    candidates.push(resolve(base, '..', 'package.json'), resolve(base, '..', '..', 'package.json'))
  }
  candidates.push(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'))
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf-8'))
      if (pkg.version) return pkg.version
    } catch {
      /* try next */
    }
  }
  return 'unknown'
}

function gitOnPath(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}

function nodeVersionOk(): boolean {
  const major = Number(process.versions.node.split('.')[0])
  return Number.isFinite(major) && major >= 20
}

function printStep(step: number, title: string, color: boolean): void {
  console.log('')
  console.log(stepHeader(step, SETUP_STEPS, title, { color }))
}

async function askYesNo(
  question: string,
  defaultYes: boolean,
  interactive: boolean,
  color: boolean,
): Promise<boolean> {
  if (!interactive || !process.stdin.isTTY) return defaultYes
  const rl = createInterface({ input, output })
  try {
    const suffix = defaultYes
      ? `[${bold('Y', color)}/${bold('n', color)}]`
      : `[${bold('y', color)}/${bold('N', color)}]`
    console.log(
      hintLine(
        [
          { key: 'Y', label: 'yes' },
          { key: 'n', label: 'no' },
          { key: '?', label: 'help' },
        ],
        { color },
      ),
    )
    while (true) {
      const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase()
      if (!answer) return defaultYes
      if (answer === '?' || answer === 'help') {
        console.log(dim('Answer y/yes or n/no; Enter accepts the default in brackets.', color))
        continue
      }
      if (answer === 'y' || answer === 'yes') return true
      if (answer === 'n' || answer === 'no') return false
      console.log(dim('Please answer y or n (or ? for help).', color))
    }
  } finally {
    rl.close()
  }
}

async function askDefaultMode(interactive: boolean, color: boolean): Promise<void> {
  if (!interactive || !process.stdin.isTTY) return

  const current = loadSettings().defaultMode
  console.log('')
  console.log(tone('info', 'Default interactive mode:', { color }))
  console.log(`  ${bold('Web', color)}  ${dim('— browser review UI (supported)', color)}`)
  console.log(`  ${bold('TUI', color)}  ${dim('— native terminal UI (experimental)', color)}`)
  console.log(dim(`Current: ${formatModeLabel(current)}`, color))

  const useTui = await askYesNo(
    `Switch to TUI?`,
    false,
    interactive,
    color,
  )
  if (useTui) {
    saveSettings({ defaultMode: 'tui' satisfies DefaultMode })
    console.log(tone('ok', 'Default mode set to TUI', { color }))
    return
  }

  const keepWeb = await askYesNo('Keep Web as the default interactive mode?', true, interactive, color)
  if (!keepWeb) {
    saveSettings({ defaultMode: 'tui' satisfies DefaultMode })
    console.log(tone('ok', 'Default mode set to TUI', { color }))
  }
}

export function runSetupCheck(options: Pick<SetupOptions, 'cwd'> = {}): SetupCheckResult {
  const cwd = options.cwd ?? process.cwd()
  const messages: string[] = []
  const nodeOk = nodeVersionOk()
  if (!nodeOk) messages.push(`Node.js >= 20 required (found ${process.versions.node})`)
  const gitOk = gitOnPath()
  if (!gitOk) messages.push('git not found on PATH')
  const inGitRepo = isGitRepo()
  if (!inGitRepo) messages.push(`${cwd} is not inside a Git repository (setup can continue)`)
  ensureConfigDir()
  const configDirReady = true
  const setupCompleted = isSetupCompleted()
  const ok = nodeOk && gitOk && configDirReady
  return { ok, nodeOk, gitOk, inGitRepo, setupCompleted, configDirReady, messages }
}

export async function runSetup(options: SetupOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const color = interactive && isColorEnabled()
  const version = packageVersion(options.cliImportMetaUrl)

  if (options.reset) {
    resetSetupCompleted()
    console.log(tone('ok', 'Setup marker cleared. Run `diffing setup` to configure again.', { color }))
    return 0
  }

  const preflight = runSetupCheck({ cwd })
  if (options.check) {
    printCheckReport(preflight, version, color)
    return preflight.ok ? 0 : 1
  }

  console.log(
    box(
      'diffing setup',
      [dim(`v${version} — first-time configuration wizard`, color)],
      { color },
    ),
  )

  printStep(1, 'Environment', color)

  if (!preflight.nodeOk) {
    console.error(tone('error', `Node.js >= 20 required (found ${process.versions.node})`, { color }))
    return 1
  }
  if (!preflight.gitOk) {
    console.error(tone('error', 'git not found on PATH — install git and retry.', { color }))
    return 1
  }
  ensureConfigDir()
  console.log(tone('ok', 'Config directory ready (~/.config/diffing/)', { color }))
  if (preflight.inGitRepo) {
    try {
      console.log(tone('ok', `Git repository: ${getRepoRoot()}`, { color }))
    } catch {
      console.log(tone('warn', 'Not inside a Git repository — review commands need a repo later', { color }))
    }
  } else {
    console.log(tone('warn', 'Not inside a Git repository — you can still finish setup', { color }))
  }

  if (options.skillsOnly) {
    return runSkillsStep(options, interactive, color, 5)
  }
  if (options.mcpOnly) {
    return runMcpStep(cwd, options, interactive, preflight.inGitRepo, color, 6)
  }

  printStep(2, 'Environment checks', color)
  console.log(dim('Running `diffing doctor`…', color))
  const doctor = await runDoctor({ cwd, cliImportMetaUrl: options.cliImportMetaUrl })
  console.log(formatDoctorReport(doctor, { color }))

  printStep(3, 'Default mode', color)
  if (!options.yes) {
    await askDefaultMode(interactive, color)
  } else {
    console.log(
      tone('ok', `Default mode: ${formatModeLabel(loadSettings().defaultMode)} (unchanged)`, { color }),
    )
  }

  printStep(4, 'Shell completions', color)
  await runCompletionsStep(options, interactive, color)

  printStep(5, 'Agent skills', color)
  const skillsCode = await runSkillsStep(options, interactive, color, 5)
  if (skillsCode !== 0) return skillsCode

  printStep(6, 'MCP registration', color)
  const mcpCode = await runMcpStep(cwd, options, interactive, preflight.inGitRepo, color, 6)
  if (mcpCode !== 0) return mcpCode

  markSetupCompleted()
  printDoneChecklist(preflight.inGitRepo, cwd, color)
  return 0
}

async function runSkillsStep(
  options: SetupOptions,
  interactive: boolean,
  color: boolean,
  _step?: number,
): Promise<number> {
  const cmd = formatSkillsInstallCommand()
  const install =
    options.yes ||
    (await askYesNo(`Install agent skills via \`${cmd}\`?`, true, interactive, color))
  if (!install) {
    console.log(dim('Skipped skills install.', color))
    return 0
  }
  if (options.yes && !process.stdin.isTTY) {
    console.log(dim(`Running: ${cmd}`, color))
  }
  const code = await runSkillsInstall({ cwd: options.cwd })
  if (code === 0) {
    console.log(tone('ok', 'Skills installed (or already present)', { color }))
  } else {
    console.error(tone('error', `Skills install exited with code ${code}`, { color }))
    console.error(dim(`  You can retry manually: ${cmd}`, color))
    return options.yes ? 0 : code
  }
  return 0
}

async function runMcpStep(
  cwd: string,
  options: SetupOptions,
  interactive: boolean,
  inGitRepo: boolean,
  color: boolean,
  _step?: number,
): Promise<number> {
  let repoPath: string | undefined
  if (inGitRepo) {
    try {
      repoPath = getRepoRoot()
    } catch {
      repoPath = undefined
    }
  }
  const entry = buildDiffingMcpEntry(repoPath)
  const snippet = formatMcpSnippet(entry)

  if (options.writeMcp || options.writeProjectMcp) {
    if (options.writeMcp) {
      const results = writeGlobalMcpConfigs(entry)
      for (const r of results) {
        if (r.written) {
          const backup = r.backupPath ? ` (backup: ${r.backupPath})` : ''
          console.log(tone('ok', `Wrote MCP config: ${r.path}${backup}`, { color }))
        }
      }
    }
    if (options.writeProjectMcp) {
      const r = writeProjectMcpConfig(cwd, entry)
      const backup = r.backupPath ? ` (backup: ${r.backupPath})` : ''
      console.log(tone('ok', `Wrote project MCP config: ${r.path}${backup}`, { color }))
    }
    return 0
  }

  console.log(tone('info', 'MCP registration (paste into your agent client):', { color }))
  console.log(copyBlock('Copy MCP JSON', snippet, { color }))

  const clients = detectGlobalMcpClients()
  const detected = clients.filter((c) => c.id === 'cursor' || c.id === 'claude-desktop')
  if (detected.length > 0) {
    console.log('')
    console.log(tone('info', 'Detected clients:', { color }))
    for (const c of detected) console.log(dim(`  • ${c.label}: ${c.path}`, color))
  }

  if (options.yes) {
    console.log(dim('\n(--yes prints MCP JSON only; pass --write-mcp to merge into IDE configs)', color))
    return 0
  }

  const writeGlobal = await askYesNo(
    'Write diffing MCP entry to global IDE configs?',
    false,
    interactive,
    color,
  )
  if (writeGlobal) {
    writeGlobalMcpConfigs(entry).forEach((r) => {
      if (r.written) console.log(tone('ok', `Wrote ${r.path}`, { color }))
    })
  }

  const writeProject = await askYesNo(
    'Also write project-local .cursor/mcp.json in the current directory?',
    false,
    interactive,
    color,
  )
  if (writeProject) {
    const r = writeProjectMcpConfig(cwd, entry)
    if (r.written) console.log(tone('ok', `Wrote ${r.path}`, { color }))
  }

  return 0
}

async function runCompletionsStep(
  options: SetupOptions,
  interactive: boolean,
  color: boolean,
): Promise<void> {
  const shells = ['bash', 'zsh', 'fish'] as const
  if (options.writeCompletions) {
    for (const shell of shells) {
      const script = completionFor(shell)
      if (script) console.log(copyBlock(`${shell} completion`, script, { color }))
    }
    return
  }
  if (options.yes) {
    console.log(
      dim('Shell completions: run `diffing completion <bash|zsh|fish>` and append to your shell rc.', color),
    )
    return
  }
  const show = await askYesNo('Print shell completion scripts?', false, interactive, color)
  if (!show) return
  for (const shell of shells) {
    const script = completionFor(shell)
    if (script) {
      console.log(copyBlock(`${shell} completion`, script, { color }))
    }
  }
}

function printCheckReport(result: SetupCheckResult, version: string, color: boolean): void {
  console.log(
    box('diffing setup --check', [dim(`v${version}`, color)], { color }),
  )
  console.log(rule({ color }))
  console.log(result.nodeOk ? tone('ok', 'Node.js >= 20', { color }) : tone('error', 'Node.js >= 20', { color }))
  console.log(result.gitOk ? tone('ok', 'git on PATH', { color }) : tone('error', 'git on PATH', { color }))
  console.log(
    result.configDirReady
      ? tone('ok', '~/.config/diffing/', { color })
      : tone('error', 'config dir', { color }),
  )
  console.log(
    result.inGitRepo
      ? tone('ok', 'inside Git repository', { color })
      : tone('warn', 'not in a Git repository', { color }),
  )
  console.log(
    result.setupCompleted
      ? tone('ok', 'setup completed previously', { color })
      : tone('warn', 'setup not completed', { color }),
  )
  for (const msg of result.messages) console.log(dim(`  ${msg}`, color))
}

function printDoneChecklist(inGitRepo: boolean, cwd: string, color: boolean): void {
  const nextSteps = inGitRepo
    ? [
        'diffing              Open the review UI',
        'diffing doctor       Re-run diagnostics anytime',
      ]
    : [
        'cd <your-repo> && diffing',
        `# current directory: ${cwd}`,
      ]
  console.log(
    box(
      'Setup complete',
      [
        tone('ok', 'Settings saved', { color }),
        tone('ok', 'Environment checked (`diffing doctor`)', { color }),
        '',
        tone('info', 'Next steps:', { color }),
        ...nextSteps.map((line) => `  ${line}`),
        '',
        `Docs: ${DOCS_GETTING_STARTED_URL}`,
        dim('CLI reference: docs/cli.md', color),
      ],
      { color },
    ),
  )
}

export async function handleFirstRunGate(options: {
  skipSetup?: boolean
  cliImportMetaUrl?: string
}): Promise<void> {
  const { shouldOfferFirstRunSetup, promptFirstRunSetup, DOCS_GETTING_STARTED_URL } = await import(
    './setup-first-run.js'
  )
  if (!shouldOfferFirstRunSetup({ skipSetup: options.skipSetup })) {
    return
  }

  while (true) {
    const choice = await promptFirstRunSetup()
    if (choice === 'skip') return
    if (choice === 'docs') {
      console.log(`\nGetting started: ${DOCS_GETTING_STARTED_URL}\n`)
      continue
    }
    const code = await runSetup({ cliImportMetaUrl: options.cliImportMetaUrl, interactive: true })
    if (code !== 0) process.exit(code)
    return
  }
}
