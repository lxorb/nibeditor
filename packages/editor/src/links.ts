import { Facet } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { label } from './labels'

/** What a press on a link asked for: which button, and which of the keys that
 *  change what a click means were down.
 *
 *  A `MouseEvent` already is one, so a handler hands its own event over unchanged
 *  and nothing has to be copied out of it. Named so that the host answering the
 *  press can be tested without a DOM. What each combination *means* is the host's
 *  to decide, not the editor's: only something with tabs of its own knows where a
 *  page could go. */
export interface LinkPress extends Modified {
  /** In the DOM's numbering: 0 the main button, 1 the middle one. */
  button: number
  shiftKey: boolean
}

/** Opens a link the reader asked for, and says how they asked. The host supplies
 *  one that puts the page where the host keeps pages; on its own the editor asks
 *  the browser for a tab, which is the only answer a bare editor has. */
export const linkOpener = Facet.define<
  (href: string, press: LinkPress) => void,
  (href: string, press: LinkPress) => void
>({
  combine: (values) => values[0] ?? ((href) => void window.open(href, '_blank', 'noopener')),
})

/** What a link's target is to a browser, or null when it is not one: a
 *  relative path or a `#heading` belongs to the note, not to the web. A bare
 *  `www.` address is how people write a web address without its scheme. */
export function hrefOf(target: string): string | null {
  const trimmed = target.trim()
  if (/^(https?|mailto):/i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`
  return null
}

/** Read from the user agent string rather than `navigator.platform`, which is
 *  deprecated, and from the string rather than `userAgentData`, which only
 *  Chromium has. All this decides is whether the modifier is Cmd or Ctrl. */
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** The tooltip on a link: where it goes, and how to get there without moving
 *  the caret. */
export function linkTitle(href: string): string {
  return `${href}\n${label(MAC ? 'openLinkMac' : 'openLink')}`
}

/** What answering that question needs, which is the two keys it reads. A
 *  `MouseEvent` and a `KeyboardEvent` are both one, and so is the press a host is
 *  handed - which is what lets the host ask without holding an event. */
export interface Modified {
  ctrlKey: boolean
  metaKey: boolean
}

/** Whether the key that turns a click into a jump is down. Exported because
 *  links between notes are followed the same way; see wikilink/follow.ts, and
 *  because the app decides where a followed link goes; see open-link.ts. */
export function modifier(event: Modified): boolean {
  return MAC ? event.metaKey : event.ctrlKey
}

/** Whether the modifier is being held right now.
 *
 *  A value of its own rather than something read back off the `nib-modifier`
 *  class below, because that class does not survive: CodeMirror writes the
 *  content element's `class` attribute out from its own facets on every update,
 *  and takes any class added by hand with it. */
export function modifierHeld(): boolean {
  return held
}

let held = false

/** Watches the modifier, and marks the writing surface while it is down so the
 *  pointer can turn into a hand over a link.
 *
 *  On the window rather than on the editor, because which key is held is a fact
 *  about the keyboard: the editor loses focus for all sorts of reasons - a
 *  click in the sidebar, a panel opening, a re-render - and a reader holding the
 *  key has not stopped holding it because of any of them. Watched from a plugin
 *  rather than at import time, so the listeners live exactly as long as a view
 *  does. */
export const modifierWatch = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {
      window.addEventListener('keydown', this.watch, true)
      window.addEventListener('keyup', this.watch, true)
      window.addEventListener('blur', this.drop)
    }

    private readonly watch = (event: KeyboardEvent) => {
      held = modifier(event)
      this.mark()
    }

    private readonly drop = () => {
      held = false
      this.mark()
    }

    /** Put back after every update, which is when CodeMirror rewrites the
     *  attribute this lives in. A no-op when it is already right. */
    update() {
      this.mark()
    }

    private mark() {
      this.view.contentDOM.classList.toggle('nib-modifier', held)
    }

    destroy() {
      window.removeEventListener('keydown', this.watch, true)
      window.removeEventListener('keyup', this.watch, true)
      window.removeEventListener('blur', this.drop)
    }
  },
)

/** The mouse buttons this reads, in the DOM's numbering. */
const MAIN = 0
const MIDDLE = 1

/** A click on a link places the caret, as anywhere else in the text; with the
 *  modifier held it follows the link instead, Typora's way. What the pointer
 *  looks like while the key is down is `modifierWatch` above.
 *
 *  Reading mode has no caret to place, so there the plain click is not
 *  ambiguous and follows the link, the way it would on a page.
 *
 *  The middle button follows it either way, because the middle button places no
 *  caret and so is ambiguous nowhere: it is the one gesture on a link that means
 *  the same thing while writing as it does while reading, which is what it means
 *  in every browser. */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const asked =
      event.button === MIDDLE || (event.button === MAIN && (modifier(event) || view.state.readOnly))
    if (!asked) return false

    // An event's target is only an element some of the time - a click can land
    // on a text node - so it is asked rather than assumed.
    const target = event.target
    const link = target instanceof Element ? target.closest('.nib-link') : null
    const href = link?.getAttribute('data-href')
    if (!href) return false

    // Also what stops the platform's own answer to the middle button: X11 pastes
    // the primary selection at the pointer, so without this the press that opened
    // a page would have written a line into the note it was pressed in.
    event.preventDefault()
    view.state.facet(linkOpener)(href, event)
    return true
  },
})
