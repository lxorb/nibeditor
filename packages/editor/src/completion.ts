/** The door the completion menus and the bracket pairs come through.
 *
 *  `@codemirror/autocomplete` is thirty-five kilobytes of built JavaScript, and every
 *  one of them is for something that happens after a keystroke: the popup on `/`, `:`,
 *  `[[` or `#`, and the `)` that appears after a `(`. None of it is needed to put a note
 *  on screen, which is what the first paint is about - so what every editor carries is
 *  this, a compartment that starts empty, and the library arrives in it.
 *
 *  Fetched as the first editor is built rather than at the first keystroke, and that is
 *  the point: the fetch is a few milliseconds from beside the page, a reader cannot type
 *  before they have seen the note, and a keystroke that arrived while the library was
 *  still coming would be a bracket that quietly did not close. A window with no editor
 *  in it - a canvas, a plane of pages, the graph - fetches none of it.
 *
 *  The same shape modal editing has, for the same reasons and through the same
 *  registry; see vim.ts and open-views.ts. */

import { Compartment, type StateEffect } from '@codemirror/state'
import { door } from '@nib/markdown/door'
import { enrolled, openViews } from './open-views'

const completions = new Compartment()

/** The library, once it is here. */
let loaded: typeof import('./completing') | null = null

/** Whether brackets close themselves. One answer for the whole app rather than one per
 *  view, because that is what the setting is; read again when the library lands, so a
 *  reader who turned it off before then still has it off. */
let pairs = true

/** Fetches the library, and puts it into whatever is open when it arrives. Idempotent.
 *
 *  Exported for the tests, which type into an editor and read the popup in the same
 *  breath: in the app the editor has been on screen for a frame by the time anybody's
 *  hands are on the keyboard. */
export const loadCompletion: () => Promise<void> = door(async () => {
  loaded = await import('./completing')
  for (const view of openViews()) view.dispatch({ effects: completionEffect(pairs) })
})

/** What every editor carries: the compartment, and its place on the list of views the
 *  fetch above has to reach.
 *
 *  Building an editor is what starts the fetch. A window with a note in it is a window
 *  somebody is about to type in, and this is the earliest moment that is true - one
 *  frame after the note is on screen rather than before it. An editor built after the
 *  library has landed gets it outright, so only the first of a session is ever empty. */
export function completionExtensions() {
  if (!loaded) void loadCompletion()

  return [completions.of(loaded ? loaded.completing(pairs) : []), enrolled]
}

/** The menus and the pairs as an effect, so a pane taking another note on can put them
 *  in the same transaction as everything else it changes.
 *
 *  Asked with the library still on its way, it reconfigures to nothing and starts the
 *  fetch; `loadCompletion` fills every open view when it lands. */
export function completionEffect(closeBrackets: boolean): StateEffect<unknown> {
  pairs = closeBrackets
  if (!loaded) void loadCompletion()

  return completions.reconfigure(loaded ? loaded.completing(closeBrackets) : [])
}
