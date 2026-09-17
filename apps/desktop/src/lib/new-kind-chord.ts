/** The new-tab chooser, held open under the modifier its own chord is pressed with.
 *
 *  Emil, 2026-09-17: *"When we press Ctrl + T, release T and hold Ctrl, there should
 *  be a modal open where there are the different options. The last chosen one should
 *  be selected already. While holding Ctrl, we can switch to the next one by pressing
 *  T. When we let go of Ctrl, then the current one is chosen."*
 *
 *  Which is Alt+Tab, and what it applies to is already here: one list of kinds and one
 *  chooser that shows it - the menu the plus hangs, or the buttons a pane with nothing
 *  open draws. Nothing new is drawn here and there is no second chooser; this is the
 *  state a hand is in between pressing the chord and letting go. See new-kinds.ts and
 *  chooseNewKind in focus.ts.
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
 *  not be guessed: the overlay stack closes the chooser and knows nothing about the
 *  hand still on Ctrl, so without it the release that followed would have made a tab
 *  out of a chooser somebody had just dismissed. See overlays.ts.
 *
 *  **A tap is not a hold.** Down and up inside the beat draws nothing and makes the
 *  kind that stands, which is the tab a browser makes; drawing the chooser for those
 *  eighty milliseconds would be a box that blinks.
 *
 *  And **the selection is the keyboard** once anything is drawn: this moves the ring
 *  and reads it back, so the arrows walking the menu and the pointer moving over it
 *  arrive here knowing nothing about the chord, and the row that is lit is the row a
 *  release chooses. A press that came before the drawing is the exception, kept as
 *  steps owed rather than as a place - a place would need the list, and the list waits
 *  behind a door, because App.svelte reads this module and so the window reads it
 *  before anything is on screen. See the budget in test/weight.test.ts. */

import { chooseNewKind } from './focus'
import { holdKey, matchesCombination, parseCombination, withShift } from './keys'
import { standingAt, stepAt } from './last-kind'
import { shortcuts } from './shortcuts.svelte'
import { workspace } from './workspace.svelte'

/** The command this is the held form of. */
const ID = 'app.new-kind'

/** How long the modifier stays down before the chooser is drawn: about twice a
 *  keystroke and a fraction of a deliberate hold. */
const BEAT = 200

interface Held {
  /** The pane the tab is for: whichever had the keyboard when the chord began, so a
   *  hand that moves on while the chooser is up still gets its tab where it asked. */
  paneId: string
  /** The key whose release chooses, as `KeyboardEvent.key` names it. */
  hold: string
  /** Whether the kinds are on screen yet. */
  shown: boolean
  /** Steps asked for while there was nothing drawn to take them, signed. */
  owed: number
  beat: ReturnType<typeof setTimeout> | undefined
}

let held: Held | null = null

/** A keystroke, answered. True when the chord took it, which is the window's signal
 *  that the press is spent and the registry should not run the command as well.
 *
 *  Called from App.svelte rather than bound in the registry, because a command is
 *  handed the app's context and not the keystroke, and every rule above is about the
 *  keystroke. The command is still in the registry for the palette and the menus,
 *  where it opens the same chooser on the same row with no modifier to wait for. */
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
 *  tab: a chooser that is up is a layer over the app and its own keys win, which every
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
  // Nothing to let go of, so the chooser opens the way the palette opens it. `refuse`
  // in shortcuts.svelte.ts forbids a bare key; a map from another version is not this
  // one's to trust.
  if (!hold) {
    chooseNewKind()
    return
  }

  held = {
    paneId: workspace.panes.focusedId,
    hold,
    shown: false,
    owed: 0,
    beat: setTimeout(show, BEAT),
  }

  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onUp, true)
  window.addEventListener('pointerover', onOver, true)
  // A click has either chosen a row itself or dismissed the chooser, and the release
  // that follows must not make a second tab out of either.
  window.addEventListener('click', onClick, true)
  // Alt+Tab away and the release never arrives, so the window losing the keyboard is
  // the end of the gesture rather than a chord left running under the next one.
  window.addEventListener('blur', stop)
}

/** The kinds, on screen. Nothing new: whatever every other way in already draws, on
 *  the row it already lands on. */
function show(): void {
  if (!held || held.shown) return

  clearTimeout(held.beat)
  held.beat = undefined
  held.shown = true

  chooseNewKind()
}

function step(by: number): void {
  if (!held) return

  held.owed += by
  // A second press is somebody looking rather than tapping, so the chooser comes up
  // now rather than waiting out the beat.
  show()
  settle()
}

/** Pays the steps owed, once there is something to stand on. A pane with nothing open
 *  has its buttons already; a menu is fetched and drawn, so this keeps at it for a few
 *  frames rather than landing on nothing - the shape `settle` in focus.ts has, and for
 *  the same reason. */
function settle(left = 8): void {
  if (!held?.shown || !held.owed) return

  const list = rows()
  if (!list.length) {
    if (left > 0) requestAnimationFrame(() => settle(left - 1))
    return
  }

  list[stepAt(from(list), list.length, held.owed)]?.focus()
  held.owed = 0
}

/** Where the keyboard is among the kinds, as a place in them: the row it is actually
 *  on, and failing that the row the chooser marked as the one it lands on - which is
 *  the kind that was chosen last, and is where the keyboard is a moment from being.
 *  See `lands` in trap.ts. */
function from(list: HTMLElement[]): number {
  const at = list.findIndex((row) => row === document.activeElement)
  if (at >= 0) return at

  const lands = list.findIndex((row) => row.dataset.lands !== undefined)
  return lands < 0 ? 0 : lands
}

/** The kinds as elements, wherever they are being offered: the buttons a pane with
 *  nothing open draws, or the rows of the menu the chooser hung. */
function rows(): HTMLElement[] {
  if (!held) return []

  // Found by reading the attribute rather than by asking for it in a selector: a
  // pane's id is the app's to make and a selector would have to escape it.
  const here = [...document.querySelectorAll<HTMLElement>('[data-new-here]')].find(
    (one) => one.dataset.newHere === held?.paneId,
  )
  if (here) return [...here.querySelectorAll<HTMLElement>('button')]

  return [...document.querySelectorAll<HTMLElement>('.menu [role="menuitem"]')]
}

/** The pointer moves the keyboard while this is held, so the row lit under it is the
 *  row a release chooses. A menu otherwise lights hover and leaves the ring where the
 *  keys put it, which is right for a menu nobody is holding a modifier over and wrong
 *  for one that chooses on release: two rows would be lit and the quieter would win.
 *  Only while this is held, so no other menu changes. */
function onOver(event: PointerEvent): void {
  if (!held?.shown) return

  const target = event.target
  const row =
    target instanceof Element ? target.closest<HTMLElement>('[role="menuitem"], button') : null
  if (row && rows().includes(row)) row.focus()
}

function onKey(event: KeyboardEvent): void {
  // Escape cancels and makes nothing. The press is not spent here - the overlay stack
  // still has its menu to close, and this only lets go of the hand.
  if (event.key === 'Escape') stop()
}

/** A hand on the pointer, and only a hand: a click the app made itself is not somebody
 *  choosing.
 *
 *  Which sounds like a nicety and is the whole of this. The chooser opens by pressing
 *  the pane's own plus, with a click this app dispatches so the menu arrives at the
 *  button's corner - see `press` in focus.ts - and that click reaches the window like
 *  any other. Without `isTrusted` the chord let go of itself in the same breath as it
 *  drew the chooser: the menu came up, no further T stepped it, and the release made
 *  nothing at all. */
function onClick(event: MouseEvent): void {
  if (event.isTrusted) stop()
}

function onUp(event: KeyboardEvent): void {
  if (event.key === held?.hold) finish()
}

/** The release: the kind that stands is made.
 *
 *  By pressing it, where it is on screen, so the one road every other hand takes is
 *  the road this takes too - the row hides the chooser and opens its kind in the pane
 *  whose plus was pressed, and nothing of that is written twice. Where nothing is
 *  drawn, which is the tap, the list itself is asked - fetched here rather than
 *  imported, for the reason at the top of this file. */
function finish(): void {
  const one = held
  if (!one) return

  // What is owed is paid here as well as in `settle`, so a release that lands between
  // the chooser being drawn and the frame that would have moved the ring still chooses
  // the kind that was asked for rather than the one it opened on.
  const list = rows()
  const at = list.length ? stepAt(from(list), list.length, one.owed) : null
  stop()

  if (at !== null) {
    list[at]?.click()
    return
  }

  void import('./new-kinds').then(({ newKinds }) => {
    const kinds = newKinds()
    const stands = standingAt(kinds.map((kind) => kind.kind))
    // No pane named: with nothing drawn there was no plus to press either, so the tab
    // goes to whichever pane has the keyboard, which is the one that asked.
    kinds[stepAt(stands, kinds.length, one.owed)]?.make()
  })
}

/** Lets go of the hand and makes nothing. */
function stop(): void {
  if (!held) return

  clearTimeout(held.beat)
  held = null

  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('keyup', onUp, true)
  window.removeEventListener('pointerover', onOver, true)
  window.removeEventListener('click', onClick, true)
  window.removeEventListener('blur', stop)
}
