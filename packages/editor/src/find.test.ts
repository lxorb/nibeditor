import { getSearchQuery, SearchQuery, setSearchQuery } from '@codemirror/search'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { findExtensions, findTally, loadFind, NO_FIND, selectEveryMatch, termAt } from './find'

/** The two answers the find bar needs that CodeMirror does not give it.
 *
 *  The library has no count at all - its own panel never showed one - and no
 *  rule about what a bar should open on beyond "whatever is selected". Both are
 *  here, both are pure, and both are what a bar saying "3 of 12" over the word
 *  the caret was on is made of.
 *
 *  The bar itself and the marks under the matches need a view, which this
 *  package has no DOM for; those are driven in
 *  apps/desktop/test/e2e/find-bar.py. */

// The engine is fetched rather than carried, so the field `setSearchQuery` writes into
// arrives when it lands. In the app that is the launch's last turn, long before a hand
// is on the keyboard; here it is awaited once. What the keys do in front of it is
// find-keys.test.ts.
beforeAll(async () => {
  await loadFind()
})

/** A state with the search field in it, which is what `setSearchQuery` needs:
 *  the effect does nothing at all where the field is absent, and the field
 *  arrives with `search()` inside `findExtensions` once the engine is here. */
function stateOf(doc: string, selection?: { anchor: number; head: number }): EditorState {
  return EditorState.create({
    doc,
    ...(selection ? { selection: EditorSelection.single(selection.anchor, selection.head) } : {}),
    extensions: [findExtensions()],
  })
}

/** The same state with a query set on it, the way the bar sets one. */
function looking(state: EditorState, spec: Partial<typeof NO_FIND> & { query: string }) {
  const { query, ...rest } = { ...NO_FIND, ...spec }
  return state.update({
    effects: setSearchQuery.of(new SearchQuery({ search: query, ...rest })),
  }).state
}

const NOTE = 'the wind came up, and the Wind dropped. a windmill turned. wind.'

describe('counting the matches', () => {
  test('is nothing at all until something is being looked for', () => {
    expect(findTally(stateOf(NOTE))).toEqual({ count: 0, current: -1, capped: false })
  })

  test('counts every one of them', () => {
    const found = findTally(looking(stateOf(NOTE), { query: 'wind' }))
    expect(found.count).toBe(4)
    expect(found.capped).toBe(false)
  })

  test('and says which one the caret is sitting on', () => {
    // The third `wind` in the note, selected exactly: that is what stepping to a
    // match leaves behind it, and what the tally reads off.
    const at = NOTE.indexOf('windmill')
    const state = looking(stateOf(NOTE, { anchor: at, head: at + 4 }), { query: 'wind' })

    expect(findTally(state).current).toBe(2)
  })

  test('and says nothing about where the caret is when it is on none of them', () => {
    expect(findTally(looking(stateOf(NOTE), { query: 'wind' })).current).toBe(-1)
  })

  test('minds the case when it is asked to', () => {
    const state = stateOf(NOTE)
    expect(findTally(looking(state, { query: 'wind' })).count).toBe(4)
    expect(findTally(looking(state, { query: 'wind', caseSensitive: true })).count).toBe(3)
  })

  test('and whole words when it is asked to', () => {
    const state = stateOf(NOTE)
    // `windmill` is out, the other three are words of their own.
    expect(findTally(looking(state, { query: 'wind', wholeWord: true })).count).toBe(3)
  })

  test('reads a regular expression as one', () => {
    const state = looking(stateOf(NOTE), { query: 'w[a-z]+d', regexp: true })
    expect(findTally(state).count).toBe(4)
  })

  test('and refuses a regular expression that is not one', () => {
    // An unclosed group is a query the library calls invalid, and an invalid
    // query is nothing to count rather than a crash halfway through typing one.
    const state = looking(stateOf(NOTE), { query: 'w(ind', regexp: true })
    expect(getSearchQuery(state).valid).toBe(false)
    expect(findTally(state)).toEqual({ count: 0, current: -1, capped: false })
  })

  test('stops counting past a point, and says so', () => {
    // A note is a file somebody wrote, not a corpus. The bar reads "300+"
    // rather than spending a frame being exact about a number nobody reads.
    const many = findTally(looking(stateOf('a '.repeat(500)), { query: 'a' }))
    expect(many.count).toBe(300)
    expect(many.capped).toBe(true)
  })
})

describe('the term the bar opens on', () => {
  test('is the words the caret is sitting on', () => {
    const at = NOTE.indexOf('windmill')
    expect(termAt(stateOf(NOTE, { anchor: at, head: at + 8 }))).toBe('windmill')
  })

  test('is nothing where the caret is a caret rather than a selection', () => {
    // Which leaves whatever was last looked for in the field, still selected.
    expect(termAt(stateOf(NOTE, { anchor: 4, head: 4 }))).toBe('')
  })

  test('loses the space a word-wise selection brings with it', () => {
    // Ctrl+Shift+Right takes the space in front of the word, and nobody means to
    // look for that.
    const at = NOTE.indexOf(' wind')
    expect(termAt(stateOf(NOTE, { anchor: at, head: at + 5 }))).toBe('wind')
  })

  test('is nothing where the selection is half the note', () => {
    const long = 'x'.repeat(200)
    expect(termAt(stateOf(long, { anchor: 0, head: 200 }))).toBe('')
  })

  test('and a selection over two lines comes out as one line can hold it', () => {
    // A term with a real newline in it cannot be typed into a one-line field;
    // the library escapes it the same way for the same reason.
    expect(termAt(stateOf('one\ntwo', { anchor: 0, head: 7 }))).toBe('one\\ntwo')
  })
})

/** Alt+Enter in the bar: a cursor on every match. Through a stand-in for the view,
 *  which is all a command asks of one. */
describe('selecting every match', () => {
  function selected(state: EditorState): string[] | false {
    let after = state
    const view = {
      get state() {
        return after
      },
      dispatch: (spec: TransactionSpec) => {
        after = after.update(spec).state
      },
    } as unknown as EditorView

    if (!selectEveryMatch(view)) return false
    return after.selection.ranges.map((range) => after.sliceDoc(range.from, range.to))
  }

  test('puts a selection on each of them', () => {
    const state = looking(
      EditorState.create({
        doc: NOTE,
        extensions: [findExtensions(), EditorState.allowMultipleSelections.of(true)],
      }),
      { query: 'wind', wholeWord: true },
    )
    expect(selected(state)).toEqual(['wind', 'Wind', 'wind'])
  })

  test('does nothing where nothing is being looked for', () => {
    expect(selected(stateOf(NOTE))).toBe(false)
  })
})
