/** The colour the next launch opens on.
 *
 *  A window is on screen for about a fifth of a second before the app's own stylesheet
 *  has been read, and in that time the page shows the webview's default - white - unless
 *  the page itself says otherwise before anything is fetched. index.html says it, off
 *  the value written down here: the ground this window had when it was last looked at.
 *
 *  Remembered rather than computed, because it cannot be computed from the markup. A
 *  theme file may set any colour it likes, and translucency sets none at all - the
 *  ground is transparent so the platform's material shows through, and a launch that
 *  painted a colour there would flash a solid window over somebody's wallpaper. So the
 *  one honest source is what the window actually resolved to, and that is what this
 *  reads.
 *
 *  Cosmetic by construction, and never load-bearing: a machine that has never run the
 *  app, or one whose storage was cleared, opens on the palette index.html carries. See
 *  the inline script there, and test/ground.test.ts, which holds the two to each other.
 */

import { keep } from './stored'

/** Where it is kept. The same string is in index.html, which is read before any module
 *  of ours exists and so cannot import this; ground.test.ts holds the two together. */
const KEY = 'nib:ground'

/** Whether a read is already scheduled for the next frame. */
let asked = false

/** Writes down what the window is standing on, after the frame that changed it.
 *
 *  On the next frame rather than now, because every caller has just set an attribute on
 *  the root element and the computed value of a custom property is what it is after the
 *  style has been recalculated. Asked twice in one frame it reads once: the theme and
 *  the material can change together, and one of those changes is the ground. */
export function rememberGround(): void {
  if (asked || typeof requestAnimationFrame !== 'function') return
  asked = true

  requestAnimationFrame(() => {
    asked = false

    // The hint index.html painted, taken off the moment the real sheet is in place: it
    // is an inline style and would otherwise outrank every rule for the life of the
    // window, so a reader who changed the theme would keep the ground of the theme
    // before it. Taken off here rather than anywhere else because this is the first
    // code that runs with the app's own stylesheet applied - and because the value read
    // below has to be the sheet's, not the hint's.
    document.documentElement.style.removeProperty('background')

    const ground = getComputedStyle(document.documentElement)
      .getPropertyValue('--window-ground')
      .trim()

    if (ground) keep(KEY, ground)
  })
}
