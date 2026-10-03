/** What colour the page in a web tab stands on, asked of the page.
 *
 *  On a desktop the page is another webview and the crate reads it (web_tint.rs). In a
 *  browser the page is a frame, and a frame of the app's own origin is read the same way
 *  from here (`readFrame`); one of another origin cannot be read at all, and its tab
 *  wears its favicon's colour instead. Where the page's words do not say - a picture
 *  along its top, or three points that disagree - the still the window took as it landed
 *  is read instead, along its top rows. See colours.ts for the order. */

import { hexOf } from '../legibility'
import { invoke, isDesktop } from '../tauri'
import { pages } from '../web-tab/pages.svelte'
import { groundSaid, type PageSaid, stripGround } from './colours'
import { pixelsOf } from './pictures'

/** How long a page is given to answer: a line of script in its own document, so a page
 *  that takes longer is busy with something of its own and keeps what it had. */
const ANSWERS = 800

/** The rows of a page's still that are its top edge, at the size they are counted. */
const STRIP = { rows: 6, width: 48, height: 2 }

/** The colours a canvas writes, the one spelling the crate's reader uses too. */
function painter(doc: Document): (colour: string) => string {
  const paint = doc.createElement('canvas').getContext('2d')
  return (colour) => {
    if (!paint || !colour) return ''
    paint.fillStyle = '#000000'
    paint.fillStyle = colour
    const first = paint.fillStyle
    paint.fillStyle = '#ffffff'
    paint.fillStyle = colour
    return first === paint.fillStyle ? first : ''
  }
}

const PICTURES = /^(img|video|canvas|iframe|picture|svg|embed|object)$/i

/** What a page in a frame of the app's own origin says it stands on: the same reading
 *  web_tint.rs runs inside a page, in this window's hands. */
export function readFrame(win: Window): PageSaid {
  const doc = win.document
  const said = painter(doc)

  let theme = ''
  for (const one of doc.querySelectorAll('meta[name="theme-color" i]')) {
    const media = one.getAttribute('media')
    if (media && !win.matchMedia(media).matches) continue
    theme = said(one.getAttribute('content') ?? '')
    if (theme) break
  }

  const root = doc.documentElement
  const wide = root.clientWidth || win.innerWidth
  const scheme = win.getComputedStyle(root).colorScheme || ''
  const dark =
    scheme.includes('dark') &&
    (!scheme.includes('light') || win.matchMedia('(prefers-color-scheme: dark)').matches)

  const top: string[] = []
  let pictured = false
  for (const point of [0.08, 0.5, 0.92]) {
    let found = ''
    let here = false
    for (
      let one: Element | null = doc.elementFromPoint(Math.round(wide * point), 1);
      one;
      one = one.parentElement
    ) {
      const style = win.getComputedStyle(one)
      if (
        PICTURES.test(one.tagName) ||
        (style.backgroundImage && style.backgroundImage !== 'none')
      ) {
        here = true
        break
      }
      const ground = said(style.backgroundColor)
      if (ground.startsWith('#')) {
        found = ground
        break
      }
    }
    pictured ||= here
    top.push(found || (here ? '' : dark ? '#121212' : '#ffffff'))
  }

  return { theme, top, pictured }
}

/** What the page says, from the engine or the frame; null where it cannot be asked. */
async function asked(tab: string): Promise<PageSaid | null> {
  if (isDesktop) {
    return Promise.race([
      invoke<PageSaid>('web_tint', { tab }).catch(() => null),
      new Promise<null>((go) => setTimeout(() => go(null), ANSWERS)),
    ])
  }

  const frame = document.querySelector<HTMLIFrameElement>(
    `iframe[data-web-tab="${CSS.escape(tab)}"]`,
  )
  try {
    return frame?.contentWindow ? readFrame(frame.contentWindow) : null
  } catch {
    // Another origin's page, which this window may not look into.
    return null
  }
}

/** The colour along the top of the page's still, taken as it landed. */
async function fromStill(tab: string): Promise<string | null> {
  await pages.shoot(tab)
  const still = pages.of(tab).shot
  if (!still) return null

  const pixels = await pixelsOf(still, STRIP)
  const ground = pixels ? stripGround(pixels) : null
  return ground ? hexOf(ground) : null
}

/** The colour the page in a tab stands on, as `#rrggbb`, or null where it does not say
 *  and its still cannot either. */
export async function groundOf(tab: string): Promise<string | null> {
  const said = await asked(tab)
  if (!said) return null

  const ground = groundSaid(said)
  if (ground) return hexOf(ground)
  return isDesktop ? fromStill(tab) : null
}
