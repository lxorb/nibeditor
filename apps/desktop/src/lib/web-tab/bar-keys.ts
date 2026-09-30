/** What a key means to a web tab's bar: Chrome's keys, while a page is in front.
 *
 *  Read off the window by the bar in the focused pane, before the app's own handler, so
 *  the few keys a browser and nib both spend - F5 is Present over a note, Ctrl and a
 *  digit is a heading level in one, Ctrl and a sign the size of a note's words - mean
 *  the browser's while a page is what the pane shows. A pane showing a page has no note
 *  to present, no heading to make and no words of nib's to size, so nothing is taken
 *  from anybody. The keys are the registry's, so a reader's own bindings are the ones
 *  read; see `web.*` and `app.zoom-*` in shortcuts/registry.ts.
 *
 *  Escape is not here. It stops a page only once whatever is open over it has had its
 *  Escape, so the bar reads it after everything else; see `stops`. */

import { matchesCombination, type Platform } from '../keys'
import { fromPage } from './keys'

/** What the keys are bound to now: the shortcuts store, or a test's own. */
export interface Bindings {
  readonly platform: Platform
  pressed(id: string, event: KeyboardEvent): boolean
}

export type BarKey =
  | { to: 'address' }
  | { to: 'step'; step: 'reload' | 'fresh' }
  /** A tab along the pane's strip, from nought; the ninth is the last. */
  | { to: 'tab'; index: number }
  /** A rung of the page's zoom, or back to a hundred per cent. */
  | { to: 'zoom'; step: ZoomStep }

export type ZoomStep = 'in' | 'out' | 'reset'

export function barKey(event: KeyboardEvent, keys: Bindings): BarKey | null {
  // One of an entry's keys, its second key included.
  const either = (id: string) => keys.pressed(id, event) || keys.pressed(`${id}.alt`, event)

  // F6 from inside the page is Chrome's way out of it to the address field. In the app
  // it walks the regions, which is nib's and stays so.
  const f6 = event.key === 'F6' && !event.ctrlKey && !event.shiftKey && !event.altKey
  if (either('web.address') || (f6 && fromPage(event))) return { to: 'address' }

  if (either('web.reload')) return { to: 'step', step: 'reload' }
  if (either('web.fresh')) return { to: 'step', step: 'fresh' }

  // The keys that size a note's words size the page, as they do in Chrome; and Chrome's
  // Ctrl and `+` with them, which is Shift and `=` on some keyboards, a key of its own
  // on others, and on the number pad.
  if (keys.pressed('app.zoom-in', event) || plus(event, keys.platform)) {
    return { to: 'zoom', step: 'in' }
  }
  if (keys.pressed('app.zoom-out', event)) return { to: 'zoom', step: 'out' }
  if (keys.pressed('app.zoom-reset', event)) return { to: 'zoom', step: 'reset' }

  for (let index = 0; index < 9; index++) {
    if (matchesCombination(`Mod-${index + 1}`, event, keys.platform)) {
      return { to: 'tab', index }
    }
  }

  return null
}

/** Ctrl and `+` (Cmd on a Mac), with Shift or without: whichever the keyboard needs. */
function plus(event: KeyboardEvent, platform: Platform): boolean {
  const mod = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return mod && !event.altKey && event.key === '+'
}

/** Whether a press is the one that stops a page on its way. */
export function stops(event: KeyboardEvent, loading: boolean, keys: Bindings): boolean {
  return loading && !event.defaultPrevented && keys.pressed('web.stop', event)
}
