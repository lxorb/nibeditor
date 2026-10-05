/** A late joiner's screen against a terminal that saw everything (4.6): the screen
 *  serialised at a point in the stream, drawn into a fresh terminal, then the rest of
 *  the stream after it, compared cell by cell with a terminal fed the whole stream - at
 *  every point a screen could be taken, with colours mid-stream and a full-screen
 *  program on the second screen. */

import { expect, test } from 'vitest'
import { cells, terminal, written } from '../test/cells'
import { Scanner } from './scan'
import { Screen } from './screen'

const COLS = 60
const ROWS = 12

/** What a shell and a full-screen editor print: scrolled lines in many colours, wide
 *  characters, a title, then the second screen with its modes, a status line in
 *  reverse and the cursor left mid-screen. */
function stream(): Uint8Array {
  const parts: string[] = ['\x1b]0;build\x07']
  for (let i = 0; i < 40; i++) {
    parts.push(`\x1b[1;3${String(i % 8)}m${String(i)}\x1b[0m line \x1b[38;5;${String(i * 5)}m256\x1b[0m `)
    parts.push(`\x1b[38;2;${String(i)};100;200mtrue\x1b[48;2;10;20;${String(i)}mcolour\x1b[0m 漢字 ✓\r\n`)
  }
  parts.push('a long line that wraps past the edge of the screen and on '.repeat(2), '\r\n')
  parts.push('\x1b[4munder\x1b[24m \x1b[3mitalic\x1b[23m \x1b[9mstruck\x1b[29m $ vim\r\n')
  parts.push('\x1b[?1049h\x1b[?1h\x1b=\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[H\x1b[2J')
  for (let row = 1; row < ROWS; row++) {
    parts.push(`\x1b[${String(row)};1H\x1b[34m~\x1b[0m`)
  }
  parts.push('\x1b[1;1Hfn main() {\r\n    \x1b[33mprintln!\x1b[0m("hi");\r\n}')
  parts.push(`\x1b[${String(ROWS)};1H\x1b[7m main.rs [+] \x1b[27m`)
  parts.push('\x1b[2;5H')
  return new TextEncoder().encode(parts.join(''))
}

test('a joiner at any point between two sequences draws what a watcher saw', async () => {
  const all = stream()
  const watcher = terminal(COLS, ROWS)
  await written(watcher, all)
  const expected = cells(watcher)

  const scanner = new Scanner()
  const cuts = new Set<number>()
  for (let at = 0; at < all.length; at += 13) {
    scanner.feed(all.subarray(at, at + 13))
    cuts.add(scanner.safe)
  }

  for (const cut of cuts) {
    const screen = new Screen(COLS, ROWS)
    screen.write(all.subarray(0, cut))
    const serialized = await screen.serialized()
    screen.dispose()

    const joiner = terminal(COLS, ROWS)
    await written(joiner, serialized)
    await written(joiner, all.subarray(cut))
    expect(cells(joiner), `cut at ${String(cut)}`).toEqual(expected)
    joiner.dispose()
  }
  watcher.dispose()
})

test('the screen is the one in front: the editor, with its modes', async () => {
  const screen = new Screen(COLS, ROWS)
  screen.write(stream())
  const joiner = terminal(COLS, ROWS)
  await written(joiner, await screen.serialized())
  expect(joiner.buffer.active.type).toBe('alternate')
  expect(joiner.modes.applicationCursorKeysMode).toBe(true)
  expect(joiner.modes.bracketedPasteMode).toBe(true)
  expect(joiner.modes.mouseTrackingMode).toBe('vt200')
  expect(screen.title).toBe('build')
})

test('a saved screen is the shell\'s alone, with no modes left switched on', async () => {
  const screen = new Screen(COLS, ROWS)
  screen.write(stream())
  const back = terminal(COLS, ROWS)
  await written(back, await screen.saved())
  expect(back.buffer.active.type).toBe('normal')
  expect(back.modes.bracketedPasteMode).toBe(false)
  expect(back.modes.mouseTrackingMode).toBe('none')
})
