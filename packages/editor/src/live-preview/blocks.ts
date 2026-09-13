import { syntaxTree } from '@codemirror/language'
import {
  type ChangeDesc,
  type EditorState,
  Facet,
  type Range,
  type SelectionRange,
  StateField,
  type Transaction,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { isExternal } from '../external'
import { fenceCode, fenceLanguage } from '../fence'
import { readChart } from '@nib/markdown/chart'
import { htmlBlockCard } from '@nib/markdown/html-block'
import { type EmbedKind, embedKind } from '@nib/markdown/links'
import { coverOf } from '@nib/markdown/cover'
import { readProperties } from '@nib/markdown/properties'
import { CoverWidget } from './cover'
import { PropertiesWidget } from './properties'
import { embedOfBlock, embedWidget } from '../wikilink/embed'
import { trustChanged, trustsMarkup } from '../markup'
import { noteIndex, type NoteIndex } from '../wikilink/notes'
import { standsAlone } from '../table/navigation'
import { TableWidget } from '../table/widget'
import { dragging } from './dragging'
import { lineRevealed, noReveal, overlaps } from './reveal'
import {
  ChartWidget,
  DiagramWidget,
  MathWidget,
  QueryWidget,
  recordEquationLabel,
  RENDERED_LANGUAGES,
  resetEquationLabels,
} from './render'
import { headings, TocWidget } from './toc'
import { WebEmbedWidget } from './web'

/** CodeMirror only accepts block-level replacements from a state field, so the
 *  constructs that occupy whole lines live here rather than in the
 *  viewport-scoped plugin. A field has no viewport to scope to, so the walk
 *  is kept cheap two other ways: it steps over everything that is not a block
 *  (a paragraph's emphasis and links cannot hold one of these), and a
 *  transaction that only moved the caret rebuilds nothing unless the caret
 *  crossed one of the constructs found last time. */
/** Whether display equations carry a number on the right. */
export const numberEquations = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
})

/** The longest a `[toc]` line can be, so paragraphs are dismissed on their
 *  length before their first line is read out of the document. */
const TOC_MAX = 16

/** The kinds of embed that are drawn where they stand rather than as a block of
 *  their own: decorate.ts draws these inline, whether or not the line holds
 *  anything else. */
const MEDIA: ReadonlySet<EmbedKind | null> = new Set<EmbedKind>(['image', 'audio', 'video'])

/** Labels have to be known before any `\eqref` renders, so equations are
 *  counted in a first pass over the document. */
function collectEquationLabels(state: EditorState): Map<number, number> {
  const numbers = new Map<number, number>()
  let counter = 0
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'BlockMath') return node.type.is('Block')

      counter += 1
      numbers.set(node.from, counter)

      const doc = state.doc
      const tex = doc.sliceString(doc.lineAt(node.from).to, doc.lineAt(node.to).from)
      recordEquationLabel(tex, counter)
      return false
    },
  })

  return numbers
}

/** What the field keeps: the decorations, and the lines every construct it
 *  considered sits on. The spans are what makes a caret move cheap - see
 *  `crosses` below. */
interface Blocks {
  decorations: DecorationSet
  spans: readonly { from: number; to: number }[]
  /** Whether a `[toc]` is among them. What one shows is every heading in the
   *  note, so it is the one construct that changes when a line far from it
   *  does, and the one that rules out the shortcut below. */
  toc: boolean
  /** Whether the caret is where somebody put it, which is what decides whether
   *  it reveals; see `buildBlocks`. A caret nobody chose counts as chosen once
   *  it is clear of every construct in a note that is parsed to the end, since
   *  from there on it can reveal nothing whatever the answer. Which is also why
   *  an unchosen caret always crosses one of `spans`, the invariant the
   *  caret-move shortcut in `update` leans on. */
  chosen: boolean
}

/** Builds every block decoration a state gets.
 *
 *  `reveals` is false while nobody has put the caret where it is. A state is
 *  created with a caret at 0 unless someone says otherwise, and 0 is the start of
 *  the document's first block - so a note whose first thing is a table, a display
 *  equation, a diagram or a `[toc]` opened showing its markdown, on every open and
 *  every switch between notes. Nobody put the caret there on purpose, so nothing
 *  is revealed for it, and it stays that way until a transaction moves the caret
 *  or changes the note: see `chosen`. */
function buildBlocks(state: EditorState, reveals = true): Blocks {
  const ranges: Range<Decoration>[] = []
  const spans: { from: number; to: number }[] = []
  let toc = false
  const doc = state.doc
  const numbered = state.facet(numberEquations)
  const revealed = (from: number, to: number) => reveals && overlaps(state, from, to)
  const lineRevealedAt = (pos: number) => reveals && lineRevealed(state, pos)
  // The labels belong to this document, so they are dropped whether or not
  // numbering is on. With it off there is nothing for `\eqref` to resolve to,
  // and it must not answer with a number left over from another note.
  resetEquationLabels()
  const equationNumbers = numbered ? collectEquationLabels(state) : new Map<number, number>()

  const wholeLines = (from: number, to: number) => ({
    from: doc.lineAt(from).from,
    to: doc.lineAt(to).to,
  })

  /** Records where a construct is before deciding what to draw for it, so a
   *  later caret move knows this is a place worth looking at again. */
  const found = (from: number, to: number) => {
    const span = wholeLines(from, to)
    spans.push(span)
    return span
  }

  syntaxTree(state).iterate({
    enter: (node) => {
      switch (node.name) {
        case 'BlockMath': {
          // Quoted or indented, the `> ` or the indent would be swallowed by the
          // replacement and handed to the renderer as if it were maths; see
          // `standsAlone`.
          if (!standsAlone(state, node.from)) return true

          const span = found(node.from, node.to)
          if (revealed(node.from, node.to)) return false
          const tex = doc.sliceString(doc.lineAt(node.from).to, doc.lineAt(node.to).from).trim()
          ranges.push(
            Decoration.replace({
              widget: new MathWidget(tex, true, equationNumbers.get(node.from)),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        // The note's own metadata, as the rows it says. A block like any other:
        // the caret in it shows the YAML, which is the only editor it needs.
        // A block holding a shape @nib/markdown cannot read stays source, whole;
        // see properties.ts there and beside this file.
        case 'FrontMatter': {
          const span = found(node.from, node.to)
          const source = doc.sliceString(node.from, node.to)

          // The cover, first: a band of picture across the top of the note, drawn
          // above the metadata whether or not the metadata is showing its source.
          // Inserted rather than replacing anything, because it stands for two keys
          // of front matter and not for a run of the document; see cover.ts beside
          // this file.
          const cover = coverOf(source)
          if (cover) {
            ranges.push(
              Decoration.widget({
                widget: new CoverWidget(cover),
                block: true,
                side: -1,
              }).range(span.from),
            )
          }

          if (revealed(node.from, node.to)) return false
          if (readProperties(source) === null) return false

          ranges.push(
            Decoration.replace({ widget: new PropertiesWidget(source), block: true }).range(
              span.from,
              span.to,
            ),
          )
          return false
        }

        case 'FencedCode': {
          // Recorded before the language is looked at, because the language is
          // what decides whether this is drawn - and a language typed into a
          // plain fence is letters, which `onlyProse` below reads as prose and
          // maps past. Without a span here the fence lost its diagram *and* its
          // code styling, and stayed that way until something else rebuilt.
          if (!standsAlone(state, node.from)) return true
          const span = found(node.from, node.to)

          const language = fenceLanguage(state, node.node)
          if (!RENDERED_LANGUAGES.has(language)) return false
          if (revealed(node.from, node.to)) return false

          const code = fenceCode(state, node.node)

          // A chart fence with no chart in it stays code, which is how nib says
          // it could not read one. Asked here rather than inside the widget so
          // the fence keeps its colouring instead of becoming an empty box.
          if (language === 'chart' && readChart(code) === null) return false

          // And a query fence stays code wherever there is no space to search: the
          // editor on its own, an export, a page somebody else is reading.
          const index = state.facet(noteIndex)
          if (language === 'query' && !index.query) return false

          ranges.push(
            Decoration.replace({
              widget: widgetFor(language, code, index),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        case 'Paragraph': {
          // `![[Note]]` alone between blank lines shows the note itself. Asked
          // first because such a paragraph is nothing else, and asked of the
          // paragraph rather than of the link inside it: walking into every
          // one-line paragraph of a note to find the link would cost more than
          // every other construct here put together. Anywhere but on a line of
          // its own an embed stays a link, and a picture, a recording or a film
          // is drawn where it stands whichever it is; decorate.ts draws those.
          const embed = embedOfBlock(state, node.from, node.to)
          if (embed && !MEDIA.has(embedKind(embed.target))) {
            const span = found(node.from, node.to)
            if (revealed(node.from, node.to)) return false

            ranges.push(
              Decoration.replace({ widget: embedWidget(state, embed), block: true }).range(
                span.from,
                span.to,
              ),
            )
            return false
          }

          // `[toc]` on its own line renders the document's headings. Anything
          // longer than that cannot be one, and is dismissed without reading
          // the line out of the document at all.
          if (node.to - node.from > TOC_MAX) return false
          const line = doc.lineAt(node.from)
          if (!/\[toc\]/i.test(line.text)) return false

          // Recorded whether or not the line reads as a toc *right now*. A line
          // of `[toc] draft` becomes one by deleting the word after it, and a
          // deletion of letters is prose to `onlyProse` below - so without a span
          // here that edit mapped past and the contents were never drawn.
          spans.push({ from: line.from, to: line.to })
          if (!/^\s*\[toc\]\s*$/i.test(line.text)) return false

          toc = true
          if (lineRevealedAt(node.from)) return false

          ranges.push(
            Decoration.replace({ widget: new TocWidget(headings(state)), block: true }).range(
              line.from,
              line.to,
            ),
          )
          return false
        }

        // A block of the note's own HTML that runs rather than shows: a `<div>` and
        // the `<script>` that fills it in. The same click-to-load card the reading
        // view draws for it, out of the same markup - see html-block.ts - and
        // nothing at all for HTML that only shows something, which goes on through
        // as the markup it is.
        //
        // Here rather than with the inline tags in decorate.ts, which is where the
        // `<iframe>` card is drawn, for one reason: CodeMirror accepts a
        // replacement covering a line break only from a state field, and a block
        // like this is two lines or twenty. It is a whole-line construct like the
        // maths and the diagrams above it, and this is where those live.
        //
        // Only where the app says this document's HTML is markup. What runs, runs
        // in a frame with an opaque origin and never in the app; see markup.ts and
        // web-frame.ts.
        case 'HTMLBlock': {
          if (!standsAlone(state, node.from) || !trustsMarkup(state)) return false

          const card = htmlBlockCard(doc.sliceString(node.from, node.to))
          if (card === null) return false

          const span = found(node.from, node.to)
          if (revealed(node.from, node.to)) return false

          ranges.push(
            Decoration.replace({ widget: new WebEmbedWidget(card), block: true }).range(
              span.from,
              span.to,
            ),
          )
          return false
        }

        case 'Table': {
          // A table with something before its pipes - indented into a list item,
          // or inside a blockquote - is left as source; see `standsAlone`.
          if (!standsAlone(state, node.from)) return true

          // Clicks inside the widget do not move CodeMirror's selection, so the
          // rendered table stays up while its cells are edited. Source only
          // shows while the caret is genuinely in the table's text.
          const span = found(node.from, node.to)
          if (revealed(node.from, node.to)) return true

          ranges.push(
            Decoration.replace({
              widget: new TableWidget(
                doc.sliceString(span.from, span.to),
                span.from,
                span.to,
                !state.readOnly,
              ),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        default:
          // Every construct above occupies whole lines, so only blocks are
          // worth descending into: a paragraph's emphasis, links and code
          // spans cannot hold one, and skipping them is most of the document.
          return node.type.is('Block')
      }
    },
  })

  // Only once the note is parsed to the end is a caret clear of every construct
  // clear for good: until then the block it sits in may still be missing from the
  // tree, which is how a first block longer than the parser's first pass looks.
  const wholeNoteParsed = syntaxTree(state).length === doc.length

  return {
    decorations: Decoration.set(ranges, true),
    spans,
    toc,
    chosen: reveals || (wholeNoteParsed && !crosses(spans, state.selection.ranges)),
  }
}

/** Exposed for tests: the block decorations a state would get. */
export function buildBlockDecorations(state: EditorState): DecorationSet {
  return buildBlocks(state).decorations
}

/** Which widget a drawn fence gets. One place, so the three of them read as the
 *  three kinds they are rather than as a nested question. */
function widgetFor(language: string, code: string, index: NoteIndex) {
  if (language === 'chart') return new ChartWidget(code)
  if (language === 'query') return new QueryWidget(code, index)
  return new DiagramWidget(code, language)
}

/** Whether a selection touches any of the constructs found last time. Only
 *  those care where the caret is - one hides its source while the caret is in
 *  it and shows it again on the way out - so a caret that stays clear of all
 *  of them leaves the decorations exactly as they were. Compared the way
 *  `overlaps` does, edges included. */
function crosses(
  spans: readonly { from: number; to: number }[],
  ranges: readonly SelectionRange[],
) {
  return spans.some((span) =>
    ranges.some((range) => range.from <= span.to && range.to >= span.from),
  )
}

/** Characters no block construct here is made of: not a fence's backtick or
 *  tilde, not a table's bar, not a display equation's dollar, not the brackets
 *  of `[toc]`, and not a line break. Writing these into a line that is not
 *  part of one of those constructs cannot make one, unmake one, or move an end
 *  of one - it can only shift what comes after, which the decorations follow
 *  on their own. Deliberately a short list rather than a list of what to
 *  distrust: anything unaccounted for is looked at properly. */
const PROSE = /^[\p{L}\p{N} ,;'"?]*$/u

/** Whether `transaction` is prose typed clear of every construct found last
 *  time - the ordinary case, and the one worth not walking the note for. */
function onlyProse(transaction: Transaction, value: Blocks): boolean {
  if (value.toc) return false

  const before = transaction.startState
  const changes = transaction.changes
  let ordinary = true

  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (!ordinary) return
    // A line either side, so a change that ends where a construct begins is
    // still looked at properly.
    const from = before.doc.lineAt(fromA).from - 1
    const to = before.doc.lineAt(Math.min(toA, before.doc.length)).to + 1
    if (value.spans.some((span) => from <= span.to && to >= span.from)) ordinary = false
    else if (!PROSE.test(before.doc.sliceString(fromA, toA))) ordinary = false
    else if (!PROSE.test(inserted.toString())) ordinary = false
  })

  return ordinary
}

/** The same spans, where the change left them. */
function mapSpans(spans: readonly { from: number; to: number }[], changes: ChangeDesc) {
  return spans.map((span) => ({
    from: changes.mapPos(span.from, 1),
    to: changes.mapPos(span.to, -1),
  }))
}

/** Whether a facet that decides what is drawn, rather than where the caret is,
 *  has changed. Such a transaction moves neither the document nor the selection,
 *  so it has to say so itself or the shortcuts below would return the old
 *  decorations and the setting would appear to do nothing until the next edit. */
function settingsChanged(transaction: Transaction): boolean {
  const before = transaction.startState
  const after = transaction.state
  return (
    before.facet(noReveal) !== after.facet(noReveal) ||
    before.facet(numberEquations) !== after.facet(numberEquations) ||
    // An embed shows another note, so what that note says decides what is drawn
    // here even though nothing in this document moved.
    before.facet(noteIndex) !== after.facet(noteIndex) ||
    // And whether this note's own HTML is markup, which decides whether a block of
    // it draws its card: a page pasted in or a peer arriving takes the card away
    // again, and neither touches the document or the caret.
    trustChanged(before, after)
  )
}

export const blockDecorations = StateField.define<Blocks>({
  // Nothing revealed on the first build; see `buildBlocks`.
  create: (state) => buildBlocks(state, false),

  update(value, transaction) {
    // Moving the caret is choosing where it goes, and so is writing at it. A
    // transaction that does neither - a setting, or the parse arriving - leaves
    // the caret as unchosen as it found it.
    const chosen = value.chosen || transaction.docChanged || transaction.selection !== undefined

    // Reading mode holds every reveal shut, and equation numbering changes what
    // every display equation says. Either way the transaction changes neither
    // the document nor the selection.
    if (settingsChanged(transaction)) return buildBlocks(transaction.state, chosen)

    // Content from outside - a note being opened, a version restored, a sync
    // arriving - brings a caret with it that nobody chose: whatever the old
    // selection mapped to, which for a note opened from the top is 0. And 0 is
    // the start of the document's first block, so a note beginning with a table,
    // an equation, a diagram or a `[toc]` used to open showing its markdown.
    if (isExternal(transaction)) return buildBlocks(transaction.state, false)

    // The parse of a note just opened finishes in transactions of its own;
    // a block it found late has to be drawn then, not at the next click. Such a
    // transaction rebuilds with `chosen` as it was, or the caret the note opened
    // with would reveal the first block the moment the parse caught up - which
    // for a note longer than the parser's first pass is every time it is opened.
    const reparsed = syntaxTree(transaction.state) !== syntaxTree(transaction.startState)

    // A drag that has just ended. The reveal was held still for as long as the
    // button was down, so this is where it catches up with where the selection
    // finally landed - one settle rather than one per pointer event. Asked
    // before the shortcuts below, because releasing the button moves neither the
    // document nor the caret and every one of them would return the held value.
    const held = transaction.state.field(dragging, false) === true
    if (transaction.startState.field(dragging, false) === true && !held) {
      return buildBlocks(transaction.state, chosen)
    }

    if (!transaction.docChanged && !transaction.selection && !reparsed) return value

    // A selection being dragged out with the pointer. Swapping a rendered block
    // for its source moves the text under the pointer by whole rows, so the next
    // pointer event reads a position on the other side of the block's edge and
    // the reveal changes its mind again - which is the flicker. Nothing about
    // what is drawn changes until the button comes up; see dragging.ts.
    if (held && !transaction.docChanged && !reparsed) {
      return chosen === value.chosen ? value : { ...value, chosen }
    }

    const was = transaction.startState.selection.ranges
    const now = transaction.state.selection.ranges

    if (!transaction.docChanged && !reparsed) {
      if (!crosses(value.spans, was) && !crosses(value.spans, now)) return value
    }

    // Prose typed away from every construct: the same constructs, further
    // along. The parse has to be no further along than the document, or a
    // block it has only just reached would be missed.
    const parsedOn =
      syntaxTree(transaction.state).length - syntaxTree(transaction.startState).length ===
      transaction.state.doc.length - transaction.startState.doc.length
    if (
      transaction.docChanged &&
      parsedOn &&
      !crosses(value.spans, was) &&
      onlyProse(transaction, value)
    ) {
      const spans = mapSpans(value.spans, transaction.changes)
      if (!crosses(spans, now)) {
        return {
          decorations: value.decorations.map(transaction.changes),
          spans,
          toc: false,
          chosen,
        }
      }
    }

    return buildBlocks(transaction.state, chosen)
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
})
