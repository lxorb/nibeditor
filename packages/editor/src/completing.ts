/** The completion menus and the bracket pairs, as `@codemirror/autocomplete` builds
 *  them.
 *
 *  Its own module because of what that package weighs: thirty-five kilobytes of built
 *  JavaScript for a popup that opens on `/`, `:`, `[[` or `#`, and for the `)` that
 *  appears after a `(` - none of which a window has any use for until somebody types.
 *  So the whole of it is behind this one import, fetched as the first editor is built
 *  rather than before the window is on screen; see completion.ts, which is the door,
 *  and open-views.ts for how it reaches the editors already up.
 *
 *  What is in here is only the library's own side. The sources the popup asks - the
 *  blocks a `/` offers, the emoji table, the reader's snippets, the notes a `[[` can
 *  name, the tags a `#` opens - are modules of their own and cost nothing: each takes a
 *  `CompletionContext` and answers, and a type is erased. */

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { type Extension, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { emojiCompletions } from './emoji'
import { once } from './once'
import { slashCompletions } from './slash'
import { snippetCompletions } from './snippets'
import { tagCompletions } from './tags'
import { wikilinkCompletions } from './wikilink/complete'

/** The one popup, and the pairs when they are wanted.
 *
 *  The slash comes first because it is the only one whose opening character the others
 *  could also be sitting on: a `/` is not a word, and a source that has something to
 *  say about one has the first word.
 *
 *  `pairs` is the reader's own switch, which is a setting rather than a fact about the
 *  build - so it is asked of the door on every reconfigure and answered here. The
 *  library's Backspace, which deletes both halves of a pair at once, goes with it: a
 *  key that undoes a pair nothing is making is a key that should not be bound.
 *
 *  Built once per value, like every other mode, and for the reason once.ts gives: the
 *  app applies the modes to every editor whenever anything changes, and a compartment
 *  handed a freshly built popup would throw away the popup that is open. Which is what
 *  it did - the completions drive found a `[[` offering nothing, because the note swap
 *  behind it had reset the state field the popup lives in. */
/** The library's keys for the popup, without its Ctrl+Space: that is the space switcher
 *  (Emil, 2026-10-04), and the popup opens by itself on every character that starts
 *  one. Taken off here rather than given way to, because the library's key spends the
 *  press whether or not there is anything to offer, and the window's handler never
 *  sees a press already spent. The Mac's Alt+` and Alt+I stay. */
const popupKeys = completionKeymap.filter((binding) => binding.key !== 'Ctrl-Space')

export const completing = once((pairs: boolean): Extension => [
  autocompletion({
    override: [
      slashCompletions,
      emojiCompletions,
      snippetCompletions,
      wikilinkCompletions,
      tagCompletions,
    ],
    icons: false,
    defaultKeymap: false,
  }),
  Prec.highest(keymap.of(popupKeys)),
  ...(pairs ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []),
])
