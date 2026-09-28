/** What the palette is listing, read off the first character in its field.
 *
 *  The text in the box is what the mode is made of, the way VS Code's quick open
 *  reads it: `>` for the commands, and two of VS Code's other marks, for the note in
 *  front - `#` for its headings, since that is how a heading is written and linked,
 *  and `:` and a number for a line of it. Anything else is a note's name. Deleting
 *  the mark is the way back, so there is nothing to learn beyond the mark itself. */

export type PaletteMode = 'notes' | 'commands' | 'headings' | 'line'

const MARKS: Record<string, PaletteMode> = {
  '>': 'commands',
  '#': 'headings',
  ':': 'line',
}

export function modeOf(query: string): { mode: PaletteMode; term: string } {
  const mode = MARKS[query.charAt(0)]
  return mode ? { mode, term: query.slice(1).trim() } : { mode: 'notes', term: query.trim() }
}

/** The line a `:` asks for, counting from zero, in a note `lines` long; null for
 *  anything that is not a number. Past the end is the last line, as VS Code has
 *  it: the reader who typed 900 into a note of 300 wanted the bottom. */
export function lineAsked(term: string, lines: number): number | null {
  if (!/^\d+$/.test(term) || lines < 1) return null

  return Math.min(Math.max(Number(term), 1), lines) - 1
}
