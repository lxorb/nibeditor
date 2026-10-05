import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/** A see-through terminal stands on the pane's ground (`--terminal-ground`), and the
 *  screen draws none of its own: its colours are clear (look.ts). But xterm.js's own
 *  stylesheet paints the viewport under the screen black, which nothing in the theme
 *  reaches, so under glass and the wallpaper the terminal was a black box where a note
 *  beside it showed the picture. Read out of the component rather than mounted: what
 *  is asked is only that the black is taken off. */

const SOURCE = readFileSync(fileURLToPath(new URL('./TerminalTab.svelte', import.meta.url)), 'utf8')
const XTERM = readFileSync(
  createRequire(import.meta.url).resolve('@xterm/xterm/css/xterm.css'),
  'utf8',
)

test("xterm.js's viewport is black, and the terminal takes the black off", () => {
  expect(XTERM).toMatch(/\.xterm \.xterm-viewport \{[^}]*background-color: #000/)
  expect(SOURCE).toMatch(/:global\(\.xterm-viewport\) \{\s*background-color: transparent;/)
})
