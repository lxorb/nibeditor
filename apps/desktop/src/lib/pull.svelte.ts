/** Pulling down past the top of the note or the list, which is a phone's one
 *  spare gesture.
 *
 *  A phone has no keyboard to hang a shortcut off and no room for a row of
 *  buttons at the top of the screen, and there is exactly one movement a thumb
 *  can make that means nothing else: pulling a surface that is already at its top
 *  further down. Obsidian spends it on the command palette. Orden spends it on
 *  whichever command the reader says, and offers search to begin with - what a
 *  thumb reaches for on a phone is a note, and search is how a note is found.
 *
 *  The command is a registry id, like the buttons on the bar, and it runs through
 *  the same `runEntry`: the pull, the button and the key all press one command.
 *
 *  **Never the browser's own pull.** In a PWA a pull at the top of a scrolling
 *  document is pull-to-refresh, which would throw the page away and rebuild it -
 *  the one thing a note editor must never do by accident. Three things stop it,
 *  and all three were already true of this app: the window is pinned, so the
 *  document itself never scrolls; `html` says `overscroll-behavior: none` in
 *  base.css and the file list says `contain` on its own scroller; and the move
 *  handler here is not passive and prevents the default as soon as the gesture
 *  is this one.
 *
 *  The maths is here and pure; the wiring is `follow`. See pull.test.ts. */

import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { runnable } from './shortcuts/registry'
import { forget, isString, keep, stored } from './stored'

const STORAGE_KEY = 'nib:pull'

/** What a fresh phone does: search this space. */
export const DEFAULT_PULL = 'app.search'

/** No gesture at all, which is a choice like any other: somebody who pulls a
 *  list about without meaning anything by it can have the pull do nothing. Not a
 *  command id, and nothing in the registry will ever be called this - an id there
 *  is `part.part`. */
export const NOTHING = 'none'

/** How far the finger must travel before the gesture is this one rather than a
 *  scroll that went nowhere. The same number the drawer claims at, because it is
 *  the same question about the same thumb; see swipe.ts. */
export const CLAIM = 12

/** How far the surface has to come for a lift to run the command. About a
 *  thumb's own length of travel: far enough that nobody arrives here by
 *  overscrolling a list, short enough to do with one hand. */
export const REACH = 84

/** How far past `REACH` the mark will go, so a long pull says "yes, that far"
 *  rather than sticking. */
const MOST = REACH * 1.4

/** Whether a movement is a pull rather than a scroll or a swipe: down, and more
 *  down than sideways. The sideways one is the drawer's. */
export function claimsPull(dx: number, dy: number): boolean {
  return dy >= CLAIM && dy > Math.abs(dx) * 1.6
}

/** How far the surface follows the finger. Not one for one: the pull is rubber,
 *  so the first half of the travel is nearly free and the rest gets heavier,
 *  which is what tells a thumb that something is being reached rather than
 *  dragged. */
export function pulled(dy: number): number {
  if (dy <= 0) return 0

  const eased = MOST * (1 - 1 / (1 + dy / MOST))
  return Math.min(MOST, Math.round(eased * 1.6))
}

/** Whether a lift now would run the command. */
export function armed(distance: number): boolean {
  return distance >= REACH
}

class Pull {
  /** How far the surface is pulled while a finger is down, in pixels. Zero when
   *  nothing is being pulled, which is also what the mark reads. */
  at = $state(0)

  /** Whether letting go now would run the command. */
  get ready(): boolean {
    return armed(this.at)
  }

  /** Which command the pull runs, or null while it is the one offered. Null
   *  rather than a copy of the default, for the reason the bar's list is: a
   *  default that changes later reaches everybody who never chose. */
  chosen = $state<string | null>(null)

  get id(): string {
    return this.chosen ?? DEFAULT_PULL
  }

  get changed(): boolean {
    return this.chosen !== null
  }

  restore() {
    this.chosen = usable(stored(STORAGE_KEY))
  }

  /** Chooses one, or `NOTHING`. Choosing the one that is offered anyway is
   *  choosing nothing, so it is stored as nothing: that is what keeps a default
   *  that changes later reaching this device. */
  choose(id: string) {
    this.chosen = id === DEFAULT_PULL ? null : usable(id)
    // Through `keep`, the one place that writes: a browser told to keep no site
    // data still has the gesture, and it is this run's choice rather than this
    // device's. See stored.ts.
    if (this.chosen) keep(STORAGE_KEY, this.chosen)
    else forget(STORAGE_KEY)

    this.share()
  }

  receive(remote: AccountSettings) {
    const theirs = remote.pull
    if (theirs === undefined) {
      if (this.chosen) this.share()
      return
    }

    const theirOwn = usable(theirs)
    if (theirOwn === this.chosen) return

    this.chosen = theirOwn
    if (theirOwn) keep(STORAGE_KEY, theirOwn)
    else forget(STORAGE_KEY)
  }

  private share() {
    const token = account.accountToken
    if (!token) return

    void api.saveSettings(token, { pull: this.chosen }).catch(() => undefined)
  }

  /** What a pull runs, set once by the app.
   *
   *  A registry command needs what only the running app has - the editor in
   *  front, the palette, the window - and the surfaces this is attached to have
   *  none of it. So the app leaves the runner here, the way it leaves the
   *  selection watcher on `views`; see App.svelte. */
  runs: (() => void) | null = null

  /** Follows a finger on one surface, and answers the teardown.
   *
   *  `scroller` is what has to be at its top for the gesture to start: the
   *  editor's own scroller, or the file list's. Attached by hand rather than with
   *  `ontouchmove`, because claiming the gesture means preventing the default and
   *  that needs a listener that is not passive. */
  follow(scroller: HTMLElement): () => void {
    let startX = 0
    let startY = 0
    let candidate = false
    let claimed = false

    const clear = () => {
      candidate = false
      claimed = false
      this.at = 0
    }

    const onStart = (event: TouchEvent) => {
      clear()
      // Nothing chosen, nothing to reach for: no mark, and the scroll is the
      // surface's own.
      if (this.id === NOTHING) return
      if (event.touches.length !== 1) return

      const touch = event.touches[0]
      if (!touch) return

      // Only from the top. A list scrolled halfway down is being read, and the
      // gesture there is a scroll.
      if (scroller.scrollTop > 0) return

      startX = touch.clientX
      startY = touch.clientY
      candidate = true
    }

    const onMove = (event: TouchEvent) => {
      if (!candidate) return

      const touch = event.touches[0]
      if (!touch) return

      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (!claimed) {
        // Anything that is not this gesture ends it, so a scroll or a sideways
        // drag is not fought over for the rest of the movement.
        if (dy < -2 || Math.abs(dx) > Math.abs(dy)) {
          candidate = false
          return
        }
        if (!claimsPull(dx, dy)) return

        claimed = true
      }

      // Ours now: the surface must not scroll and the browser must not refresh.
      event.preventDefault()
      this.at = pulled(dy)
    }

    const onEnd = () => {
      const go = claimed && this.ready
      clear()
      if (go) this.runs?.()
    }

    scroller.addEventListener('touchstart', onStart, { passive: true })
    scroller.addEventListener('touchmove', onMove, { passive: false })
    scroller.addEventListener('touchend', onEnd)
    scroller.addEventListener('touchcancel', clear)

    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd)
      scroller.removeEventListener('touchcancel', clear)
      clear()
    }
  }
}

/** A stored or received choice, cleaned: a command this version can press, the
 *  word for no gesture, or nothing - which means the one offered. */
export function usable(value: unknown): string | null {
  if (!isString(value)) return null
  if (value === NOTHING) return NOTHING

  return runnable(value) ? value : null
}

export const pull = new Pull()

/** The gesture, as a `use:` on the surface it belongs to - the house shape for
 *  something that listens on one element; see roving.ts and scrollbar.ts.
 *
 *  Attached whatever the device is, because a touch event is the only thing that
 *  starts it: a machine with no touchscreen never sends one, and one that has
 *  both gets the gesture where its screen is a screen to touch. */
export function pullable(node: HTMLElement) {
  return { destroy: pull.follow(node) }
}
