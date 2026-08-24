import {
  activateServerLock,
  listServerLocks,
  resolveActiveServerLock,
  sameServerSession,
  serverSessionId,
  type ServerLock,
} from './server-lock.js'
import {
  existingSessionUrl,
  openExistingSession,
  stopLockOwner,
} from './session-conflict.js'

const EXIT_OK = 0
const EXIT_NOT_FOUND = 4
const EXIT_USAGE = 5

interface SessionSummary {
  id: string
  active: boolean
  mode: 'web' | 'tui' | 'gh-pr'
  pid: number
  startedAt: number
  url: string | null
  scope: string
}

function scopeLabel(lock: ServerLock): string {
  if (lock.prRef) return `PR ${lock.prRef}`
  if (lock.diffArgs?.length) return lock.diffArgs.join(' ')
  if (!lock.scope) return 'working tree'
  try {
    const scope = JSON.parse(lock.scope) as {
      revisions?: string[]
      pathspecs?: string[]
      staged?: boolean
      showMode?: boolean
    }
    const parts: string[] = []
    if (scope.showMode) parts.push('show')
    if (scope.staged) parts.push('staged')
    if (scope.revisions?.length) parts.push(scope.revisions.join(' '))
    if (scope.pathspecs?.length) parts.push(`-- ${scope.pathspecs.join(' ')}`)
    return parts.join(' ') || 'working tree'
  } catch {
    return 'custom diff'
  }
}

function summarize(lock: ServerLock, active: ServerLock | null): SessionSummary {
  return {
    id: serverSessionId(lock),
    active: active ? sameServerSession(lock, active) : false,
    mode: lock.mode ?? 'web',
    pid: lock.pid,
    startedAt: lock.startedAt,
    url: existingSessionUrl(lock),
    scope: scopeLabel(lock),
  }
}

function formatAge(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function printSessions(sessions: ServerLock[], active: ServerLock | null): void {
  if (sessions.length === 0) {
    console.log('No diffing sessions are running for this repository.')
    return
  }
  console.log('ACTIVE  ID        MODE   PID      AGE   SCOPE / URL')
  for (const lock of sessions) {
    const summary = summarize(lock, active)
    const activeMark = summary.active ? '*' : ''
    const target = summary.url ? `${summary.scope}  ${summary.url}` : summary.scope
    console.log(
      `${activeMark.padEnd(7)} ${summary.id.slice(0, 8).padEnd(9)} ` +
      `${summary.mode.padEnd(6)} ${String(summary.pid).padEnd(8)} ` +
      `${formatAge(summary.startedAt).padEnd(5)} ${target}`,
    )
  }
  console.log('\nUse `diffing sessions use <id>` to retarget agent commands.')
}

function findSession(selector: string, sessions: ServerLock[], active: ServerLock | null): ServerLock {
  if (selector === 'active') {
    if (active) return active
    throw new Error('No active diffing session is running.')
  }
  const matches = sessions.filter((lock) => serverSessionId(lock).startsWith(selector))
  if (matches.length === 0) throw new Error(`No live diffing session matches ${JSON.stringify(selector)}.`)
  if (matches.length > 1) throw new Error(`Session prefix ${JSON.stringify(selector)} is ambiguous.`)
  return matches[0]
}

function usage(): void {
  console.error(`Usage:
  diffing sessions [list] [--json]
  diffing sessions use <id>
  diffing sessions open [<id>|active] [--no-open]
  diffing sessions stop|kill <id>|active|all`)
}

/** Repository-local task manager for every live web, TUI, and PR session. */
export async function runSessionsCommand(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    usage()
    return EXIT_OK
  }

  const action = args[0] && !args[0].startsWith('-') ? args[0] : 'list'
  const rest = action === 'list' && args[0] !== 'list' ? args : args.slice(1)
  const sessions = listServerLocks()
  const active = resolveActiveServerLock()

  if (action === 'list') {
    const unknown = rest.filter((arg) => arg !== '--json')
    if (unknown.length > 0) {
      usage()
      return EXIT_USAGE
    }
    if (rest.includes('--json')) {
      process.stdout.write(JSON.stringify(sessions.map((lock) => summarize(lock, active)), null, 2) + '\n')
    } else {
      printSessions(sessions, active)
    }
    return EXIT_OK
  }

  if (action === 'use') {
    if (rest.length !== 1) {
      usage()
      return EXIT_USAGE
    }
    try {
      const selected = findSession(rest[0], sessions, active)
      activateServerLock(selected)
      console.log(`Active diffing session set to ${serverSessionId(selected).slice(0, 8)} (${selected.mode ?? 'web'}).`)
      return EXIT_OK
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return EXIT_NOT_FOUND
    }
  }

  if (action === 'open') {
    const noOpen = rest.includes('--no-open')
    const positionals = rest.filter((arg) => arg !== '--no-open')
    if (positionals.length > 1) {
      usage()
      return EXIT_USAGE
    }
    try {
      const selected = findSession(positionals[0] ?? 'active', sessions, active)
      await openExistingSession(selected, { noOpen })
      activateServerLock(selected)
      return EXIT_OK
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return EXIT_NOT_FOUND
    }
  }

  if (action === 'stop' || action === 'kill') {
    if (rest.length !== 1) {
      usage()
      return EXIT_USAGE
    }
    let targets: ServerLock[]
    try {
      targets = rest[0] === 'all' ? sessions : [findSession(rest[0], sessions, active)]
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return EXIT_NOT_FOUND
    }
    if (targets.length === 0) {
      console.log('No diffing sessions are running for this repository.')
      return EXIT_OK
    }
    let failed = false
    for (const target of targets) {
      const id = serverSessionId(target).slice(0, 8)
      try {
        console.error(`Stopping ${id} (${target.mode ?? 'web'}, pid ${target.pid})…`)
        await stopLockOwner(target)
      } catch (error) {
        failed = true
        console.error(error instanceof Error ? error.message : String(error))
      }
    }
    if (!failed) console.log(`Stopped ${targets.length} diffing session${targets.length === 1 ? '' : 's'}.`)
    return failed ? 1 : EXIT_OK
  }

  usage()
  return EXIT_USAGE
}
