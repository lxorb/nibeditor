/** Whether the raw HTML in the document on screen is markup or is words.
 *
 *  The rule is not the editor's and is not here: who may reach a space and what
 *  has arrived in a document is the app's answer, said once in
 *  `apps/desktop/src/lib/trust.ts` so that the reading view, a canvas card and the
 *  live preview cannot come to different answers about the same note. What is here
 *  is the answer itself, carried into the state the way the space's links are: an
 *  effect over a field rather than a compartment, because a document turns
 *  untrusted while it is open - somebody pastes a page into it, somebody else joins
 *  the room - and reconfiguring an editor throws away its parse and every
 *  decoration on screen for a fact that changed nothing about either.
 *
 *  False until the app says otherwise. An editor standing on its own knows nothing
 *  about where its words came from, and the safe reading of nothing is that they
 *  came from somewhere else. */

import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state'

const setTrusted = StateEffect.define<boolean>()

const trustedField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setTrusted)) return effect.value
    }
    return value
  },
})

/** Whether this document's raw HTML may run. Read by the live preview, which draws
 *  the card a block of the note's own HTML becomes; see live-preview/decorate.ts. */
export function trustsMarkup(state: EditorState): boolean {
  return state.field(trustedField)
}

export function trustedMarkup(trusted: boolean | undefined): Extension {
  return trustedField.init(() => trusted ?? false)
}

/** The answer as an effect, so a pane taking another note on can put it in the same
 *  transaction as everything else it changes. */
export function trustedMarkupEffect(trusted: boolean): StateEffect<unknown> {
  return setTrusted.of(trusted)
}

/** Whether the answer changed across an update, which is what says the cards in the
 *  document have to be drawn again. */
export function trustChanged(before: EditorState, after: EditorState): boolean {
  return before.field(trustedField) !== after.field(trustedField)
}
