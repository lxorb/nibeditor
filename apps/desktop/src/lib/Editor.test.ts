import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The pane's half of one contract, whose other half is in another package.
 *
 *  `.surface` is the box the editor is sized against, and it has to hand down a
 *  height that is definite by construction rather than by resolution. It is a flex
 *  child told to take the room that is left and no more, AND a flex column, so the
 *  editor inside it takes `flex: 1; min-height: 0` off the line.
 *
 *  The column is the part that was missing, and it cost a week. `height: 100%` on
 *  the editor was doing the work alone, and a percentage height against a flex item
 *  whose own height comes from being stretched is the one case engines have never
 *  agreed on. Chromium resolved it, so every test and every drive passed; the
 *  WebView2 the Windows app embeds did not. There the editor grew to the note, the
 *  scroller grew to the editor, and there was nothing left to scroll - the foot of a
 *  long note sitting under the bottom of the window, clipped by the `overflow:
 *  hidden` below. Emil: *"note scrollbar, mouse scrolling does nothing, but when I
 *  move the cursor to the bottom it scrolls"*, and Reading mode was fine throughout,
 *  because Reading.svelte sizes its scroller off the flex line and asks no
 *  percentage of anybody.
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

  /** The rule an engine cannot decline. A percentage may or may not resolve; a
   *  flex line always has a length. */
  test('and hands that height down a flex line, not only as a percentage', () => {
    expect(SURFACE).toMatch(/display:\s*flex/)
    expect(SURFACE).toMatch(/flex-direction:\s*column/)
  })

  test('clips what overflows it, so nothing but the scroller scrolls', () => {
    expect(SURFACE).toMatch(/overflow:\s*hidden/)
  })
})
