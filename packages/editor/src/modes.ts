import {
  Compartment,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { language as currentLanguage, syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { commonmarkLanguage, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { isExternal } from './external'
import { fenceLanguage } from './languages'
import type { PropertiesMode } from '@nib/markdown/properties'
import { livePreview } from './live-preview'
import { noReveal } from './live-preview/reveal'
import { numberEquations, propertiesMode } from './live-preview/blocks'
import { nibMarkdownExtensions } from './markdown/extensions'
import { enclosing } from './nodes'
import { flushTableEdits } from './table/widget'
import { smartPunctuation } from './typography'
import { codeThemeEffect } from './code-theme'
import { ligatures, type LigatureScope } from './ligatures'
import { knownWords, spellingWords } from './spelling'
import { once } from './once'
import { completionEffect } from './completion'
import { wrapSelection } from './wrap'
import { vimEffect, vimExtensions } from './vim'

/** Each mode lives in its own compartment so it can be swapped at runtime
 *  without rebuilding the editor state. */
const preview = new Compartment()
const focus = new Compartment()
const typewriter = new Compartment()
const punctuation = new Compartment()
const language = new Compartment()
const equations = new Compartment()
/** Which of the three answers the note's front matter gets; see properties.ts in
 *  @nib/markdown and live-preview/properties.ts here. */
const metadata = new Compartment()
const spelling = new Compartment()
const spellWords = new Compartment()
const brackets = new Compartment()
const glyphs = new Compartment()
const readOnly = new Compartment()
const headingNumbers = new Compartment()
const codeLineNumbers = new Compartment()
const direction = new Compartment()
const deck = new Compartment()

/** A class the stylesheet works from, handed to the editor rather than put on
 *  its element. CodeMirror writes that element's class attribute out from its
 *  own facets every time the editor takes or loses focus, so a class added
 *  with `classList` survives only until the next click somewhere else - the
 *  mode was still on while everything that made it visible was gone. Attributes
 *  from this facet are merged into what CodeMirror writes, and they leave again
 *  when the compartment holding them is emptied. */
function editorClass(name: string): Extension {
  return EditorView.editorAttributes.of({ class: name })
}

/** Strict mode drops GFM and the Typora extensions, leaving plain CommonMark -
 *  useful when a document has to render the same everywhere.
 *
 *  `addKeymap: false` because the two keys `markdown()` would bind for itself
 *  are bound in editor.ts instead, where every keymap of plain bindings lives
 *  and where Enter can be told how a list ends.
 *
 *  `codeLanguages` is the lookup rather than the list, which `markdown()` takes
 *  either way: the list of a hundred and forty-three is fetched when a fence first
 *  names a language, and a function is what can answer before it is here. See
 *  languages.ts.
 *
 *  The other nested parser is HTML, for a raw block or an inline tag, and it arrives
 *  the same way without being asked for here: what `@codemirror/lang-markdown` gets
 *  when it asks for `@codemirror/lang-html` is nib's own door, said once in the root
 *  manifest. The grammar behind it - and the CSS and JavaScript grammars nested inside
 *  it, for `<style>` and `<script>` - comes with the first note that has a tag in it
 *  instead of before the window has drawn anything. See packages/lang-html. */
const markdownFor = once((strict: boolean): Extension =>
  markdown({
    base: strict ? commonmarkLanguage : markdownLanguage,
    codeLanguages: fenceLanguage,
    extensions: strict ? [] : nibMarkdownExtensions,
    addKeymap: false,
  }),
)

/** How long a document may be before the incremental parse is left out of it, in
 *  characters.
 *
 *  Half a megabyte, which is about eight thousand lines of prose. Past that the
 *  parse costs more than it is worth: `@codemirror/language` builds the tree in
 *  idle slices, and on a note of twenty thousand lines those slices ran back to
 *  back for two seconds at a hundred milliseconds each - so the ten keystrokes
 *  after the note opened were all painted at once, two seconds after the first of
 *  them. A reader typing at the end of a long note is the case, and a keystroke that
 *  arrives when it is typed is worth more than coloured syntax in a document nobody
 *  can see all of.
 *
 *  What is lost is written down beside `parseGuard`. Every threshold of this kind is
 *  a guess; this one is where the slices stop fitting inside a frame on the machine
 *  this was measured on, rounded down to a round number. Obsidian and VS Code both
 *  stop highlighting past a size for the same reason. */
const PARSED_AT_MOST = 512 * 1024

/** What the language compartment holds for a document that is not being parsed.
 *
 *  One value rather than a fresh empty array each time, for the reason `once.ts`
 *  gives: a compartment handed a different value - even an equal one - is a
 *  configuration rebuilt, and a configuration rebuilt drops whatever was parsed. */
const NO_LANGUAGE: Extension = []

/** Whether a document is long enough that the parse is left out of it. Exported so
 *  the app can say so where it says what else is true of the note; see
 *  `parsedFully` in index.ts. */
export function tooLongToParse(length: number): boolean {
  return length > PARSED_AT_MOST
}

/** Which language a view's compartment holds when it holds one at all: strict mode
 *  is plain CommonMark, and everything else is markdown with Nib's own extensions.
 *
 *  Kept in the state rather than in a variable, because the guard below has to be
 *  able to put the right one back and there is a view per pane. */
const strictly = StateEffect.define<boolean>()

const strictness = StateField.define<boolean>({
  create: () => false,
  update: (was, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(strictly)) return effect.value
    }

    return was
  },
})

/** Whether this state has been through a transaction yet. A state is created with
 *  the language in it, because nothing at that point knows how long the document is;
 *  the first transaction is where the guard below looks. */
const seen = StateField.define<boolean>({ create: () => false, update: () => true })

/** The parse, taken away from a document too long to be worth it and given back to
 *  one that is short enough.
 *
 *  Here rather than at the call sites, because the call sites do not all know how
 *  long the document is: `modeEffects` is handed the modes and puts the language back
 *  whenever a pane takes a note on, a sync can replace a short document with a long
 *  one, and a paste can make a short one long. This is the one place that decides,
 *  and it decides from the document.
 *
 *  What a document with no parse loses, and it is not a little: the syntax colouring,
 *  and everything the live preview draws - a heading as a heading, bold as bold, a
 *  table as a table, an equation set, an image shown, a callout, the contents widget,
 *  the syntax concealed around the caret. All of those are built by walking the tree;
 *  see live-preview/decorate.ts. With them go folding a section, bracket matching, the
 *  code inside a fence coloured by its own language, the slash menu's and `[[`'s test
 *  for "am I inside code", smart punctuation's same test, moving between table cells,
 *  and the block ids a link can point at.
 *
 *  What it keeps is the note: every word, every line, the caret, typing, undo, find
 *  and replace, the word count - and everything the app reads out of the text rather
 *  than out of the editor, which is the outline, the links, the tags, the reading view
 *  and every export. So a note this long is legible and writeable, and reads as source.
 *
 *  That is a lot to lose quietly, so it is not lost quietly: `parsedFully` is how the
 *  app asks, and the status bar says "No preview" beside the note's other facts. */
const parseGuard = EditorState.transactionExtender.of((transaction) => {
  const was = transaction.startState
  const plain = tooLongToParse(transaction.newDoc.length)

  // Three moments, and no others: the document crossed the size, somebody set the
  // language - `modeEffects` does, whenever a pane takes a note on, and it is not
  // told how long the note is - and the first transaction after a state was made,
  // which is where a note that was already long is caught.
  const crossed = plain !== tooLongToParse(was.doc.length)
  const set = transaction.effects.some((effect) => effect.is(strictly))
  if (!crossed && !set && was.field(seen, false) === true) return null

  return {
    effects: language.reconfigure(
      plain ? NO_LANGUAGE : markdownFor(strictnessAfter(was, transaction.effects)),
    ),
  }
})

/** Which language this transaction leaves the view in, strict or not: what it says
 *  if it says anything, and what was already true otherwise. */
function strictnessAfter(was: EditorState, effects: readonly StateEffect<unknown>[]): boolean {
  for (const effect of effects) {
    if (effect.is(strictly)) return effect.value
  }

  return was.field(strictness, false) ?? false
}

const dim = Decoration.line({ class: 'nib-dim' })

/** Dims every block except the one holding the caret. */
const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    private build(view: EditorView): DecorationSet {
      const { state } = view
      const head = state.selection.main.head
      const block = enclosingBlock(state, head)
      const ranges = []

      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to;) {
          const line = state.doc.lineAt(pos)
          if (line.to < block.from || line.from > block.to) ranges.push(dim.range(line.from))
          if (line.to >= state.doc.length) break
          pos = line.to + 1
        }
      }

      return Decoration.set(ranges, true)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** The paragraph, list or fence the caret sits in - Typora dims by block, not line. */
function enclosingBlock(state: EditorView['state'], pos: number) {
  // The outermost node under the document, which is the block the caret is in.
  let block: SyntaxNode | null = null
  for (const node of enclosing(syntaxTree(state).resolveInner(pos, -1))) {
    if (node.name !== 'Document') block = node
  }

  if (!block) {
    const line = state.doc.lineAt(pos)
    return { from: line.from, to: line.to }
  }

  return { from: block.from, to: block.to }
}

/** Keeps the caret's line parked in the middle of the viewport. */
const typewriterPlugin = EditorView.updateListener.of((update) => {
  if (!update.docChanged && !update.selectionSet) return

  const view = update.view
  const head = view.state.selection.main.head
  const block = view.lineBlockAt(head)
  const middle = view.scrollDOM.clientHeight / 2
  const offset = block.top - view.scrollDOM.scrollTop - middle + block.height / 2

  if (Math.abs(offset) < 1) return
  view.scrollDOM.scrollTop += offset
})

/** A fresh editor's modes: the defaults, said through the same builders the
 *  effects below use, so a view the app dresses the moment it is built is handed
 *  the values it already holds rather than equal ones built again. See once.ts.
 *
 *  `length` is how long the document it is being built around is, so a note already
 *  too long to parse is built without the language rather than having it taken away
 *  on the first transaction after. That distinction is the whole fix: a note opened
 *  and read rather than typed in sends no transaction at all, and the parse would
 *  have run for its two seconds before anything came along to stop it. See
 *  `parseGuard`, which is what catches every later way a document can change size.
 */
export function modeExtensions(length = 0): Extension {
  return [
    language.of(tooLongToParse(length) ? NO_LANGUAGE : markdownFor(false)),
    // Which language the compartment holds when it holds one, and the guard that
    // takes it away from a document too long to be worth parsing.
    strictness,
    seen,
    parseGuard,
    preview.of(previewFor(false)),
    focus.of(focusFor(false)),
    typewriter.of(typewriterFor(false)),
    punctuation.of(punctuationFor(false)),
    equations.of(numberEquations.of(false)),
    // The rows, which is where every note starts: the metadata a note carries is
    // worth reading, and the source is one caret away.
    metadata.of(propertiesMode.of('properties')),
    // Off until asked for: a checker's wavy lines under prose that is not in
    // its dictionary's language are noise, and most notes start that way.
    spelling.of(spellingFor(false)),
    spellWords.of(spellWordsFor('')),
    brackets.of(bracketsFor(true)),
    // Off until asked for: a note reads as typed unless someone chose otherwise.
    glyphs.of(ligaturesFor('off')),
    readOnly.of(readOnlyFor(false)),
    headingNumbers.of(headingNumbersFor(false)),
    codeLineNumbers.of(codeLineNumbersFor(false)),
    direction.of(directionFor(false)),
    // Whether this note is a deck. Not one of the modes: it is a fact about the
    // note in the editor rather than a choice anybody made, so the app tells
    // each view about its own note; see setDeck.
    deck.of(deckFor(false)),
    // Off until asked for. Its compartment lives with the rest of it in
    // vim.ts, which is a mode with a keymap of its own to answer for.
    vimExtensions(),
  ]
}

/** What read-only mode puts over the editor while it is on.
 *
 *  Three locks, because a document can be written to through three different
 *  doors. `editable` takes the contenteditable off the writing surface, so the
 *  browser stops offering it as somewhere to type and stops drawing a caret in
 *  it. `readOnly` is what CodeMirror's own handlers and every command in
 *  @codemirror/commands ask before they write - it is how Backspace, Enter and
 *  undo come to refuse. And the change filter has the last word: a widget - a
 *  checkbox, a cell of a rendered table, the language on a fence - dispatches
 *  its change straight at the view and asks nobody's permission. Only a change
 *  from outside the editor gets through, so a note being loaded, a version
 *  restored or a sync arriving still lands under the reader's eyes. */
function readOnlyExtensions(): Extension {
  return [
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    // Nothing reveals: see live-preview/reveal.ts.
    noReveal.of(true),
    // A surface that is not editable is not focusable either, and a page
    // nothing can focus cannot be scrolled, searched or selected from the
    // keyboard. So it keeps its place in the tab order; the caret that would
    // otherwise blink in it is taken away in the stylesheet.
    EditorView.contentAttributes.of({ tabindex: '0' }),
    // The class the stylesheet works from. Handed to the editor rather than
    // put on its element, because CodeMirror writes that element's class
    // attribute out from its own facets every time the editor takes or loses
    // focus - a class added from outside survives only until the next click
    // somewhere else. Attributes from this facet are merged into what it
    // writes, so this one is part of the configuration and goes when the
    // compartment is emptied.
    EditorView.editorAttributes.of({ class: 'nib-read-only' }),
    EditorState.changeFilter.of(isExternal),
  ]
}

/* What each mode is while it is on, said once. The setter that toggles one and
   the batch that configures a whole editor for all of them both read from here,
   so the two cannot drift into meaning different things. */

const readOnlyFor = once((on: boolean): Extension => (on ? readOnlyExtensions() : []))

/** Source mode shows the markdown as written, so nothing is drawn over it. */
const previewFor = once((source: boolean): Extension => (source ? [] : livePreview()))

const focusFor = once((on: boolean): Extension =>
  on ? [focusPlugin, editorClass('nib-focus-mode')] : [],
)

/** The class buys extra room below the last line, so the caret can still reach
 *  the middle. */
const typewriterFor = once((on: boolean): Extension =>
  on ? [typewriterPlugin, editorClass('nib-typewriter-mode')] : [],
)

/** Shows `->`, `<=` and their kind as the arrow or sign they stand for; the text
 *  underneath stays as typed. The class lets the stylesheet hold back the code
 *  font's own ligatures wherever this scope draws none, so that off means off:
 *  it is on for both scopes that draw in code, which is both of them. */
const ligaturesFor = once((scope: LigatureScope): Extension =>
  scope === 'off' ? [] : [ligatures(scope), editorClass('nib-ligatures')],
)

/** Curly quotes, dashes, ellipsis. Off until asked for: a note is a file other
 *  tools read, and a character nobody typed is a surprise in it - the dashes
 *  most of all, which is how a deck lost every one of its slide breaks. Typora
 *  has it on; nib would rather hand back what was written. */
const punctuationFor = once((on: boolean): Extension => (on ? smartPunctuation() : []))

/** CSS counters number the headings; the document text stays untouched. */
const headingNumbersFor = once((on: boolean): Extension => (on ? editorClass('nib-numbered') : []))

/** Numbers the lines inside code fences, counting from one per fence. */
const codeLineNumbersFor = once((on: boolean): Extension =>
  on ? editorClass('nib-line-numbers') : [],
)

/** Brackets and quotes close themselves, and a mark typed over a selection goes
 *  around it. One switch, because both are the same promise: what you type
 *  lands around what you meant rather than over it.
 *
 *  Only nib's own half is here. The library's `closeBrackets` lives in the compartment
 *  the completion menus come through, because it is the same package as they are and it
 *  is fetched with them; every caller below says the switch to both. See
 *  completion.ts. */
const bracketsFor = once((on: boolean): Extension => (on ? wrapSelection() : []))

/** A note whose rules break it into slides. Only a class, because that is all
 *  the difference is: the rules are already decorated, and the stylesheet shows
 *  which of them are slide breaks while this is on. See
 *  packages/markdown/src/slides.ts for what makes a note a deck. */
const deckFor = once((on: boolean): Extension => (on ? editorClass('nib-deck') : []))

/** The writing direction, given to the editor the same way as the class: the
 *  content element's attributes are CodeMirror's to write too. */
const directionFor = once((rtl: boolean): Extension =>
  rtl
    ? [EditorView.contentAttributes.of({ dir: 'rtl' }), editorClass('nib-rtl')]
    : EditorView.contentAttributes.of({ dir: 'ltr' }),
)

/** The browser's own spell checker, over the writing surface. `language` is the
 *  dictionary to check against, as a language tag; the browser reads it off the
 *  surface's `lang`. Without one it falls back to its own choice.
 *
 *  Two settings in one extension, so what is built once is keyed on the pair of
 *  them written out as one string; see once.ts. */
const spellings = once((setting: string): Extension => {
  const language = setting.slice(setting.indexOf('|') + 1)
  return EditorView.contentAttributes.of({
    spellcheck: setting.startsWith('on|') ? 'true' : 'false',
    ...(language ? { lang: language } : {}),
  })
})

/** A word list as one string, which is what a compartment can be keyed on: a
 *  fresh array equal to the one already there is still a reconfiguration that
 *  throws work away. See once.ts. */
const BETWEEN = '\n'

function joined(words: readonly string[] | undefined): string {
  return (words ?? []).join(BETWEEN)
}

/** The reader's own words: the checker is turned off over each of them wherever
 *  it appears. See spelling.ts. */
const spellWordsFor = once((words: string): Extension => [
  knownWords.of(words ? words.split(BETWEEN) : []),
  spellingWords(),
])

const spellingFor = (on: boolean, language?: string): Extension =>
  spellings(`${on ? 'on' : 'off'}|${language ?? ''}`)

/** Every mode there is, as the app holds them; see modes.svelte.ts. */
export interface ModeSettings {
  source: boolean
  readOnly: boolean
  focus: boolean
  typewriter: boolean
  punctuation: boolean
  numbers: boolean
  lineNumbers: boolean
  codeTheme: string
  rtl: boolean
  strict: boolean
  equationNumbers: boolean
  /** What the note's front matter is drawn as: its rows, its source, or nothing. */
  properties: PropertiesMode
  spellcheck: boolean
  /** Which dictionary to check against. Absent leaves the choice to the
   *  browser. */
  dictionary?: string | undefined
  /** The reader's own words, which the checker is turned off over. */
  words?: readonly string[] | undefined
  closeBrackets: boolean
  /** How much of a note the ligature glyphs are drawn over. */
  ligatures: LigatureScope
  vim: boolean
}

/** Every mode at once, as the effects that put an editor into them.
 *
 *  One transaction rather than seventeen. A pane taking another note on swaps in
 *  a state built for whatever the modes were at the time, and this is what
 *  brings it up to what they are now - in the same transaction as the caret and
 *  the scroll, so the note appears already in its modes instead of settling into
 *  them over the frames after it. */
export function modeEffects(settings: ModeSettings): StateEffect<unknown>[] {
  // A cell may be holding an edit that has not reached the document yet, and
  // what goes on below can take the table, the keyboard, or the right to write
  // at all, out from under it.
  flushTableEdits()

  return [
    // Said whether the language is going in or not, because it is what the guard
    // puts back when a document is short enough to parse again.
    strictly.of(settings.strict),
    language.reconfigure(markdownFor(settings.strict)),
    preview.reconfigure(previewFor(settings.source)),
    // Source mode and read-only are opposite answers to the same question, and
    // the markdown as written is the writer's answer; see setReadOnlyMode.
    readOnly.reconfigure(readOnlyFor(settings.readOnly && !settings.source)),
    focus.reconfigure(focusFor(settings.focus)),
    typewriter.reconfigure(typewriterFor(settings.typewriter)),
    punctuation.reconfigure(punctuationFor(settings.punctuation)),
    equations.reconfigure(numberEquations.of(settings.equationNumbers)),
    metadata.reconfigure(propertiesMode.of(settings.properties)),
    spelling.reconfigure(spellingFor(settings.spellcheck, settings.dictionary)),
    spellWords.reconfigure(spellWordsFor(joined(settings.words))),
    brackets.reconfigure(bracketsFor(settings.closeBrackets)),
    // The library's own half of the same switch, which arrives with the popup it shares
    // a package with; see completion.ts.
    completionEffect(settings.closeBrackets),
    glyphs.reconfigure(ligaturesFor(settings.ligatures)),
    headingNumbers.reconfigure(headingNumbersFor(settings.numbers)),
    codeLineNumbers.reconfigure(codeLineNumbersFor(settings.lineNumbers)),
    direction.reconfigure(directionFor(settings.rtl)),
    codeThemeEffect(settings.codeTheme),
    vimEffect(settings.vim),
  ]
}

export function setStrictMode(view: EditorView, on: boolean) {
  // Strict mode has no tables; a cell still being typed in would go with them.
  flushTableEdits()
  view.dispatch({
    effects: [strictly.of(on), language.reconfigure(markdownFor(on))],
  })
}

/** Whether the document in this state is being parsed, which is what decides whether
 *  its syntax is coloured and whether the live preview draws anything at all.
 *
 *  False for a document past `PARSED_AT_MOST`. Read by the app so it can say so rather
 *  than leave a reader wondering why a long note came out as source; see `parseGuard`
 *  for the whole of what such a note loses and keeps. */
export function parsedFully(state: EditorState): boolean {
  return state.facet(currentLanguage) !== null
}

/** Numbers display equations and lets `\eqref` point at them. */
/** What a note's front matter is drawn as, from now on, in every pane. */
export function setProperties(view: EditorView, mode: PropertiesMode) {
  view.dispatch({ effects: metadata.reconfigure(propertiesMode.of(mode)) })
}

export function setEquationNumbers(view: EditorView, on: boolean) {
  view.dispatch({ effects: equations.reconfigure(numberEquations.of(on)) })
}

/** Source mode shows the markdown as written, with no syntax hidden. */
export function setSourceMode(view: EditorView, on: boolean) {
  flushTableEdits()
  // Turning it on unlocks a note that was read-only: the two are opposite
  // answers to the same question, and the markdown as written is the writer's
  // answer. See setReadOnlyMode below.
  view.dispatch({
    effects: on
      ? [preview.reconfigure(previewFor(true)), readOnly.reconfigure(readOnlyFor(false))]
      : preview.reconfigure(previewFor(false)),
  })
}

/** Read-only mode: the note laid out as it reads, with nothing that writes to
 *  it. The app's reading view is a different thing - the note through the
 *  renderer, in Reading.svelte - and this is the editor with the doors locked.
 *
 *  Source mode is its opposite, so the two are never both on: turning either one
 *  on turns the other off. Locking raw markdown is a contradiction, since source
 *  mode is for seeing what you are about to type. */
export function setReadOnlyMode(view: EditorView, on: boolean) {
  // A cell may be holding an edit that has not reached the document yet, and
  // once this is on nothing can put it there.
  flushTableEdits()
  view.dispatch({
    effects: on
      ? [readOnly.reconfigure(readOnlyFor(true)), preview.reconfigure(previewFor(false))]
      : readOnly.reconfigure(readOnlyFor(false)),
  })
}

export function setFocusMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: focus.reconfigure(focusFor(on)) })
}

export function setTypewriterMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: typewriter.reconfigure(typewriterFor(on)) })
}

export function setLigatures(view: EditorView, scope: LigatureScope) {
  view.dispatch({ effects: glyphs.reconfigure(ligaturesFor(scope)) })
}

export function setSmartPunctuation(view: EditorView, on: boolean) {
  view.dispatch({ effects: punctuation.reconfigure(punctuationFor(on)) })
}

export function setHeadingNumbers(view: EditorView, on: boolean) {
  view.dispatch({ effects: headingNumbers.reconfigure(headingNumbersFor(on)) })
}

export function setCodeLineNumbers(view: EditorView, on: boolean) {
  view.dispatch({ effects: codeLineNumbers.reconfigure(codeLineNumbersFor(on)) })
}

/** Whether the note in this view is a deck, which marks the rules that break it
 *  into slides. Per view rather than per app: two panes may hold two notes and
 *  only one of them be a deck. */
export function setDeck(view: EditorView, on: boolean) {
  view.dispatch({ effects: deck.reconfigure(deckFor(on)) })
}

/** Widens or narrows the writing column. */
export function setMeasure(view: EditorView, rem: number) {
  view.dom.style.setProperty('--measure', `${rem}rem`)
  remeasure(view)
}

/** Line height for the writing surface. */
export function setLineHeight(view: EditorView, height: number) {
  view.dom.style.setProperty('--leading-content', String(height))
  remeasure(view)
}

/** Tells the editor its text has changed shape.
 *
 *  Every one of these settings works by writing a CSS custom property, and a
 *  custom property is invisible to CodeMirror: it caches the line height and
 *  character width it measured once and goes on trusting them. The cached
 *  numbers are what place the caret and decide which line a click lands on, so
 *  a stale one puts every position slightly out - and the error adds up with
 *  every line down the document. */
export function remeasure(view: EditorView) {
  // A view torn down between the change and this call has nothing to measure.
  if (view.dom.isConnected) view.requestMeasure()
}

export function setSpellcheck(view: EditorView, on: boolean, language?: string) {
  view.dispatch({ effects: spelling.reconfigure(spellingFor(on, language)) })
}

/** The words the checker is turned off over; see spelling.ts. */
export function setSpellWords(view: EditorView, words: readonly string[]) {
  view.dispatch({ effects: spellWords.reconfigure(spellWordsFor(joined(words))) })
}

export function setCloseBrackets(view: EditorView, on: boolean) {
  view.dispatch({ effects: [brackets.reconfigure(bracketsFor(on)), completionEffect(on)] })
}

export function setRightToLeft(view: EditorView, on: boolean) {
  view.dispatch({ effects: direction.reconfigure(directionFor(on)) })
}
