/** A terminal's whole state as plain data, to compare two terminals cell by cell: every
 *  line of both screens with each cell's character, width, colours and attributes, the
 *  cursor, which screen is in front, and the modes a program can switch on. */

import headless from '@xterm/headless'

const { Terminal } = headless
type Term = InstanceType<typeof Terminal>
type Buffer = Term['buffer']['active']

export function terminal(cols: number, rows: number): Term {
  return new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true })
}

/** Everything written so far, parsed. */
export function written(term: Term, data: string | Uint8Array = ''): Promise<void> {
  return new Promise((resolve) => {
    term.write(data, resolve)
  })
}

/** The 256-colour palette's first sixteen are the sixteen colours by another name, which
 *  the serialise addon writes in the shorter form: the same colour on any screen. */
const P16 = 0x1000000
const P256 = 0x2000000

function colour(mode: number, value: number): [number, number] {
  return mode === P256 && value < 16 ? [P16, value] : [mode, value]
}

function lines(buffer: Buffer): string[] {
  const out: string[] = []
  const cell = buffer.getNullCell()
  let used = 0
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y)
    if (!line) continue
    const cells: string[] = []
    let blank = !line.isWrapped
    for (let x = 0; x < line.length; x++) {
      line.getCell(x, cell)
      const look = [
        ...colour(cell.getFgColorMode(), cell.getFgColor()),
        ...colour(cell.getBgColorMode(), cell.getBgColor()),
        cell.isBold(),
        cell.isItalic(),
        cell.isDim(),
        cell.isUnderline(),
        cell.isInverse(),
        cell.isInvisible(),
        cell.isStrikethrough(),
      ]
      if (cell.getChars() || look.some(Boolean)) blank = false
      cells.push([cell.getChars() || ' ', cell.getWidth(), ...look].join('|'))
    }
    out.push(`${line.isWrapped ? '~' : ''}${cells.join(' ')}`)
    if (!blank) used = out.length
  }
  // Blank lines past the last written one are how far the screen scrolled, not what is
  // on it.
  return out.slice(0, used)
}

export function cells(term: Term): unknown {
  const { active, normal, alternate } = term.buffer
  return {
    cols: term.cols,
    rows: term.rows,
    front: active.type,
    cursor: [active.cursorX, active.cursorY, active.baseY],
    normal: lines(normal),
    alternate: active.type === 'alternate' ? lines(alternate) : null,
    modes: { ...term.modes },
  }
}

/** The text on the visible screen, for a test that looks for a word. */
export function text(term: Term): string {
  const buffer = term.buffer.active
  const out: string[] = []
  for (let y = 0; y < buffer.length; y++) out.push(buffer.getLine(y)?.translateToString(true) ?? '')
  return out.join('\n')
}
