/** Finding words in the note, and putting other words in their place.
 *
 *  The engine is the library's and stays the library's: `SearchQuery` is what
 *  knows about case, whole words and regular expressions, what steps from one
 *  match to the next and what a `$1` in a replacement means. None of that is
 *  worth writing twice.
 *
 *  What is not the library's any more is the bar. CodeMirror ships a panel -
 *  two bare inputs, three checkboxes labelled "match case", "regexp", "by word"
 *  in whatever language the library was written in, and a `x` for a close
 *  button - and it was the one surface in nib that was not nib's: no
 *  `.nib-field`, no row scale, no touch sizes, nothing translated, and a
 *  different shape again from the bar the reading view and a PDF already shared.
 *  So the panel is gone and the app draws the bar; see FindBar.svelte.
 *
 *  Which leaves this file as the seam between the two, and it has four jobs:
 *
 *  1. Ask the app to put the bar up. A command cannot reach a component, so the
 *     keys dispatch an effect and the app is told through `onFind`.
 *  2. Say whether the bar is up, which is what the marks follow.
 *  3. Say what the caret was on, so the bar opens on the word somebody was
 *     looking at.
 *  4. Be the door the engine comes through.
 *
 *  The fourth is why the first three are here rather than next door. The engine is
 *  fifteen kilobytes of built JavaScript that a window has no use for until somebody
 *  presses Control+F or selects a word, so it is fetched at the last turn of the launch
 *  order - see `warmDoors` in the app - and a key pressed before it lands has to put
 *  the bar up all the same. So every one of these is a property read or an effect, and
 *  nothing here names the library. What does is finding.ts. */

import {
  Compartment,
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type StateCommand,
} from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { enrolled, openViews } from './open-views'

/** What the bar is asking of the document. The four the library's query has,
 *  under the names the bar says them in. */
export interface FindSpec {
  query: string
  replace: string
  caseSensitive: boolean
  regexp: boolean
  wholeWord: boolean
}

export const NO_FIND: FindSpec = {
  query: '',
  replace: '',
  caseSensitive: false,
  regexp: false,
  wholeWord: false,
}

/** The bar being asked for, or asked to go. `replace` is whether the row with
 *  Replace and Replace all is wanted open: Ctrl+H asks for the whole of it and
 *  Ctrl+F asks for the top row. */
export interface FindAsk {
  replace: boolean
  /** What the caret was on when the key was pressed, so the bar opens on the
   *  word somebody was looking at. Empty when the selection was empty or too
   *  long to be a search term, which is the rule the library uses too. */
  seed: string
}

const findAsked = StateEffect.define<FindAsk | null>()

/** Whether the app's bar is up. What the marks follow: the matches are shown while
 *  somebody is looking for them and not a moment longer. Read by finding.ts, which
 *  draws them. */
export const findShown = StateField.define<boolean>({
  create: () => false,
  update(up, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(findAsked)) return effect.value !== null
    }
    return up
  },
})

/** The words the caret is on, as a search term. A selection spanning half the
 *  note is not a term anybody meant to look for; a hundred characters is where
 *  the library draws that line and there is no reason to draw it elsewhere.
 *
 *  Exported because it is the rule that decides what the bar opens on, and a
 *  rule is worth a test. */
export function termAt(state: EditorState): string {
  const { from, to, empty } = state.selection.main
  if (empty || to > from + 100) return ''

  // Trimmed, because a selection made with Ctrl+Shift+Right carries the space
  // in front of the word and nobody means to look for that. A term with a
  // newline in it cannot be typed into a one-line field either, and the library
  // escapes it for the same reason.
  return state.sliceDoc(from, to).trim().replace(/\n/g, '\\n')
}

/** How far the count will go. A note is a file somebody wrote, not a corpus,
 *  and a regular expression over a long one can match on nearly every
 *  character: the bar says "300+" rather than spending a frame being exact
 *  about a number nobody reads. */
export const MOST_COUNTED = 300

export interface FindTally {
  /** How many matches there are, or `MOST_COUNTED` when there are more. */
  count: number
  /** Which one the selection is on, counting from zero, or -1 for none. */
  current: number
  /** Whether the count stopped before the end of the note. */
  capped: boolean
}

export const NO_TALLY: FindTally = { count: 0, current: -1, capped: false }

const engine = new Compartment()

/** The engine, once it is here. */
let loaded: typeof import('./finding') | null = null
let loading: Promise<typeof import('./finding')> | null = null

/** Fetches the engine, and puts it into whatever is open when it arrives. Idempotent,
 *  and the promise is kept: a note of twenty words is one fetch.
 *
 *  Exported because two callers wait on it. The launch asks for it at its last turn, so
 *  that the marks under a selected word are there before any hand could have selected
 *  one; and `setFind` awaits it, so the first thing typed into the bar is looked for
 *  even if the bar went up in the first frame. */
export function loadFind(): Promise<typeof import('./finding')> {
  loading ??= import('./finding').then((module) => {
    loaded = module
    for (const view of openViews())
      view.dispatch({ effects: engine.reconfigure(module.searching()) })

    return module
  })

  return loading
}

/** Everything the editor carries in order to be searchable: the field that says the
 *  bar is up, the seam the app hears it through, and the compartment the engine lands
 *  in. */
export function findExtensions(onFind?: (ask: FindAsk | null) => void): Extension {
  return [
    findShown,
    engine.of(loaded ? loaded.searching() : []),
    enrolled,
    ...(onFind
      ? [
          EditorView.updateListener.of((update) => {
            for (const transaction of update.transactions) {
              for (const effect of transaction.effects) {
                if (effect.is(findAsked)) onFind(effect.value)
              }
            }
          }),
        ]
      : []),
  ]
}

/** Asks for the bar. Both keys land here; which row the keyboard goes to is the
 *  bar's business, and `replace` is what says which it should be.
 *
 *  One ask per press, whether or not the engine is here: this is an effect on the
 *  document, so a key held down asks again and the app answers the same way it did the
 *  first time. The fetch is started beside it, because somebody who has pressed
 *  Control+F is about to type. */
function asks(replace: boolean): Command {
  return (view) => {
    if (!loaded) void loadFind()
    view.dispatch({ effects: findAsked.of({ replace, seed: termAt(view.state) }) })

    return true
  }
}

export const openFind = asks(false)
export const openReplace = asks(true)

/** Says the bar has gone, which is what takes the marks off the matches. The
 *  caret going back where it was is the bar's own doing. */
export function closeFind(view: EditorView) {
  view.dispatch({ effects: findAsked.of(null) })
}

/** What the bar is looking for. Written as one effect on every keystroke, which
 *  is the whole of how the bar talks to the document.
 *
 *  Answers when the document has been told, which is a promise rather than nothing
 *  only on the first call of a session: the bar can go up in the frame before the
 *  engine lands, and a caller that read the tally straight afterwards would read a
 *  count of nothing. Awaited by the pane; see Pane.svelte. */
export async function setFind(view: EditorView, spec: FindSpec): Promise<void> {
  const found = loaded ?? (await loadFind())
  found.setQuery(view, spec)
}

/** Every match, and which of them the selection is on. Nothing before the engine is
 *  here, which is the honest answer: nothing can have been looked for yet. */
export function findTally(state: EditorState): FindTally {
  return loaded ? loaded.tally(state) : NO_TALLY
}

/** A step through the matches, or the bar if there is nothing to step through.
 *
 *  The guard is the point. The library pairs every one of these with "and open
 *  the search panel if the query is empty", which would put the panel nib just
 *  replaced back on the screen the first time somebody pressed F3.
 *
 *  With the engine still on its way there is certainly nothing to step through -
 *  nothing can have set a query without it - so the answer is the same as the empty
 *  one, and the fetch goes with it. */
function steps(move: (found: typeof import('./finding')) => Command): Command {
  return (view) => {
    const found = loaded
    if (!found?.asked(view.state)) return openFind(view)

    return move(found)(view)
  }
}

export const findNext = steps((found) => found.next)
export const findPrevious = steps((found) => found.previous)

/** The match the caret is on, replaced, and then the one after it. False where
 *  there is nothing to replace or the note cannot be written in. */
export function replaceHere(view: EditorView): boolean {
  if (!loaded?.asked(view.state)) return false

  return loaded.replaceOne(view)
}

export function replaceEverywhere(view: EditorView): boolean {
  if (!loaded?.asked(view.state)) return false

  return loaded.replaceEvery(view)
}

/** Every match selected at once, a cursor on each, to be written over together -
 *  VS Code's Alt+Enter in its find field. False where nothing is being looked for or
 *  nothing matched, which leaves the selection where it was. */
export function selectEveryMatch(view: EditorView): boolean {
  if (!loaded?.asked(view.state)) return false

  return loaded.selectEvery(view)
}

/** One of the library's own commands, run through the door.
 *
 *  The key is bound from the first frame and spends the press whether the engine is
 *  here or not: pressed before it, the command runs as soon as it lands, which is the
 *  next few milliseconds. A key that returned false would fall through to whatever is
 *  bound under it, which is how a chord comes to do two things. */
function lazily(pick: (found: typeof import('./finding')) => Command): Command {
  return (view) => {
    if (loaded) return pick(loaded)(view)
    void loadFind().then((found) => pick(found)(view))

    return true
  }
}

/** The same for a command that acts on a state rather than a view: what `selectWord`
 *  falls through to on its second press, and the row that selects every occurrence. */
function lazilyOnState(pick: (found: typeof import('./finding')) => StateCommand): StateCommand {
  return (target) => {
    if (loaded) return pick(loaded)(target)
    void loadFind().then((found) => pick(found)(target))

    return true
  }
}

/** The line somebody typed a number for. The library's own dialog, which is the one
 *  surface of its own nib still uses; see keymap.ts. */
export const gotoLine = lazily((found) => found.gotoLine)

/** The next occurrence of what is selected, and every occurrence of it. Both are the
 *  library's, named by nib and bound to nib's own keys. */
export const selectNextOccurrence = lazilyOnState((found) => found.selectNextOccurrence)
export const selectSelectionMatches = lazilyOnState((found) => found.selectSelectionMatches)
