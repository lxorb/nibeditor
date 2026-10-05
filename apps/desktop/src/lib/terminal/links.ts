/** The web addresses on a terminal's screen, found across the rows they were broken over.
 *
 *  A line too long for the screen wraps, and xterm.js knows which rows are one line - the
 *  web-links addon joins those and nothing else. But a program that lays out its own
 *  screen, as Claude Code and Codex do with Ink, breaks a long address itself, row by
 *  row, and to the terminal that is lines that happen to be full. Clicking one then
 *  opened the address up to the break: Claude Code's sign-in link lost half its scopes.
 *
 *  So a row also runs on into the next when it was full to its last column with an
 *  address still going (iTerm2's "newline at the right edge" heuristic), the next row
 *  goes on in address characters and does not begin an address of its own, and what it
 *  goes on with is either the whole row again or the last thing on it. Two addresses
 *  each a row long stay two, and a sentence under an address that happened to end at the
 *  edge is not taken into it.
 *
 *  One provider for every terminal, local or online, and the copy of a selection inside
 *  one address that runs over such a break is the address, without the breaks. */

import type { IBuffer, IBufferCell, ILink, ILinkProvider, Terminal } from '@xterm/xterm'

/** The web-links addon's own: an http(s) address, without what usually ends the sentence
 *  around it. */
const URL = /https?:\/\/[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/gi
/** What an address is made of, and what one begins with. */
const PART = /[^\s"'!*(){}|\\^<>`]/
const LEADING = /^[^\s"'!*(){}|\\^<>`]+/
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
/** How far a line is followed up and down, which bounds the work per hovered row. */
const FURTHEST = 64

/** A cell, 0-based. */
export interface Cell {
  x: number
  y: number
}

export interface Found {
  text: string
  /** The first and the last cell, inclusive. */
  start: Cell
  end: Cell
}

/** One row as text, with the cell each code unit came from. Never-written cells are
 *  spaces; the second half of a wide character is nothing. */
interface Row {
  text: string
  at: Cell[]
  wide: boolean[]
}

function rowOf(buffer: IBuffer, y: number, cols: number, cell: IBufferCell): Row | null {
  const line = buffer.getLine(y)
  if (!line) return null
  let text = ''
  const at: Cell[] = []
  const wide: boolean[] = []
  for (let x = 0; x < Math.min(cols, line.length); x++) {
    line.getCell(x, cell)
    const width = cell.getWidth()
    if (width === 0) continue
    const chars = cell.getChars() || ' '
    // One entry per code unit, not per character, so an index into `text` is one here.
    for (const unit of chars.split('')) {
      at.push({ x, y })
      wide.push(width > 1)
      text += unit
    }
  }
  return { text, at, wide }
}

/** The row with what a full row leaves blank at its end taken off: a wide character
 *  too wide for the last column goes to the next row and leaves an empty cell behind. */
function trimmed(row: Row): Row {
  const text = row.text.replace(/ +$/, '')
  return { text, at: row.at.slice(0, text.length), wide: row.wide.slice(0, text.length) }
}

/** Whether `next` reads as the rest of an address `before` broke off at the edge -
 *  everything but whether an address is in progress, which needs the line above. */
function looksContinued(before: Row, next: Row): boolean {
  if (!PART.test(before.text.at(-1) ?? ' ')) return false
  const leading = LEADING.exec(next.text)?.[0]
  if (!leading || SCHEME.test(leading)) return false
  return leading.length === next.text.length || next.text.slice(leading.length).trim() === ''
}

/** Whether the line so far ends inside an address. */
function inAddress(text: string): boolean {
  const run = /\S*$/.exec(text)?.[0] ?? ''
  return run.includes('://')
}

/** The logical line row `y` belongs to: rows xterm.js wrapped, and rows a program broke
 *  an address over. Also says whether any break in it was a program's. */
function lineAround(buffer: IBuffer, cols: number, y: number) {
  const cell = buffer.getNullCell()
  const rows = new Map<number, Row | null>()
  const row = (at: number) => {
    if (!rows.has(at)) rows.set(at, rowOf(buffer, at, cols, cell))
    return rows.get(at) ?? null
  }
  const joins = (above: number, below: number) => {
    const a = row(above)
    const b = row(below)
    if (!a || !b) return false
    return buffer.getLine(below)?.isWrapped === true || looksContinued(a, b)
  }

  // Up as far as rows could be one line, then down again from there, where whether an
  // address is in progress can be read; the line `y` is in is the run that holds it.
  let top = y
  while (top > 0 && y - top < FURTHEST && joins(top - 1, top)) top--

  let line = row(top)
  if (!line) return null
  let broken = false
  for (let next = top + 1; next - top < 2 * FURTHEST; next++) {
    const below = row(next)
    if (!below) break
    const soft = buffer.getLine(next)?.isWrapped === true
    const hard = !soft && looksContinued(line, below) && inAddress(line.text)
    if (!soft && !hard) {
      if (next > y) break
      // A new line still above `y`: the one `y` is in starts here at the earliest.
      line = below
      broken = false
      continue
    }
    const kept = trimmed(line)
    line = {
      text: kept.text + below.text,
      at: [...kept.at, ...below.at],
      wide: [...kept.wide, ...below.wide],
    }
    broken ||= hard
  }
  return { ...trimmed(line), broken }
}

/** Every address in the line row `y` is part of that reaches row `y`. */
export function linksOn(buffer: IBuffer, cols: number, y: number): Found[] {
  const line = lineAround(buffer, cols, y)
  if (!line) return []
  const found: Found[] = []
  for (const match of line.text.matchAll(URL)) {
    const text = match[0]
    if (!isAddress(text)) continue
    const from = match.index
    const to = from + text.length - 1
    const start = line.at[from]
    const last = line.at[to]
    if (!start || !last) continue
    const end = { x: last.x + (line.wide[to] ? 1 : 0), y: last.y }
    if (start.y <= y && end.y >= y) found.push({ text, start, end })
  }
  return found
}

function isAddress(text: string): boolean {
  try {
    const url = new globalThis.URL(text)
    return text.toLowerCase().startsWith(`${url.protocol}//`)
  } catch {
    return false
  }
}

/** A selection over more than one row that lies inside one address a program broke:
 *  that part of the address, without the breaks. Null for every other selection, whose
 *  text xterm.js gives as it is. `start` inclusive, `end` exclusive, 0-based. */
export function unbroken(buffer: IBuffer, cols: number, start: Cell, end: Cell): string | null {
  if (end.y <= start.y) return null
  const line = lineAround(buffer, cols, start.y)
  if (!line?.broken) return null
  const before = (a: Cell, b: Cell) => a.y < b.y || (a.y === b.y && a.x < b.x)
  const lastRow = line.at.at(-1)?.y ?? -1
  if (end.y > lastRow + 1 || (end.y === lastRow + 1 && end.x > 0)) return null
  const chosen = line.at
    .map((cell, i) => (!before(cell, start) && before(cell, end) ? line.text[i] : ''))
    .join('')
  const text = chosen.trim()
  if (!text || /\s/.test(text)) return null
  for (const match of line.text.matchAll(URL)) {
    if (isAddress(match[0]) && match[0].includes(text)) return text
  }
  return null
}

/** The provider xterm.js asks as the pointer moves: rows are 1-based there. */
export class AddressLinks implements ILinkProvider {
  constructor(
    private readonly term: Terminal,
    private readonly activate: (event: MouseEvent, uri: string) => void,
  ) {}

  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const found = linksOn(this.term.buffer.active, this.term.cols, y - 1)
    callback(
      found.length
        ? found.map(({ text, start, end }) => ({
            text,
            range: {
              start: { x: start.x + 1, y: start.y + 1 },
              end: { x: end.x + 1, y: end.y + 1 },
            },
            activate: this.activate,
          }))
        : undefined,
    )
  }
}

/** The selection's text, an address broken over rows given whole; see `unbroken`. */
export function chosenText(term: Terminal): string {
  const range = term.getSelectionPosition()
  const whole = range && unbroken(term.buffer.active, term.cols, range.start, range.end)
  return whole ?? term.getSelection()
}
