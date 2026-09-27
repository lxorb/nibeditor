/** The search engine, as `@codemirror/search` provides it.
 *
 *  Its own module because of what that package weighs: fifteen kilobytes of built
 *  JavaScript for the query, the cursor that walks it, what a `$1` in a replacement
 *  means, and the highlighter that marks other occurrences of the selection - none of
 *  which a window has any use for until somebody presses Control+F or selects a word.
 *  So the whole of it is behind this one import, fetched at the last turn of the launch
 *  order rather than before the window is on screen; see find.ts, which is the door,
 *  and open-views.ts for how it reaches the editors already up.
 *
 *  Nothing here is the bar. The bar is the app's - a row of the pane, in nib's own
 *  fields, translated - and the seam between the two is find.ts: the effect that asks
 *  for it, the field that says it is up, and the term the caret was on. Those are what
 *  every editor carries, because a key pressed before this module lands has to put the
 *  bar up all the same. */

import {
  findNext as libraryNext,
  findPrevious as libraryPrevious,
  getSearchQuery,
  gotoLine as libraryGotoLine,
  highlightSelectionMatches,
  replaceAll as libraryReplaceAll,
  replaceNext as libraryReplaceNext,
  search,
  SearchQuery,
  selectNextOccurrence as librarySelectNext,
  selectSelectionMatches as librarySelectMatches,
  setSearchQuery,
} from '@codemirror/search'
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  type StateCommand,
} from '@codemirror/state'
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { type FindSpec, type FindTally, findShown, MOST_COUNTED, NO_TALLY } from './find'
import { onThePage } from './live-preview/hidden-front-matter'

/** Every match, up to the cap, and which of them the selection is sitting on.
 *
 *  One pass, because the two answers come from the same walk. A zero-width
 *  match - `a*` over a line of b's - would otherwise be walked forever, so the
 *  cursor's own end is what stops it and a match that does not advance is
 *  counted once and left. */
export function tally(state: EditorState): FindTally {
  const query = getSearchQuery(state)
  if (!query.valid) return NO_TALLY

  const { from, to } = state.selection.main
  const cursor = query.getCursor(state)
  let count = 0
  let current = -1

  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    if (step.value.from === from && step.value.to === to) current = count
    count += 1
    if (count >= MOST_COUNTED) return { count, current, capped: true }
  }

  return { count, current, capped: false }
}

/** The marks under the matches: the library's own two class names, so the
 *  colours in the editor's theme are the ones that were already there.
 *
 *  Only the visible stretch is walked, the way the library's own does, and only
 *  while the bar is up. */
const findMarks = Decoration.mark({ class: 'cm-searchMatch' })
const findHere = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' })

function marksIn(view: EditorView): DecorationSet {
  if (!view.state.field(findShown, false)) return Decoration.none

  const query = getSearchQuery(view.state)
  if (!query.valid) return Decoration.none

  const built = new RangeSetBuilder<Decoration>()
  for (const range of view.visibleRanges) {
    const cursor = query.getCursor(view.state, range.from, range.to)
    let seen = 0
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      const { from, to } = step.value
      if (to > from) {
        const here = view.state.selection.ranges.some((one) => one.from === from && one.to === to)
        built.add(from, to, here ? findHere : findMarks)
      }
      if (++seen >= MOST_COUNTED) break
    }
  }

  return built.finish()
}

const findHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = marksIn(view)
    }

    update(update: ViewUpdate) {
      const was = update.startState.field(findShown, false)
      const now = update.state.field(findShown, false)
      const query = getSearchQuery(update.state)
      const before = getSearchQuery(update.startState)

      if (
        was !== now ||
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        query.search !== before.search ||
        query.caseSensitive !== before.caseSensitive ||
        query.regexp !== before.regexp ||
        query.wholeWord !== before.wholeWord
      ) {
        this.decorations = marksIn(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** Everything the editor needs to be searchable, once this module is here.
 *
 *  `search()` is what holds the query as a field. The highlighter draws the marks,
 *  because the library's own draws nothing unless the library's own panel is open and
 *  that panel is gone. `highlightSelectionMatches` is the other occurrences of whatever
 *  is selected, which is the one thing in here that happens without anybody asking -
 *  and the reason this module is fetched at the launch's last turn rather than at the
 *  first Control+F. */
export function searching(): Extension {
  return [search(), findHighlighter, highlightSelectionMatches()]
}

/** Only what is on the page: a match in metadata the reader asked to hide would be a
 *  place the bar takes them to and cannot show them, and a replacement made there one
 *  they never saw. One function rather than one per query, because the library tells
 *  two queries apart by it. */
function onPage(_match: string, state: EditorState, from: number): boolean {
  return onThePage(state, from)
}

/** What the bar is looking for, as the library's own query. */
export function queryFor(spec: FindSpec): SearchQuery {
  return new SearchQuery({
    search: spec.query,
    replace: spec.replace,
    caseSensitive: spec.caseSensitive,
    regexp: spec.regexp,
    wholeWord: spec.wholeWord,
    test: onPage,
  })
}

export function setQuery(view: EditorView, spec: FindSpec) {
  view.dispatch({ effects: setSearchQuery.of(queryFor(spec)) })
}

/** Whether there is anything to step through or replace. */
export function asked(state: EditorState): boolean {
  return getSearchQuery(state).valid
}

export const next: Command = libraryNext
export const previous: Command = libraryPrevious
export const replaceOne: Command = libraryReplaceNext
export const replaceEvery: Command = libraryReplaceAll
export const gotoLine: Command = libraryGotoLine
export const selectNextOccurrence: StateCommand = librarySelectNext
export const selectSelectionMatches: StateCommand = librarySelectMatches
