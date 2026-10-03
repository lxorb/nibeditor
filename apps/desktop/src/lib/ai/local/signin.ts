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

/** The line that runs a program's login, spelled for the shell it is typed into: the
 *  path in double quotes for Command Prompt, in single quotes for a POSIX shell (and
 *  fish, which reads them the same way). */
export function loginLine(kind: LocalKind, program: string, windows: boolean, out = false): string {
  const quoted = windows ? `"${program}"` : `'${program.replace(/'/g, `'\\''`)}'`
  return `${quoted} ${(out ? LOGOUT : LOGIN)[kind]}`
}

/** Opens a terminal running the program's login, and says whether the line was typed. */
export async function signIn(kind: LocalKind, program: string): Promise<boolean> {
  return await typeInTerminal(kind, program, false)
}

/** The same with the program's logout (`/logout`). */
export async function signOut(kind: LocalKind, program: string): Promise<boolean> {
  return await typeInTerminal(kind, program, true)
}

async function typeInTerminal(kind: LocalKind, program: string, out: boolean): Promise<boolean> {
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

  const line = `${loginLine(kind, program, windows, out)}\r`
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
