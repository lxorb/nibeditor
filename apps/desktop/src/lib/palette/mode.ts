/** What the palette is narrowed to, read off the first character in its field.
 *
 *  Nothing, by default: the palette is one search over everything, and a person
 *  never has to say which list the thing they are after is in. The marks are there
 *  for a hand that knows them, the way VS Code's quick open reads them: `>` for the
 *  commands alone, and two of VS Code's other marks for the note in front - `#` for
 *  its headings, since that is how a heading is written and linked, and `:` and a
 *  number for a line of it. Deleting the mark is the way back to everything. */

export type PaletteMode = 'everything' | 'commands' | 'headings' | 'line' | 'hosts'

const MARKS: Record<string, PaletteMode> = {
  '>': 'commands',
  '#': 'headings',
  ':': 'line',
}

/** `ssh` and a space: the hosts alone, as a terminal's own command would reach them. */
const SSH = /^ssh\s+/i

export function modeOf(query: string): { mode: PaletteMode; term: string } {
  const ssh = SSH.exec(query)
  if (ssh) return { mode: 'hosts', term: query.slice(ssh[0].length).trim() }

  const mode = MARKS[query.charAt(0)]
  return mode ? { mode, term: query.slice(1).trim() } : { mode: 'everything', term: query.trim() }
}

/** The line a `:` asks for, counting from zero, in a note `lines` long; null for
 *  anything that is not a number. Past the end is the last line, as VS Code has
 *  it: the reader who typed 900 into a note of 300 wanted the bottom. */
export function lineAsked(term: string, lines: number): number | null {
  if (!/^\d+$/.test(term) || lines < 1) return null

  return Math.min(Math.max(Number(term), 1), lines) - 1
}
