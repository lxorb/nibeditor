/** The steps a grown selection came out through, which is what Shrink goes back
 *  down.
 *
 *  Its own module because it is the one part of growing the selection every editor
 *  carries from its first frame: the steps have to be kept from the first press on,
 *  while the commands that take them arrive behind a door. See grow.ts and
 *  line-door.ts. */

import { type EditorSelection, StateEffect, StateField } from '@codemirror/state'

/** A grow, carrying the selection it started from. */
export const grew = StateEffect.define<EditorSelection>()

/** A shrink, which takes the last of those back off. */
export const shrank = StateEffect.define()

/** The selections each grow started from, the last one on top. Anything else that
 *  moves the selection or changes the note forgets them, which is what VS Code does
 *  as well. */
export const growing = StateField.define<readonly EditorSelection[]>({
  create: () => [],
  update(taken, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(grew)) return [...taken, effect.value]
      if (effect.is(shrank)) return taken.slice(0, -1)
    }
    return transaction.docChanged || transaction.selection ? [] : taken
  },
})
