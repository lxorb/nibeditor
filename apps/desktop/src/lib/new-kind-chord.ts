/** The new-tab dialog, held open under the modifier its own chord is pressed with.
 *
 *  Emil, 2026-09-17: *"When we press Ctrl + T, release T and hold Ctrl, there should
 *  be a modal open where there are the different options. [...] While holding Ctrl, we
 *  can switch to the next one by pressing T. When we let go of Ctrl, then the current
 *  one is chosen."* And 2026-09-27: *"Ctrl + T should always open a webpage by
 *  default. And that should always be the selected option in the modal when holding
 *  the Ctrl."*
 *
 *  Which is Alt+Tab, and what it applies to is the dialog: one list of kinds, drawn as
 *  cards in the middle of the window, standing on the website. Nothing is drawn here;
 *  this is the state a hand is in between pressing the chord and letting go. See
 *  new-kind-sheet.svelte.ts and NewKindSheet.svelte.
 *
 *  Four things to get right, and three are about keys.
 *
 *  **A key held down repeats**, and those keystrokes are the same press arriving
 *  again: stepping on them would spin the selection under a hand that never moved.
 *  `event.repeat` is the only honest way to tell - a fast second press and a repeat
 *  are the same thing by timing alone.
 *
 *  **The release is the choice**, so it is read on the window in the capture phase,
 *  where nothing can swallow it. Escape is read there too, and for a reason that would
 *  not be guessed: the overlay stack closes the dialog and knows nothing about the
 *  hand still on Ctrl, so without it the release that followed would have made a tab
 *  out of a dialog somebody had just dismissed. See overlays.ts.
 *
 *  **A tap is not a hold.** Down and up inside the beat draws nothing and makes a web
 *  page, which is the tab a browser makes; drawing the dialog for those eighty
 *  milliseconds would be a box that blinks.
 *
 *  And **the selection is the dialog's**: a number in its store, which T moves from
 *  here and the arrows, the letters and the pointer move from there, so the card that
 *  is lit is the card a release makes whichever hand moved it. This module and that
 *  store are fetched at the launch's last turn rather than carried, because App.svelte
 *  reads the door to them before anything is on screen. See the budget in
 *  test/weight.test.ts. */

import { holdKey, matchesCombination, parseCombination, withShift } from './keys'
import { makeFirst, newKindSheet } from './new-kind-sheet.svelte'
import { shortcuts } from './shortcuts.svelte'
import { workspace } from './workspace.svelte'

/** The command this is the held form of. */
const ID = 'app.new-kind'

/** How long the modifier stays down before the dialog is drawn: about twice a
 *  keystroke and a fraction of a deliberate hold. */
const BEAT = 200

interface Held {
  /** The pane the tab is for: whichever had the keyboard when the chord began, so a
   *  hand that moves on while the dialog is up still gets its tab where it asked. */
  paneId: string
  /** The key whose release chooses, as `KeyboardEvent.key` names it. */
  hold: string
  /** Whether the dialog is on screen yet. */
  shown: boolean
  beat: ReturnType<typeof setTimeout> | undefined
}

let held: Held | null = null

/** A keystroke, answered. True when the chord took it, which is the window's signal
 *  that the press is spent and the registry should not run the command as well.
 *
 *  Called from App.svelte rather than bound in the registry, because a command is
 *  handed the app's context and not the keystroke, and every rule above is about the
 *  keystroke. The command is still in the registry for the palette and the menus,
 *  where it opens the same dialog on the same card with no modifier to wait for. */
export function newKindChord(event: KeyboardEvent): boolean {
  // A press a surface has already answered is spent - the same rule `handle` in
  // shortcuts.svelte.ts follows one line further down.
  if (event.defaultPrevented || !isStep(event)) return false

  event.preventDefault()
  if (event.repeat) return true

  if (held) step(event.shiftKey ? -1 : 1)
  else start()

  return true
}

/** Whether the keystroke is the chord's own key. Exactly the combination while nothing
 *  is open; with Shift as well once it is, which is how a switcher under a held
 *  modifier steps back. Only once it is open, because Ctrl+Shift+T is Reopen closed
 *  tab: a dialog that is up is a layer over the app and its own keys win, which every
 *  layer here does, but one that is not may not help itself to somebody else's key. */
function isStep(event: KeyboardEvent): boolean {
  if (shortcuts.pressed(ID, event)) return true
  if (!held) return false

  const key = shortcuts.keyFor(ID)
  return !!key && matchesCombination(withShift(key), event, shortcuts.platform)
}

function start(): void {
  const key = shortcuts.keyFor(ID)
  const combination = key ? parseCombination(key, shortcuts.platform) : null
  const hold = combination ? holdKey(combination) : null
  // Nothing to let go of, so the dialog opens the way the palette opens it. `refuse`
  // in shortcuts.svelte.ts forbids a bare key; a map from another version is not this
  // one's to trust.
  if (!hold) {
    newKindSheet.show()
    return
  }

  held = {
    paneId: workspace.panes.focusedId,
    hold,
    shown: newKindSheet.open,
    beat: undefined,
  }

  // Already up - the palette opened it, or a press that came before this module had
  // landed - so the hand has found a dialog rather than started one, and this press is
  // the next step in it, the way a second T is.
  if (held.shown) newKindSheet.step(1)
  else held.beat = setTimeout(show, BEAT)

  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onUp, true)
  // A click has either chosen a card itself or dismissed the dialog, and the release
  // that follows must not make a second tab out of either.
  window.addEventListener('click', onClick, true)
  // Alt+Tab away and the release never arrives, so the window losing the keyboard is
  // the end of the gesture rather than a chord left running under the next one.
  window.addEventListener('blur', stop)
}

/** The dialog, on screen, on the website. */
function show(): void {
  if (!held || held.shown) return

  clearTimeout(held.beat)
  held.beat = undefined
  held.shown = true

  newKindSheet.show(held.paneId)
}

function step(by: number): void {
  // A second press is somebody looking rather than tapping, so the dialog comes up
  // now rather than waiting out the beat, and then steps.
  show()
  newKindSheet.step(by)
}

function onKey(event: KeyboardEvent): void {
  // Escape cancels and makes nothing. The press is not spent here - the overlay stack
  // still has the dialog to close, and this only lets go of the hand.
  if (event.key === 'Escape') stop()
}

/** A hand on the pointer, and only a hand: a click the app made itself is not somebody
 *  choosing. */
function onClick(event: MouseEvent): void {
  if (event.isTrusted) stop()
}

function onUp(event: KeyboardEvent): void {
  if (event.key === held?.hold) finish()
}

/** The release: the card that stands is made, or with nothing drawn - the tap - a web
 *  page. A dialog something else closed while the hand was still down - a letter, the
 *  back gesture - has already been answered, and the release makes nothing more. */
function finish(): void {
  const one = held
  if (!one) return

  stop()

  if (!one.shown) makeFirst(one.paneId)
  else newKindSheet.pick()
}

/** Lets go of the hand and makes nothing. */
function stop(): void {
  if (!held) return

  clearTimeout(held.beat)
  held = null

  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('keyup', onUp, true)
  window.removeEventListener('click', onClick, true)
  window.removeEventListener('blur', stop)
}
