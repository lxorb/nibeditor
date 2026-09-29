/** A layer over the note holds the keyboard while it is open, and hands it back
 *  to whatever opened it.
 *
 *  Two halves of one rule, and both of them are what a dialog is for. While a
 *  sheet, a menu or the settings are open, Tab goes round the inside of it rather
 *  than off into the note behind - which is still on the page, still full of
 *  buttons, and still answering keys nobody can see landing. And when it closes,
 *  the keyboard goes back to the control that opened it, so asking a question and
 *  getting an answer leaves a hand exactly where it was.
 *
 *  The one thing this does not do is close anything: Escape is overlays.ts, which
 *  closes the layer on top, and every layer in the app is already on that stack. */

/** Everything Tab would stop on inside the layer. `[tabindex="-1"]` is excluded
 *  from all of it and not only from the last clause: the rows of a list are
 *  buttons that have been taken out of the tab sequence on purpose, and counting
 *  them here is how Tab walked off the end of the palette into the note behind
 *  it. */
const FOCUSABLE = [
  'button',
  '[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
  '[contenteditable="true"]',
]
  .map((one) => `${one}:not(:disabled):not([tabindex="-1"])`)
  .join(', ')

function within(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (one) => one.getClientRects().length > 0 && one.getAttribute('aria-hidden') !== 'true',
  )
}

/** Where the layer says the keyboard should land, when it is not simply the first
 *  thing in it: the address field of the Share sheet is what somebody opened the
 *  sheet to type in, and the cross in its head is not.
 *
 *  Never a field under a thumb. There is no Tab there to hold on to, and a field
 *  taking the keyboard the moment a sheet rises puts the system's own keyboard
 *  over half of what was opened. And a menu under a thumb keeps the keyboard
 *  itself rather than handing it to its first row, as a menu's box is there to
 *  (`.nib-host`, which wears no ring): WebKit ringed that row, and a menu a finger
 *  had just opened showed its first row as the one already chosen. */
function lands(node: HTMLElement): HTMLElement | null {
  if (document.documentElement.hasAttribute('data-touch')) {
    return node.matches('.nib-host[tabindex]') ? node : null
  }

  return node.querySelector<HTMLElement>('[data-lands]:not(:disabled)')
}

/** `holds` false leaves the keyboard where it is; see field-menu.ts. */
export function trap(node: HTMLElement, holds = true) {
  if (!holds) return { destroy: () => undefined }

  /** What had the keyboard before this opened. Read now, because by the time this
   *  closes the answer is whatever is inside it. */
  const from = document.activeElement

  // Already holding it - a field the layer focused itself, the palette's box -
  // and then taking it again would put the caret back at the start of what
  // somebody has begun typing.
  if (!node.contains(document.activeElement)) {
    const first = lands(node) ?? within(node)[0]
    if (first) first.focus()
    else {
      // Nothing in it to stand on, so the layer itself takes the keyboard: it is
      // still the thing Escape closes, and a press has to land somewhere inside.
      if (!node.hasAttribute('tabindex')) node.tabIndex = -1
      node.focus()
    }
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Tab') return

    const stops = within(node)
    if (!stops.length) {
      event.preventDefault()
      return
    }

    const first = stops[0]
    const last = stops.at(-1)
    if (!first || !last) return

    const at = document.activeElement
    // The ends meet, which is the whole of a trap: from the last one Tab comes
    // round to the first, and Shift+Tab from the first goes to the last.
    if (!node.contains(at)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
      return
    }

    if (event.shiftKey && at === first) {
      event.preventDefault()
      last.focus()
      return
    }

    if (!event.shiftKey && at === last) {
      event.preventDefault()
      first.focus()
    }
  }

  node.addEventListener('keydown', onKey)

  /** Whether the keyboard is still this layer's to hand back. It is while it is
   *  inside the layer, and while it is nowhere in particular - the page itself,
   *  which is where it falls when the thing that held it has already gone.
   *
   *  It is not once something outside has taken it on purpose, and that is the
   *  whole of this: a menu entry can open a field, and the entry that opened it
   *  is still fading out when this runs. Handing the keyboard back then takes it
   *  off the field - and a name field that loses the keyboard commits what is in
   *  it, which for a row being made is nothing, so the row goes and the gesture
   *  made no file at all. See select-all.ts, which is the other half. */
  function ours(): boolean {
    const at = document.activeElement
    if (at === null || at === document.body || at === document.documentElement) return true

    return node.contains(at)
  }

  return {
    destroy() {
      node.removeEventListener('keydown', onKey)
      if (!ours()) return

      // Back where it came from, unless what it came from has gone with it: a
      // row deleted by the very sheet that asked about deleting it.
      if (from instanceof HTMLElement && from.isConnected && from.getClientRects().length > 0) {
        from.focus()
      }
    },
  }
}
