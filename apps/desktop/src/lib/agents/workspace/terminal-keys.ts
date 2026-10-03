/** What an agent types into one of the reader's terminals, and what it reads back off
 *  one, as bytes and as words. Pure; see terminal-tab.ts.
 *
 *  Keys by name rather than as escapes, so an agent says `Ctrl+C` and never has to know
 *  that an arrow is two different sequences depending on what the program in front
 *  asked for (application cursor keys, which vim and less switch on). */

import { programOf, startsOnlyOne } from './shell-text'

/** The keys an agent may press, and what each sends. Nothing that opens a picker,
 *  nothing the app itself is bound to: these reach the shell and nothing else. */
const KEYS: Record<string, string> = {
  Enter: '\r',
  Tab: '\t',
  Escape: '\x1b',
  Backspace: '\x7f',
  Up: 'A',
  Down: 'B',
  Right: 'C',
  Left: 'D',
  'Ctrl+C': '\x03',
  'Ctrl+D': '\x04',
  'Ctrl+L': '\x0c',
  'Ctrl+Z': '\x1a',
}

/** The keys an agent may name, in the order a refusal lists them. */
export const KEY_NAMES = Object.keys(KEYS)

/** The arrows, which are a final letter after the prefix the program asked for. */
const ARROWS = new Set(['Up', 'Down', 'Right', 'Left'])

/** The one key that may be pressed without asking: an interrupt stops what an agent
 *  started, and starts nothing. */
const FREE = new Set(['Ctrl+C'])

/** What a list of key names sends, or the first name that is not one. */
export function keyBytes(
  names: readonly string[],
  applicationCursor: boolean,
): { bytes: string } | { unknown: string } {
  let bytes = ''
  for (const name of names) {
    const sent = KEYS[name]
    if (sent === undefined) return { unknown: name }
    bytes += ARROWS.has(name) ? `${applicationCursor ? '\x1bO' : '\x1b['}${sent}` : sent
  }

  return { bytes }
}

/** Whether typing runs without asking the reader: exactly one command line, the first
 *  program on the agent's own list, ended with Enter and nothing else - the rule
 *  `run_terminal` keeps (docs/agent-native.md 9.3) - or an interrupt and nothing else.
 *  Anything typed without Enter asks too: the Enter that runs it could come in the next
 *  call, where there is no command left to judge. */
export function typesFreely(
  text: string,
  enter: boolean,
  keys: readonly string[],
  programs: readonly string[],
): boolean {
  if (!text && !enter) return keys.length > 0 && keys.every((name) => FREE.has(name))
  if (keys.length || !enter || !text.trim() || !startsOnlyOne(text)) return false

  return programs.map((one) => one.toLowerCase()).includes(programOf(text))
}

/** One row of a terminal's buffer, as xterm.js hands it over. */
export interface Row {
  isWrapped: boolean
  translateToString(trimRight?: boolean): string
}

/** The lines of a buffer from row `from` on, as a person reads them: a line the screen
 *  wrapped is one line again, the right edge's spaces gone, and the empty rows under the
 *  last thing printed left out. `most` lines at the end, at the most. */
export function linesOf(
  rows: { length: number; getLine(at: number): Row | undefined },
  from: number,
  most: number,
): { text: string; truncated: boolean } {
  const lines: string[] = []
  for (let at = Math.max(0, from); at < rows.length; at++) {
    const row = rows.getLine(at)
    if (!row) continue

    const words = row.translateToString(true)
    const last = lines.length - 1
    if (row.isWrapped && last >= 0) lines[last] = `${lines[last] ?? ''}${words}`
    else lines.push(words)
  }

  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop()
  const truncated = lines.length > most
  return { text: (truncated ? lines.slice(-most) : lines).join('\n'), truncated }
}
