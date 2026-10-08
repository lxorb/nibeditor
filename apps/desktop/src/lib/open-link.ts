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

import type { LinkPress, NoteJump } from '@nib/editor'
import { howFor, linkAsk, type TabAsk, tabAsk } from './new-tab'
import { isPlugin } from './plugin'
import { isOpenable, openExternal } from './tauri'
import { viewport } from './viewport.svelte'
import { isWebAddress } from './web-tab/address'
import { workspace } from './workspace.svelte'

/** Where a pressed link ends up: in front of the reader, in the strip without taking
 *  them there, out in the browser this app is not, or nowhere at all - which is what
 *  a note asking for a scheme nib hands nobody deserves. */
export type LinkPlace = 'here' | 'behind' | 'system' | 'nowhere'

/** The buttons a link answers, in the DOM's numbering. Said once, because the surfaces
 *  that read a press off the page rather than out of the editor ask the same thing. */
const MAIN = 0
export const MIDDLE = 1

/** Whether a press is one a link answers at all: the right button is the menu's. */
export function opensLink(press: LinkPress): boolean {
  return press.button === MAIN || press.button === MIDDLE
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
 *  A web note leaves everywhere but the desktop app; see docs/web-tabs.md. */
function holdsPages(): boolean {
  return !isPlugin() && viewport.device !== 'phone'
}

/** Where one press on one link goes: the whole of the decision, and pure, so which
 *  modifier means what has tests rather than five surfaces that might disagree.
 *
 *  * A scheme nib hands nobody goes nowhere, and anything that is not a page goes to
 *    the system whatever is held down. No modifier turns an email address into a page.
 *  * Otherwise it is the browser's rule every surface keeps, in new-tab.ts: the middle
 *    button and the modifier open it behind, the modifier with Shift and Shift alone
 *    in front. The way out to the system browser is the link's own right-click row;
 *    see `linkEntries` in editor-menu.ts.
 *  * A plain press opens it in front. A browser would use the tab the link was in;
 *    nib will not, because that tab is a note somebody is reading and replacing it
 *    loses their place. A tab in front is as near as that gets - the page is what they
 *    are looking at, and the note is one tab away. */
export function placeFor(href: string, ask: TabAsk, pages = holdsPages()): LinkPlace {
  if (!isOpenable(href)) return 'nowhere'
  if (webHref(href) === null || !pages) return 'system'

  return ask === 'behind' ? 'behind' : 'here'
}

/** A link the reader pressed, followed. What every surface hands its own event to. */
export function followHref(href: string, press: LinkPress): void {
  const ask = tabAsk(press, true)
  // A chat's message (docs/chats.md 4.13).
  if (/^nib:\/\/chat\//i.test(href)) {
    const opening = __EVEN_PLUGIN__ ? null : import('./chats/view/open')
    void opening?.then(({ openChatLink }) => openChatLink(href, howFor(ask)))
    return
  }
  const place = placeFor(href, ask)
  if (place === 'nowhere') return

  if (place === 'system') {
    void openExternal(href)
    return
  }

  const page = webHref(href)
  if (page !== null) workspace.openPage(page, ask)
}

/** A link to a note the reader pressed, followed: the same rule as a link to a page,
 *  in the same place, so the two kinds of link in one note never disagree - and Alt
 *  with the modifier for a pane to the right, which only a note has. Nothing pressed
 *  is a link followed from the keyboard. */
export function followNote(jump: NoteJump, press?: LinkPress): void {
  void workspace.followLink(jump, press ? linkAsk(press) : 'plain')
}

/** Nothing held down, for the places a link is opened by something that is not a click
 *  on the link itself: a card on a plane, a row somewhere. */
const PLAIN: LinkPress = { button: MAIN, ctrlKey: false, metaKey: false, shiftKey: false }

export function openHref(href: string): void {
  followHref(href, PLAIN)
}
