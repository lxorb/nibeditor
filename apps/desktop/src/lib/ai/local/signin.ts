/** Signing in to Claude Code or Codex: their own login, in a terminal tab of nib's.
 *
 *  nib never signs anybody in to either. Anthropic's terms say a Claude sign-in must go
 *  through Anthropic's own flow, and the one honest way to hand somebody the flow a
 *  program has is to run the program: so a terminal tab opens, the program's own login
 *  is typed into it (`claude auth login`, `codex login`), and the reader finishes it in
 *  their browser the way the program asks them to. nib then asks the program, every few
 *  seconds, whether it is signed in yet; see status.svelte.ts.
 *
 *  The tab is an ordinary terminal made through the terminal's own door, `openTerminal`,
 *  and the line is typed into its shell the way a paste is, once the shell is there. On
 *  Windows the shell is always Command Prompt, whose quoting a path to a `.cmd` or an
 *  `.exe` survives in every case; elsewhere it is the reader's own shell. */

import { invoke, platform } from '../../tauri'
import { waited } from '../../timing'
import type { LocalKind } from '../providers'

/** What each program's own login and logout are, after its name. */
const LOGIN: Record<LocalKind, string> = {
  'claude-code': 'auth login',
  codex: 'login',
}
const LOGOUT: Record<LocalKind, string> = {
  'claude-code': 'auth logout',
  codex: 'logout',
}

/** How long the shell has to start before the line is given up on. */
const STARTING = 20_000

/** The variable each program reads a second account's home from; see home.rs in
 *  src-tauri/src/ai_cli. */
const HOME_VARIABLE: Record<LocalKind, string> = {
  'claude-code': 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
}

/** A word in single quotes for a POSIX shell, and fish, which reads them the same way. */
const posix = (word: string) => `'${word.replace(/'/g, `'\\''`)}'`

/** The line that runs a program's login, spelled for the shell it is typed into: the
 *  path in double quotes for Command Prompt, in single quotes for a POSIX shell. A second
 *  account's login is the same line in that account's home. */
export function loginLine(
  kind: LocalKind,
  program: string,
  windows: boolean,
  out = false,
  home: string | null = null,
): string {
  const quoted = windows ? `"${program}"` : posix(program)
  const line = `${quoted} ${(out ? LOGOUT : LOGIN)[kind]}`
  if (!home) return line
  return windows
    ? `set "${HOME_VARIABLE[kind]}=${home}" && ${line}`
    : `${HOME_VARIABLE[kind]}=${posix(home)} ${line}`
}

/** Opens a terminal running the program's login, in the account's home where it has one
 *  of nib's, and says whether the line was typed. */
export async function signIn(
  kind: LocalKind,
  program: string,
  home: string | null = null,
): Promise<boolean> {
  return await typeInTerminal(kind, program, false, home)
}

/** The same with the program's logout (`/logout`). */
export async function signOut(
  kind: LocalKind,
  program: string,
  home: string | null = null,
): Promise<boolean> {
  return await typeInTerminal(kind, program, true, home)
}

async function typeInTerminal(
  kind: LocalKind,
  program: string,
  out: boolean,
  home: string | null,
): Promise<boolean> {
  const [{ openTerminal }, { shells }, { ptyOf }, { workspace }] = await Promise.all([
    import('../../terminal/open'),
    import('../../terminal/shells.svelte'),
    import('../../terminal/running'),
    import('../../workspace.svelte'),
  ])

  const windows = platform() === 'windows'
  const list = await shells.ask()
  const shell = (windows ? list.find((one) => one.id === 'cmd') : undefined) ?? shells.chosen
  if (!shell) return false

  await openTerminal(shell.id, { folder: null })
  const tab = workspace.activeTabId
  if (!tab) return false

  const line = `${loginLine(kind, program, windows, out, home)}\r`
  const started = Date.now()
  while (Date.now() - started < STARTING) {
    const pty = ptyOf(tab)
    // The shell's session is named before it has started, and a write to one that has
    // not is refused: so the line is tried until the shell takes it.
    const typed =
      pty !== undefined &&
      (await invoke('pty_write', { id: pty, data: line, binary: false }).then(
        () => true,
        () => false,
      ))
    if (typed) return true
    await waited(150)
  }
  return false
}
