/**
 * Resolve the platform-specific command for launching the user's chosen
 * editor on a given file. Returns `{ cmd, args }` ready to pass to
 * `child_process.execFile` (no shell, so paths with spaces / quotes are safe).
 *
 * GUI editors (`vscode`, `zed`) launch directly via their PATH binary on
 * every platform. Terminal editors (`vim`, `neovim`) need a console window
 * to host them — this is the cross-platform mess we untangle here.
 */

export type EditorChoice = 'vscode' | 'zed' | 'vim' | 'neovim'

export interface EditorCommand {
  cmd: string
  args: string[]
}

export function resolveEditorCommand(
  editor: EditorChoice,
  absolutePath: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): EditorCommand | null {
  switch (editor) {
    case 'vscode':
      return guiEditorCommand('code', absolutePath, platform)
    case 'zed':
      return guiEditorCommand('zed', absolutePath, platform)
    case 'vim':
      return terminalEditorCommand('vim', absolutePath, platform, env)
    case 'neovim':
      return terminalEditorCommand('nvim', absolutePath, platform, env)
    default:
      return null
  }
}

function guiEditorCommand(
  bin: string,
  absolutePath: string,
  platform: NodeJS.Platform,
): EditorCommand {
  // `code` ships as `code.cmd` on Windows; PATHEXT resolution would normally
  // handle that, but Node's `execFile` on Windows requires `shell: true` to
  // honour PATHEXT, and we want to avoid `shell: true` to keep argument
  // quoting deterministic. So we name the `.cmd` explicitly on Windows and
  // let execFile launch it directly.
  if (platform === 'win32') {
    return { cmd: `${bin}.cmd`, args: [absolutePath] }
  }
  return { cmd: bin, args: [absolutePath] }
}

function terminalEditorCommand(
  bin: string,
  absolutePath: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): EditorCommand {
  if (platform === 'darwin') {
    // Escape backslashes first, then double-quotes — otherwise the second
    // pass would re-escape the backslashes we just inserted.
    const escaped = absolutePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return {
      cmd: 'osascript',
      args: [
        '-e',
        `tell application "Terminal" to do script "${bin} \\"${escaped}\\""`,
      ],
    }
  }

  if (platform === 'win32') {
    // `start` is a cmd.exe builtin (not a standalone exe). The empty `""` is
    // the window title — required because `start`'s first quoted token is
    // always interpreted as the title. `/k` keeps the new console alive
    // after the editor exits so the user can read any error message.
    return {
      cmd: 'cmd.exe',
      args: ['/c', 'start', '""', 'cmd.exe', '/k', bin, absolutePath],
    }
  }

  // Linux + other Unix-likes: prefer the user's $TERMINAL when set, otherwise
  // fall back to `x-terminal-emulator` (Debian/Ubuntu/Mint via
  // update-alternatives) which in turn points at whatever the user has
  // installed. If the binary is missing we surface the spawn error to the
  // client — there is no portable terminal-detection API.
  const term = env.TERMINAL?.trim()
  if (term) {
    return { cmd: term, args: ['-e', bin, absolutePath] }
  }
  return { cmd: 'x-terminal-emulator', args: ['-e', bin, absolutePath] }
}
