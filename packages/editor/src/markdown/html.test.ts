import { expect, test } from 'vitest'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { htmlGrammar } from '@nib/lang-html'
import { nibMarkdownExtensions } from './extensions'
import { parsed } from '../../test/parsed'

/** A note's HTML before the HTML grammar is here, and after.
 *
 *  Raw HTML blocks and inline tags are part of nib's markdown, and the grammar that
 *  colours them is fetched when a note first turns out to have one rather than before
 *  the window has drawn anything: `@codemirror/lang-markdown` used to bring it, and the
 *  CSS and JavaScript grammars nested inside it for `<style>` and `<script>`, whether
 *  or not the reader ever opened such a note. What it asks for now is nib's own door;
 *  see packages/lang-html, and `overrides` in the root manifest, which is what puts the
 *  door where the grammar was.
 *
 *  So there is a moment - the first tag in a run of the app, for as long as one fetch
 *  takes - when the parser meets a raw block and nothing here can colour it. What it
 *  gets is CodeMirror's own answer for a parser still on its way: the region is skipped
 *  and parsed again when the grammar lands. The block is plain and then coloured, which
 *  is exactly what a fence of an unloaded language already did.
 *
 *  The order of the tests below is the order of that: cold, and then warm. Which is why
 *  this is its own file - the grammar is module state, and a file that awaited it on its
 *  first line would have nothing cold left to measure. */

const NOTE = [
  '# A note',
  '',
  '<div class="card">',
  '  <p>A kestrel <em>hangs</em> on the wind.</p>',
  '  <style>.card { color: teal }</style>',
  '  <script>const wind = 12</script>',
  '</div>',
  '',
  'And an inline <u>tag</u> in a paragraph.',
  '',
].join('\n')

/** The editor's own markdown, as modes.ts builds it. */
function language() {
  return markdown({
    base: markdownLanguage,
    extensions: nibMarkdownExtensions,
    addKeymap: false,
  })
}

/** Every class the highlighter paints the note in, as a set - which follows the tree a
 *  nested grammar is mounted as, so this is the HTML inside the raw block and the CSS
 *  and JavaScript inside that. A class only those can produce is how the cold parse and
 *  the warm one are told apart; the classes markdown produces are in both. */
function classes(): Set<string> {
  const found = new Set<string>()

  highlightTree(language().language.parser.parse(NOTE), classHighlighter, (_from, _to, style) => {
    for (const one of style.split(' ')) found.add(one)
  })

  return found
}

test('a note’s HTML is plain until the grammar lands', async () => {
  // Cold. The note is coloured as markdown - it has a heading in it - and the two
  // regions that are HTML are left exactly as they were.
  const cold = classes()
  expect(cold.has('tok-heading')).toBe(true)
  expect(cold.has('tok-typeName')).toBe(false)
  expect(cold.has('tok-propertyName')).toBe(false)
  expect(cold.has('tok-className')).toBe(false)
  expect(cold.has('tok-keyword')).toBe(false)

  const grammar = await htmlGrammar()
  expect(grammar.htmlLanguage.name).toBe('html')
})

test('and coloured once it is here, the same parse over again', async () => {
  // The same reason as the test below: this one says what a warm parse does, and that
  // is true of a warm parse whichever test warmed it.
  await htmlGrammar()

  const warm = classes()

  expect(warm.has('tok-heading')).toBe(true)
  // The tags and the attribute, in the raw block and in the inline tag both.
  expect(warm.has('tok-typeName')).toBe(true)
  expect(warm.has('tok-propertyName')).toBe(true)
  // The selector from the CSS inside the `<style>`, and a keyword from the JavaScript
  // inside the `<script>`: the two grammars nested inside the HTML one.
  expect(warm.has('tok-className')).toBe(true)
  expect(warm.has('tok-keyword')).toBe(true)
})

/** A character typed into a document, through the editor's input handlers and nothing
 *  else: what the document says afterwards.
 *
 *  The view is as much of one as the close-tag handler reads - whether a composition is
 *  in progress, the state, and somewhere to dispatch what it decides - because nothing
 *  it does draws, and the editor's own tests have no document to draw into.
 *
 *  Two parses stand between the press and the answer, and each of them is on a clock
 *  that is not this test's.
 *
 *  The first is the document as it stands: creating a state parses for twenty
 *  milliseconds and keeps whatever it has when that runs out, so the tag the handler
 *  looks for may not be in the tree at all. That one is settled outright - `parsed`
 *  finishes the parse and hands back a state holding the finished tree, which is what
 *  every other test in this package that reads a tree does.
 *
 *  The second cannot be: the handler reads the tree of the state the press would make,
 *  and asks for that state through `insert()`. A state a change makes parses on the
 *  same twenty milliseconds, the library spends them itself, and nothing a caller can
 *  reach will widen or finish them - the advanced parse lives on the context and the
 *  tree a state hands out is a snapshot taken before it. On a quiet machine twenty
 *  milliseconds is a hundred times what thirty characters of markdown need; on a
 *  machine running the whole suite it is not always enough, and this file passed alone
 *  and failed in the full run for exactly that reason.
 *
 *  So the press is offered again until it is taken. Not a clock and not a sleep: each
 *  press is the whole gesture over again, and every one of them builds the state the
 *  library will parse afresh - so a press that found the tag missing is followed by
 *  one that finds it there, which is precisely what a reader's next keystroke does.
 *  A handler that declines every time is a handler that means it, and the assertion
 *  after this says so. */
function typed(doc: string, at: number, text: string): string {
  let state = parsed(EditorState.create({ doc, extensions: [language()] }))

  const insert = (): Transaction =>
    state.update({
      changes: { from: at, to: at, insert: text },
      selection: { anchor: at + text.length },
    })

  const view = {
    composing: false,
    get state() {
      return state
    },
    dispatch: (specs: readonly Transaction[]) => {
      for (const one of specs) state = one.state
    },
  } as unknown as EditorView

  const press = () => {
    for (const handle of state.facet(EditorView.inputHandler)) {
      if (handle(view, at, at, text, insert)) return true
    }
    return false
  }

  for (let asked = 0; asked < ASKED_AT_MOST; asked++) {
    if (press()) break
  }

  return state.doc.toString()
}

/** How many times a press is offered before the answer is taken as the answer.
 *
 *  What it is waiting for is one parse of thirty characters, which every one of these
 *  gives another twenty milliseconds to. A machine that cannot finish that in twenty
 *  of them has something worse wrong with it than this test, and a handler that
 *  declines a press it should take declines all twenty. */
const ASKED_AT_MOST = 20

test('and a tag typed inside a raw block still closes itself', async () => {
  // Waited for here as well as in the first test, rather than leaning on that one
  // having run: the handler the door delegates to arrives with the grammar, and a test
  // whose truth depends on which test ran before it is a test that fails when somebody
  // runs this one on its own.
  await htmlGrammar()

  // The `>` that finishes `<em` inside a raw block, which is where the one extension in
  // the HTML support that a note can feel puts `</em>`. nib's door is in the
  // configuration from the start and delegates to that handler once the grammar is
  // here, so nothing had to be reconfigured when it landed. The block's own closing tag
  // is deliberately not below the caret: a tag something else already closes is closed.
  const block = '# Typing\n\n<div>\n  <p>Wind</p><em\n'
  expect(typed(block, block.indexOf('<em') + 3, '>')).toBe(
    '# Typing\n\n<div>\n  <p>Wind</p><em></em>\n',
  )

  // And a `>` typed in prose is a `>`: the handler declines, and nothing but the
  // character the reader typed goes in - which is the editor's own business.
  const prose = '# Typing\n\nplain text\n'
  expect(typed(prose, prose.length - 1, '>')).toBe(prose)
})
