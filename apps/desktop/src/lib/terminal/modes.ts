/** The modes a program switches on for itself, and the one moment they are switched off
 *  for it: the shell asking for its next line.
 *
 *  A full-screen program - Claude Code, vim, htop, less - asks the terminal to report the
 *  mouse (DECSET 1000 to 1003, in the 1005, 1006, 1015 or 1016 encoding), to say when the
 *  window gains and loses the keyboard (1004), to send its own codes for the arrows and
 *  the keypad, to hold its frames until they are whole (2026) and to draw on a second
 *  screen (1049). It switches them off as it leaves. One that crashes, is killed or is
 *  interrupted does not, and the prompt after it then has every move of the mouse typed
 *  at it as a report: Emil, 2026-10-01, a PowerShell prompt filling with `C"1C%0C` and
 *  on after Claude Code.
 *
 *  So the shells nib starts mark each prompt with FinalTerm's prompt mark, OSC 133;A, the
 *  one Windows Terminal, iTerm2, kitty and WezTerm read (VS Code's own is 633;A, read too),
 *  and a prompt mark switches off whatever was left on - before the prompt is drawn, and
 *  before the line editor sets up what it wants for the line: bash, zsh, fish and
 *  PSReadLine switch bracketed paste on for each line themselves, so paste is left to
 *  them and switched off only for Command Prompt, which never asks. Nothing a running
 *  program needs is touched: the shell only draws a prompt once it is in front again. A
 *  shell nobody taught to mark its prompts is asked for in the kernel instead; see
 *  `Session.idle` in sessions.svelte.ts.
 *
 *  Pure: the byte scan and the sequences, tested on their own. */

import type { IModes } from '@xterm/xterm'

/** The two prompt marks, as bytes: `ESC ] 133 ; A` and `ESC ] 633 ; A`. */
const MARKS = ['\x1b]133;A', '\x1b]633;A'].map((mark) => new TextEncoder().encode(mark))

const BEL = 0x07
const ESC = 0x1b
const BACKSLASH = 0x5c

/** Where the first prompt mark in `bytes` ends: just past its terminator, BEL or ESC \.
 *  -1 where there is none, or where the chunk ends before the mark does - the next
 *  prompt's mark is found instead. */
export function promptEnd(bytes: Uint8Array): number {
  for (let at = bytes.indexOf(ESC); at >= 0; at = bytes.indexOf(ESC, at + 1)) {
    const mark = MARKS.find((one) => one.every((byte, step) => bytes[at + step] === byte))
    if (!mark) continue

    for (let end = at + mark.length; end < bytes.length; end++) {
      if (bytes[end] === BEL) return end + 1
      if (bytes[end] === ESC) return bytes[end + 1] === BACKSLASH ? end + 2 : -1
    }
    return -1
  }
  return -1
}

/** What is on as a prompt arrives: the modes xterm.js reports, and whether the second
 *  screen is up. */
export interface Left {
  modes: Pick<
    IModes,
    | 'mouseTrackingMode'
    | 'sendFocusMode'
    | 'applicationCursorKeysMode'
    | 'applicationKeypadMode'
    | 'bracketedPasteMode'
    | 'synchronizedOutputMode'
  >
  alternate: boolean
}

/** Mouse reporting off, in every encoding a program may have asked for it in. */
const MOUSE_OFF = [9, 1000, 1001, 1002, 1003, 1005, 1006, 1015, 1016]
  .map((mode) => `\x1b[?${mode}l`)
  .join('')

/** The sequences that switch off whatever `left` has on - nothing at all for a terminal
 *  nothing was left on in, which is almost every prompt - and, with them, show the cursor
 *  such a program hides. `paste` says whether bracketed paste is the shell's own to switch on
 *  and off (see above): false for Command Prompt. `all` is false where the prompt may be
 *  drawn already, which leaves the keys and the screen alone: those are the line editor's
 *  once it is reading. */
export function tidied(left: Left, paste: boolean, all = true): string {
  const { modes } = left
  let out = ''
  if (all && left.alternate) out += '\x1b[?1049l'
  if (modes.mouseTrackingMode !== 'none') out += MOUSE_OFF
  if (modes.sendFocusMode) out += '\x1b[?1004l'
  if (modes.synchronizedOutputMode) out += '\x1b[?2026l'
  if (all && modes.applicationCursorKeysMode) out += '\x1b[?1l'
  if (all && modes.applicationKeypadMode) out += '\x1b>'
  if (all && !paste && modes.bracketedPasteMode) out += '\x1b[?2004l'
  return out && `${out}\x1b[?25h`
}

/** Whether a shell switches bracketed paste on and off itself for each line: every one
 *  but Command Prompt, and the Developer Command Prompt that is Command Prompt too. */
export function pastesItself(shell: string): boolean {
  return shell !== 'cmd' && !shell.startsWith('vs-cmd:')
}

/** Whether a mouse or focus report could reach the shell as typing: what the fallback
 *  in `Session.idle` looks for before asking the kernel anything. */
export function reporting(left: Left): boolean {
  return left.modes.mouseTrackingMode !== 'none' || left.modes.sendFocusMode
}
