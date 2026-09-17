import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The pane's half of one contract, whose other half is in another package.
 *
 *  The editor is `height: 100%` (nibTheme, in packages/editor/src/theme.ts), and a
 *  percentage height is only a height when the box above it has one. `.surface` is
 *  that box: a flex child told to take the room that is left and no more. Take the
 *  zero minimum away and it grows with the note instead - a flex item's automatic
 *  minimum is its content's - and then the editor is as tall as the note, the
 *  scroller is as tall as the editor, and there is nothing left to scroll. The foot
 *  of a long note simply sits under the bottom of the window, clipped by the
 *  `overflow: hidden` below.
 *
 *  Read out of the component rather than measured, because a Svelte component's
 *  scoped CSS is in the bundle and not in anything a server render hands back. What
 *  is measured is measured in a window, by the drives; see
 *  apps/desktop/test/e2e/smoke.py. */

const SURFACE = /\.surface \{([^}]*)\}/.exec(
  readFileSync(fileURLToPath(new URL('./Editor.svelte', import.meta.url)), 'utf8'),
)?.[1]

describe('the pane the editor is in', () => {
  test('gives it a height to be a hundred percent of', () => {
    expect(SURFACE).toBeDefined()
    expect(SURFACE).toMatch(/flex:\s*1/)
    expect(SURFACE).toMatch(/min-height:\s*0/)
  })

  test('clips what overflows it, so nothing but the scroller scrolls', () => {
    expect(SURFACE).toMatch(/overflow:\s*hidden/)
  })
})
