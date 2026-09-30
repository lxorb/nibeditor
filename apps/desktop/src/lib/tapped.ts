/** Who hears a modifier tapped twice, and the window's ears for one.
 *
 *  One detector for the window, on the capturing turn so that no list or field which
 *  stops a key on its way can hide it: a Shift, an arrow the palette spent, then a
 *  Shift is not two taps. A web page's taps arrive from its own script instead (see
 *  web-tab/passed.svelte.ts) and are handed to the same hearers.
 *
 *  The hearers are a stack, newest first, like the overlays: the app's shortcuts at
 *  the bottom, and the Shortcuts pane on top of them while it is waiting for a key, so
 *  a double Shift pressed there is the key being chosen rather than the palette
 *  opening over the pane. See double-tap.ts for what counts as a tap.
 *
 *  Fetched at the launch's last turn, with the palette it opens, and not carried in
 *  front of the first paint; see App.svelte. */

import { DoubleTap, type Modifier, tapOf } from './double-tap'
import { shortcuts } from './shortcuts.svelte'
import { present } from './slides/present.svelte'
import { type AppContext, SHORTCUTS } from './shortcuts/registry'
import { fromPage } from './web-tab/keys'

type Hearer = (key: Modifier) => void

const hearers: Hearer[] = []

/** Puts `hearer` on top until the answer is called. */
export function hearTaps(hearer: Hearer): () => void {
  hearers.push(hearer)
  return () => {
    const at = hearers.lastIndexOf(hearer)
    if (at >= 0) hearers.splice(at, 1)
  }
}

/** Hands a double tap to whoever is listening now. */
export function heard(key: Modifier): void {
  hearers.at(-1)?.(key)
}

/** Listens on the window. Answers the teardown. */
export function listenForTaps(target: Window = window): () => void {
  const taps = new DoubleTap()
  const now = () => performance.now()

  // Not a key a web page had, which the crate tells the window about as well: the page
  // counts its own taps and says so itself.
  const down = (event: KeyboardEvent) => {
    if (!fromPage(event)) taps.pressed(event, now())
  }
  const up = (event: KeyboardEvent) => {
    if (fromPage(event)) return
    const key = taps.released(event, now())
    if (key) heard(key)
  }
  const broken = () => taps.broken()
  // The window's own blur, which is somebody switching away, and not a field's: the
  // capturing turn hears every element's blur on its way down.
  const left = (event: Event) => {
    if (event.target === target) taps.broken()
  }

  const options = { capture: true, passive: true }
  target.addEventListener('keydown', down, options)
  target.addEventListener('keyup', up, options)
  target.addEventListener('pointerdown', broken, options)
  target.addEventListener('wheel', broken, options)
  target.addEventListener('blur', left, options)

  return () => {
    target.removeEventListener('keydown', down, options)
    target.removeEventListener('keyup', up, options)
    target.removeEventListener('pointerdown', broken, options)
    target.removeEventListener('wheel', broken, options)
    target.removeEventListener('blur', left, options)
  }
}

/** Runs the app-level entry whose key is a double tap of `key`: what `handle` in
 *  shortcuts.svelte.ts is for a chord. True when there was one. */
export function runTap(key: Modifier, context: AppContext): boolean {
  for (const entry of SHORTCUTS) {
    const held = shortcuts.keyFor(entry.id)
    if (entry.scope !== 'app' || !entry.run || !held) continue
    if (tapOf(held, shortcuts.platform) !== key) continue

    entry.run(context)
    return true
  }

  return false
}

/** The app's own ears: the window's taps, heard at the bottom of the stack and run
 *  against the registry - but not under a deck, which takes no key but the one that
 *  stops it. Answers the teardown. */
export function hear(context: () => AppContext, target: Window = window): () => void {
  const unlisten = listenForTaps(target)
  const unhear = hearTaps((key) => {
    if (!present.on) runTap(key, context())
  })

  return () => {
    unlisten()
    unhear()
  }
}
