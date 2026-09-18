/** Where a link in somebody's words goes when they press it.
 *
 *  nib holds pages now, so a link in a note has no business handing the reader to
 *  another browser: it opens here, and the browser's own modifiers decide whether nib
 *  comes with them. One module, because every surface that draws a reader's words has
 *  to answer the same press the same way - the note, its reading, the card that
 *  glances at another note, a slide, a card on a plane.
 *
 *  What is not the reader's words is deliberately not here. A link under Help, in the
 *  settings or in the MCP sheet is the app talking about itself, and a release note,
 *  an issue tracker and somebody's account page all want the browser they are already
 *  signed in to; those still call `openExternal` where they stand. */

import { type LinkPress, linkModifier } from '@nib/editor'
import { isPlugin } from './plugin'
import { isOpenable, openExternal } from './tauri'
import { viewport } from './viewport.svelte'
import { isWebAddress } from './web-tab/address'
import { workspace } from './workspace.svelte'

/** Where a pressed link ends up: in front of the reader, in the strip without taking
 *  them there, out in the browser this app is not, or nowhere at all - which is what
 *  a note asking for a scheme nib hands nobody deserves. */
export type LinkPlace = 'here' | 'behind' | 'system' | 'nowhere'

/** A press, read down to the three facts the rules turn on. The platform's own
 *  modifier - Cmd on a Mac, Ctrl everywhere else - is read off the event here, so no
 *  rule below has to know which machine it is on. */
export interface LinkAsk {
  middle: boolean
  modifier: boolean
  shift: boolean
}

/** The buttons a link answers, in the DOM's numbering. Said once, because the surfaces
 *  that read a press off the page rather than out of the editor ask the same thing. */
const MAIN = 0
export const MIDDLE = 1

/** Whether a press is one a link answers at all: the right button is the menu's. */
export function opensLink(press: LinkPress): boolean {
  return press.button === MAIN || press.button === MIDDLE
}

export function askOf(press: LinkPress): LinkAsk {
  return { middle: press.button === MIDDLE, modifier: linkModifier(press), shift: press.shiftKey }
}

/** The page a link means, or null when it is not one a tab may hold: a `mailto:` and a
 *  `tel:` address something that is not a browser, every other scheme is one a tab
 *  would have to stop being a browser to show, and the app's own origins would put nib
 *  inside a tab with a site's script beside it. The rule the address field is held to,
 *  asked of one link; the crate says it again in Rust because the links inside a page
 *  are judged by it too. See web-tab/address.ts and `allowed` in web_tabs.rs. */
export function webHref(href: string): string | null {
  // A protocol-relative address is http's, which is what a browser makes of it.
  const said = href.startsWith('//') ? `https:${href}` : href
  return isWebAddress(said) ? said : null
}

/** Whether this build has anywhere to put a page. A phone hands the address to the
 *  system browser instead, which is the answer rather than a gap - that browser has
 *  their logins, their extensions and their ad blocking, and Tauri has no child
 *  webviews there anyway - and in front of a pair of glasses there is no page at all.
 *  The same two answers `openWeb` gives; see docs/web-tabs.md. */
function holdsPages(): boolean {
  return !isPlugin() && viewport.device !== 'phone'
}

/** Where one press on one link goes: the whole of the decision, and pure, so which
 *  modifier means what has tests rather than five surfaces that might disagree.
 *
 *  * A scheme nib hands nobody goes nowhere, and anything that is not a page goes to
 *    the system whatever is held down. No modifier turns an email address into a page.
 *  * The middle button opens it behind, which is what it has meant since tabs existed
 *    and the one gesture on a link that means the same thing on every surface.
 *  * The modifier opens it behind and the modifier with Shift opens it in front,
 *    exactly as Ctrl+click and Ctrl+Shift+click do in Chrome, Firefox and Safari.
 *  * Shift alone is a browser's new window, and nib is one window; the nearest honest
 *    thing to a window that is not this one is the browser that is not this app. That
 *    makes it the deliberate way out, which a press that opens a page here needs.
 *  * A plain press opens it in front. A browser would use the tab the link was in;
 *    nib will not, because that tab is a note somebody is reading and replacing it
 *    loses their place. A tab in front is as near as that gets - the page is what they
 *    are looking at, and the note is one tab away. */
export function placeFor(href: string, ask: LinkAsk, pages = holdsPages()): LinkPlace {
  if (!isOpenable(href)) return 'nowhere'
  if (webHref(href) === null || !pages) return 'system'

  if (ask.middle) return 'behind'
  if (ask.modifier) return ask.shift ? 'here' : 'behind'
  return ask.shift ? 'system' : 'here'
}

/** A link the reader pressed, followed. What every surface hands its own event to. */
export function followHref(href: string, press: LinkPress): void {
  const place = placeFor(href, askOf(press))
  if (place === 'nowhere') return

  if (place === 'system') {
    void openExternal(href)
    return
  }

  const page = webHref(href)
  if (page !== null) workspace.openPage(page, place === 'behind')
}

/** Nothing held down, for the places a link is opened by something that is not a click
 *  on the link itself: a card on a plane, a row somewhere. */
const PLAIN: LinkPress = { button: MAIN, ctrlKey: false, metaKey: false, shiftKey: false }

export function openHref(href: string): void {
  followHref(href, PLAIN)
}
