import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import type { PropertiesMode } from '@nib/markdown/properties'
import { describe, expect, test } from 'vitest'
import { blockDecorations, propertiesMode } from './blocks'
import { ChartWidget, DiagramWidget, MathWidget } from './render'
import { dragFreeze, setDragging } from './dragging'
import { external } from '../external'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function state(doc: string, cursor = 0) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        // The field reads whether a pointer drag is in progress, and a state
        // without it behaves as though none ever is - which is every test here
        // but the drag ones below.
        dragFreeze,
        blockDecorations,
      ],
    }),
  )
}

/** Moving the caret to `to` from `from`, and what the field did about it. */
function afterMove(doc: string, from: number, to: number) {
  const before = state(doc, from)
  const was = before.field(blockDecorations)
  const now = parsed(before.update({ selection: EditorSelection.cursor(to) }).state)
  return { was, is: now.field(blockDecorations) }
}

/** Where the field found something, as text. */
function spans(doc: string, cursor = 0): string[] {
  return state(doc, cursor)
    .field(blockDecorations)
    .spans.map((span) => doc.slice(span.from, span.to))
}

/** The compartment the app holds the answer in; see `modeExtensions` in modes.ts. */
const asked = new Compartment()

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |'
const PROSE = 'one **two** three [four](five) `six`\n\nseven eight nine\n\n'
/** More prose than the parser covers on its way into a note: what it has not
 *  reached lands in transactions of its own, later. */
const FILLER = 'prose with **emphasis** and a [link](x).\n\n'.repeat(200)

describe('block decorations', () => {
  test('records where the constructs that mind the caret are', () => {
    expect(spans(`${PROSE}${TABLE}`)).toEqual([TABLE])
    expect(spans('$$\nx = 1\n$$')).toEqual(['$$\nx = 1\n$$'])
    expect(spans('```mermaid\ngraph TD\n```')).toEqual(['```mermaid\ngraph TD\n```'])
    expect(spans('[toc]')).toEqual(['[toc]'])
  })

  test('prose is not a place the caret changes anything', () => {
    expect(spans(PROSE)).toEqual([])
  })

  test('every fence is a place worth looking at again, whatever its language', () => {
    // A plain fence draws nothing, but the language *decides* whether it draws
    // anything - and a language is letters, which the prose shortcut below maps
    // past. Recording the span is what makes typing `mermaid` into a plain fence
    // reach the walk instead of being read as prose typed nowhere in particular.
    const fence = '```js\nlet x = 1\n```'
    expect(spans(`${PROSE}${fence}`)).toEqual([fence])
  })

  test('a table with something before its pipes is left as source', () => {
    // The widget replaces whole lines and the table model knows nothing of an
    // indent or a quote mark, so writing an edit back would drop the prefix and
    // lift the table out of the list item or blockquote it was in.
    const indented = `- item\n\n  ${TABLE.split('\n').join('\n  ')}\n`
    expect(spans(indented)).toEqual([])
    expect(state(indented).field(blockDecorations).decorations.size).toBe(0)

    const quoted = `> ${TABLE.split('\n').join('\n> ')}\n`
    expect(spans(quoted)).toEqual([])
    expect(state(quoted).field(blockDecorations).decorations.size).toBe(0)
  })

  test('a table of its own still renders', () => {
    expect(state(`${PROSE}${TABLE}`).field(blockDecorations).decorations.size).toBe(1)
  })

  test('an equation or a diagram with something before it is left as source too', () => {
    // The replacement covers whole lines, and neither the equation nor the
    // diagram knows a prefix exists: a quoted `$$` handed `> x` to the renderer
    // as if the marker were part of the maths.
    for (const doc of [
      '> $$\n> x = 1\n> $$\n',
      '- item\n\n  $$\n  x = 1\n  $$\n',
      '> ```mermaid\n> graph TD\n> ```\n',
      '- item\n\n  ```mermaid\n  graph TD\n  ```\n',
    ]) {
      expect(state(doc, doc.length - 1).field(blockDecorations).decorations.size, doc).toBe(0)
    }
  })

  /** The shape a formula is actually typed in, and the one that shipped broken.
   *
   *  `$$…$$` on one line was parsed, decorated and drawn - and drawn empty, because
   *  the formula was read as the text BETWEEN the opening line and the closing line,
   *  which for one line is a range that runs backwards and comes back as nothing. The
   *  block took its room on the page and held no formula. Emil, of a page of lecture
   *  notes written entirely this way: *"I see no formulas with $$ ... the space is
   *  just empty where it should be."*
   *
   *  Asserted as the words the widget was given rather than as a count, because the
   *  count was right the whole time. */
  test('a formula written on one line is handed to the renderer, not an empty string', () => {
    for (const [doc, tex] of [
      ['$$x + y = z$$\n\ntail\n', 'x + y = z'],
      // The shape that always worked, so the fix is not a swap of one for the other.
      ['$$\nx + y = z\n$$\n\ntail\n', 'x + y = z'],
      // A single character, which is where an off-by-two would show.
      ['$$x$$\n\ntail\n', 'x'],
    ] as const) {
      const found = state(doc, doc.length - 1).field(blockDecorations).decorations
      const widgets: string[] = []
      found.between(0, doc.length, (_from, _to, value) => {
        const widget = value.spec.widget as { tex?: string } | undefined
        if (widget && typeof widget.tex === 'string') widgets.push(widget.tex)
      })

      expect(widgets, doc).toEqual([tex])
    }
  })

  test('nothing is revealed by the caret a document opens with', () => {
    // A state is created with a caret at 0 unless someone says otherwise, and 0
    // is the start of the first block - so a note beginning with one of these
    // used to open showing its markdown, every time.
    for (const doc of [
      `${TABLE}\n\ntail\n`,
      '$$\nx = 1\n$$\n\ntail\n',
      '```mermaid\ngraph TD\n```\n\ntail\n',
      '[toc]\n\n# One\n',
    ]) {
      expect(state(doc).field(blockDecorations).decorations.size, doc).toBe(1)
    }
  })

  test('nor by the caret that arrives with a note being opened', () => {
    // Which is the path that matters: the app replaces the whole document for
    // each note, and the caret it maps to is 0 again.
    const opened = parsed(
      state('x\n').update({
        changes: { from: 0, to: 1, insert: `${TABLE}\n\ntail` },
        annotations: external.of(true),
      }).state,
    )

    expect(opened.field(blockDecorations).decorations.size).toBe(1)
  })

  test('nor by the parse of a long note catching up with it', () => {
    // A note longer than the parser's first pass is opened with a partial tree,
    // and the rest of it arrives in transactions that move neither the caret nor
    // the text. The caret is still the one the open left, so a first block drawn
    // on opening has to stay drawn - it used to turn back into markdown as soon
    // as the parse reached the end, on every note over a few thousand letters.
    const long = `${TABLE}\n\n${FILLER}`

    expect(state(long).field(blockDecorations).decorations.size).toBe(1)
  })

  test('nor by a caret a long note is reopened well inside', () => {
    // The caret a note is reopened at is nobody's decision either, and this one
    // is past what the parse reaches on the way in: nothing has been found for it
    // to be clear of, which is not the same as being put clear of everything.
    const long = `${FILLER}${TABLE}\n\ntail\n`
    const inside = long.indexOf('| a')

    expect(state(long, inside).field(blockDecorations).decorations.size).toBe(1)
  })

  test('nor by a transaction that states the caret it already had', () => {
    // A note opens with the folds it asks for, and those go in with
    // `selection: state.selection` beside them so the library keeps a fold the caret
    // would otherwise have covered; see `withFolds` in fold.ts. Carrying the caret is
    // not moving it. Counted as a choice, it left a note whose first block is its
    // front matter, a table, an equation or a `[toc]` opening on the markdown of it -
    // but only when the note also held a callout written shut, which is what puts any
    // folds in at all. It showed in the card over a `[[link]]`, whose editor is built
    // this way every time it opens.
    const doc = `${TABLE}\n\ntail\n`
    const held = state(doc)
    const again = held.update({ selection: held.selection }).state

    expect(again.field(blockDecorations).decorations.size).toBe(1)
  })

  test('but the caret does reveal once it has been put somewhere', () => {
    const doc = `${TABLE}\n\ntail\n`
    const moved = state(doc).update({ selection: EditorSelection.cursor(3) }).state
    expect(moved.field(blockDecorations).decorations.size).toBe(0)
  })

  test('a caret that stays clear of them all rebuilds nothing', () => {
    const doc = `${PROSE}${TABLE}`
    const { was, is } = afterMove(doc, 0, 20)
    expect(is).toBe(was)
  })

  test('a caret arriving in one of them rebuilds', () => {
    const doc = `${PROSE}${TABLE}`
    const { was, is } = afterMove(doc, 0, doc.length - 2)
    expect(is).not.toBe(was)
    expect(is.decorations.size).toBe(0)
  })

  test('a caret leaving one of them rebuilds', () => {
    const doc = `${PROSE}${TABLE}`
    const { was, is } = afterMove(doc, doc.length - 2, 0)
    expect(is).not.toBe(was)
    expect(is.decorations.size).toBe(1)
  })
})

/** Getting into a block that is drawn rather than written.
 *
 *  A rendered block replaces its own source, so the only way to edit one is to
 *  put the caret in it - and every position the replacement covers has to bring
 *  that source back, or the caret is standing somewhere nobody can see it. Worse
 *  than invisible: a replacement is atomic, so from such a position the next
 *  arrow key is thrown clear to the far edge of the block, and the whole thing
 *  has gone by in two presses without ever showing a character of itself.
 *
 *  Which is what a single trailing space after `$$x = 1$$` did. The reveal was
 *  asked of the syntax node, which ends at the closing `$$`; the replacement
 *  covers whole lines, which includes the space after it. Measured in a browser
 *  before the fix, from the line below: one ArrowLeft put the caret on the
 *  formula's line with the formula still drawn over it, and the second threw it
 *  to the line's start, past the lot. Emil: *"if I'm for example at the right of
 *  it and press arrow to the left then it just skips the entire thing."*
 *
 *  So these ask it of every position rather than of a count: a count was right
 *  the whole time. The arrow keys themselves belong to CodeMirror and need a
 *  laid-out browser to run, so what is asserted here is the thing the motion
 *  lands on - which position reveals what. */
describe('a caret put where a block is drawn', () => {
  /** A caret PUT at `at`, rather than a document opened with one there: a caret
   *  nobody chose reveals nothing, which is what `state` alone gives. */
  function caretAt(doc: string, at: number) {
    const parked = state(doc, at === 0 ? doc.length : 0)
    return parsed(parked.update({ selection: EditorSelection.cursor(at) }).state)
  }

  /** What is still drawn over the caret, as the text it stands for. The cover is
   *  passed over: it is inserted above the front matter rather than replacing any
   *  of it, so it stands over nothing. */
  function overCaret(doc: string, at: number): string[] {
    const found: string[] = []
    caretAt(doc, at)
      .field(blockDecorations)
      .decorations.between(0, doc.length, (from, to) => {
        if (from < to && at >= from && at <= to) found.push(doc.slice(from, to))
      })
    return found
  }

  test('the space after a closing $$ is part of the formula, not a hole in it', () => {
    const doc = 'intro\n\n$$x = 1$$ \ntail\n'
    const end = doc.indexOf(' \ntail') + 1
    const now = caretAt(doc, end)

    expect(now.selection.main.head).toBe(end)
    expect(overCaret(doc, end)).toEqual([])
    expect(drawn(now.field(blockDecorations), doc)).toEqual([])
  })

  test('and the formula is drawn again on the way out', () => {
    const doc = 'intro\n\n$$x = 1$$ \ntail\n'
    const end = doc.indexOf(' \ntail') + 1
    const out = parsed(
      caretAt(doc, end).update({ selection: EditorSelection.cursor(doc.indexOf('tail')) }).state,
    )

    expect(out.selection.main.head).toBe(doc.indexOf('tail'))
    expect(drawn(out.field(blockDecorations), doc)).toEqual(['$$x = 1$$ '])
  })

  /** Every block here is drawn by replacing whole lines, so every one of them had
   *  the same hole in it. Walked position by position, because the hole was one
   *  character wide. */
  const blocks: [string, string][] = [
    ['a formula on one line', '$$x = 1$$'],
    ['a formula with a space after it', '$$x = 1$$ '],
    ['a formula with two spaces after it', '$$x = 1$$  '],
    ['a formula on three lines', '$$\nx = 1\n$$'],
    ['a formula with a space after its closing mark', '$$\nx = 1\n$$ '],
    ['a diagram', '```mermaid\ngraph TD\n```'],
    ['a diagram with a space after its fence', '```mermaid\ngraph TD\n``` '],
    ['a table', TABLE],
    ['a table with a space after its last row', `${TABLE} `],
    ['a toc', '[toc]'],
    ['a toc with a space after it', '[toc] '],
  ]

  for (const [what, block] of blocks) {
    test(`${what} shows its source wherever the caret is put in it`, () => {
      const doc = `intro\n\n${block}\n\n# One\n\ntail\n`
      const from = doc.indexOf(block)

      for (let at = from; at <= from + block.length; at++) {
        expect(overCaret(doc, at), `${what} at ${at - from}`).toEqual([])
      }
    })

    test(`${what} is drawn again once the caret is off its lines`, () => {
      const doc = `intro\n\n${block}\n\n# One\n\ntail\n`
      const from = doc.indexOf(block)

      // A caret either side of it, which is where the reveal has to stop: the
      // block is its own lines and nothing further.
      for (const at of [from - 2, doc.indexOf('tail')]) {
        const still = drawn(caretAt(doc, at).field(blockDecorations), doc)
        expect(still, `${what} from ${at}`).toContain(block)
      }
    })
  }
})

/** The other way in, which is the one a person reaches for first. */
describe('a press on a block that is drawn', () => {
  test('a rendered formula hands the press to the editor', () => {
    // CodeMirror treats a widget as opaque unless it says otherwise, and a block
    // widget is the whole row: with nowhere on it to aim at, clicking a formula
    // did nothing at all. Measured in a browser - the press did not even take the
    // focus off the page body.
    expect(new MathWidget('x = 1', true).ignoreEvent()).toBe(false)
  })

  test('so do a diagram and a chart, which hold nothing to press either', () => {
    expect(new DiagramWidget('graph TD', 'mermaid').ignoreEvent()).toBe(false)
    expect(new ChartWidget('a, 1').ignoreEvent()).toBe(false)
  })

  test('inline maths keeps its press: a row of words has somewhere to land', () => {
    expect(new MathWidget('E', false).ignoreEvent()).toBe(true)
  })
})

/** What the field made of typing `insert` at `at`, and what it had before. */
function afterTyping(doc: string, at: number, insert: string, to = at) {
  const before = state(doc, at)
  const was = before.field(blockDecorations)
  const now = parsed(
    before.update({
      changes: { from: at, to, insert },
      selection: { anchor: at + insert.length },
    }).state,
  )
  return { was, is: now.field(blockDecorations), state: now }
}

/** Where the field says a construct is, as text of the state it belongs to. */
function drawn(blocks: { decorations: { between: unknown } }, doc: string): string[] {
  const out: string[] = []
  ;(blocks.decorations as import('@codemirror/view').DecorationSet).between(
    0,
    doc.length,
    (from, to) => {
      out.push(doc.slice(from, to))
    },
  )
  return out
}

describe('prose typed away from every construct', () => {
  const doc = `${PROSE}${TABLE}`

  test('moves the constructs along without looking for them again', () => {
    const { was, is, state: after } = afterTyping(doc, 4, 'word')
    expect(is.spans).not.toBe(was.spans)
    expect(drawn(is, after.doc.toString())).toEqual([TABLE])
  })

  test('a line break is not prose: it is looked at properly', () => {
    const { was, is } = afterTyping(doc, 4, '\n')
    expect(is.spans).not.toEqual(was.spans)
    expect(is.decorations.size).toBe(1)
  })

  test('a bar could make a table row, so it is looked at properly', () => {
    const found = afterTyping(`${PROSE}| a | b |\n| - | - |\n`, 0, '| c |\n')
    expect(found.is.decorations.size).toBe(1)
  })

  test('a construct typed into is rebuilt, not shifted', () => {
    const at = doc.length - 2
    const { is } = afterTyping(doc, at, 'z')
    expect(is.decorations.size).toBe(0)
  })

  test('dollars are not prose either', () => {
    // An unclosed `$$` runs to the end of the note; closing it has to shorten
    // the equation, which only looking again can do.
    const opened = `${PROSE}$$\nx\n\nmore prose after it\n`
    const at = opened.indexOf('\n\nmore')
    const { was, is } = afterTyping(opened, at + 1, '$$\n')
    expect(was.spans[0]?.to).toBe(opened.length)
    expect(is.spans[0]?.to).toBe(at + 3)
  })

  test('a note with a toc is always looked at again: a heading elsewhere changes it', () => {
    const withToc = `[toc]\n\n# One\n\nsome prose here\n`
    const at = withToc.indexOf('# One') + 2
    const { is, state: after } = afterTyping(withToc, at, 'Two ')
    expect(drawn(is, after.doc.toString())).toEqual(['[toc]'])
  })

  test('deleting prose shifts the constructs too', () => {
    const { is, state: after } = afterTyping(doc, 4, '', 8)
    expect(drawn(is, after.doc.toString())).toEqual([TABLE])
  })

  test('a language written into a plain fence is not prose written nowhere', () => {
    // Written by the fence header's own language field, which dispatches the
    // change and leaves the caret where it was - so nothing reveals the block and
    // the diagram is what should appear. `mermaid` is letters, so it read as prose
    // typed far from anything, and the fence lost its diagram and, since the
    // viewport plugin steps aside for one, every other decoration with it.
    const plain = 'intro\n\n```\ngraph TD\n```\n\ntail\n'
    const at = plain.indexOf('```') + 3
    const after = parsed(state(plain).update({ changes: { from: at, insert: 'mermaid' } }).state)

    expect(drawn(after.field(blockDecorations), after.doc.toString())).toEqual([
      '```mermaid\ngraph TD\n```',
    ])
  })

  test('a toc completed by deleting the words after it is drawn', () => {
    // A construct is decided by what remains, not by what moved: deleting `draft`
    // is a prose deletion, and it makes the line a toc. Written the way the search
    // panel's replace-all writes it, with the caret left alone.
    const draft = 'intro\n\n[toc] draft\n\n# One\n'
    const from = draft.indexOf('[toc]') + '[toc]'.length
    const after = parsed(
      state(draft).update({ changes: { from, to: from + ' draft'.length } }).state,
    )

    expect(drawn(after.field(blockDecorations), after.doc.toString())).toEqual(['[toc]'])
  })
})

/** A selection dragged out with the pointer, over a block that is drawn rather
 *  than written.
 *
 *  The reveal and the pointer used to answer each other. A rendered table is not
 *  the height of the three lines of markdown behind it, so the moment the
 *  selection touched it and the source came back, everything from there down
 *  moved by rows - and the next pointer event, read against the new layout,
 *  landed on the other side of the table's edge. That took the selection off the
 *  table again, the table was drawn again, the text moved back, and the two went
 *  round as fast as the events arrived: a table flickering between itself and its
 *  markdown for as long as the button was held.
 *
 *  So that is what these drive: a pointer standing still, and a document position
 *  under it that depends on which of the two states is drawn. */
describe('a selection dragged over a rendered block', () => {
  /** Whether the block is still drawn rather than shown as its source. */
  function shown(state: EditorState): boolean {
    return state.field(blockDecorations).decorations.size > 0
  }

  /** A drag: the button goes down, `events` pointer reads follow, the button
   *  comes up. Each read lands on `inside` while the block is drawn and on
   *  `outside` once its source is showing, which is the loop above.
   *
   *  Answers with what was drawn at every step, and what is drawn once the button
   *  is up. */
  function dragged(doc: string, inside: number, outside: number, events = 6) {
    let now = state(doc, 0).update({ effects: setDragging.of(true) }).state
    const steps = [shown(now)]

    for (let event = 0; event < events; event++) {
      const head = shown(now) ? inside : outside
      now = now.update({
        selection: EditorSelection.range(0, head),
        userEvent: 'select.pointer',
      }).state
      steps.push(shown(now))
    }

    return { steps, settled: shown(now.update({ effects: setDragging.of(false) }).state) }
  }

  const blocks: [string, string][] = [
    ['a table', TABLE],
    ['a display equation', '$$\nx = 1\n$$'],
    ['a diagram', '```mermaid\ngraph TD\n```'],
  ]

  for (const [what, block] of blocks) {
    const doc = `${PROSE}${block}`
    // A read that reaches the block, and one that falls short of it in the prose
    // above - the two positions one point on the screen stood for.
    const inside = PROSE.length + 2
    const outside = 4

    test(`${what} keeps one state for as long as the button is down`, () => {
      expect(new Set(dragged(doc, inside, outside).steps)).toEqual(new Set([true]))
    })

    test(`${what} settles once, on the way up`, () => {
      // Held all the way, so the selection ends where the pointer was rather than
      // where a reflow put it - and then, once, the source comes back.
      expect(dragged(doc, inside, outside).settled).toBe(false)
    })
  }

  test('a caret moved by the keyboard still reveals as it goes', () => {
    // Nothing here is a general freeze: only the pointer holds the reveal, and
    // only while its button is down.
    const doc = `${PROSE}${TABLE}`
    const { is } = afterMove(doc, 0, doc.length - 2)
    expect(is.decorations.size).toBe(0)
  })

  test('a drag interrupted anywhere leaves nothing held', () => {
    // The window losing focus, or the selection being carried off as a drag and
    // drop, ends a drag without a mouseup; dragging.ts listens for both. What
    // matters here is that the release rebuilds however it arrives.
    const doc = `${PROSE}${TABLE}`
    const held = state(doc, 0)
      .update({ effects: setDragging.of(true) })
      .state.update({
        selection: EditorSelection.range(0, doc.length - 2),
        userEvent: 'select.pointer',
      }).state

    expect(held.field(blockDecorations).decorations.size).toBe(1)
    const released = held.update({ effects: setDragging.of(false) }).state
    expect(released.field(blockDecorations).decorations.size).toBe(0)
  })

  test('a note swapped in under a held pointer is still drawn for its reader', () => {
    // Content from outside is not the pointer's doing and does not wait for it: a
    // sync arriving, or a version restored, brings a caret nobody chose, and what
    // it brings has to be drawn rather than left as markdown.
    const held = state('x\n', 0).update({ effects: setDragging.of(true) }).state
    const opened = parsed(
      held.update({
        changes: { from: 0, to: 1, insert: `${TABLE}\n\ntail` },
        annotations: external.of(true),
      }).state,
    )

    expect(opened.field(blockDecorations).decorations.size).toBe(1)
  })
})

/** A note's cover, drawn across the top of it while it is being written.
 *
 *  Not a replacement like everything else here: it stands for two keys of front
 *  matter rather than for a run of the document, so it is inserted before the block
 *  and stays drawn whether or not the metadata is showing its own source. A band of
 *  picture that vanished whenever somebody put the caret in the YAML under it would
 *  be the one thing on the page that flickers. */
describe('a note cover', () => {
  const COVERED = '---\ntitle: Wide\ncover: assets/wide.jpg\n---\n\n# Wide\n\nWords.\n'

  const covers = (doc: string, cursor = 0) => {
    let found = 0
    state(doc, cursor)
      .field(blockDecorations)
      .decorations.between(0, doc.length, (_from, _to, value) => {
        if (value.spec.widget?.constructor.name === 'CoverWidget') found += 1
      })
    return found
  }

  test('is drawn for a note that names one', () => {
    expect(covers(COVERED)).toBe(1)
  })

  test('is not drawn for a note that names none', () => {
    expect(covers('---\ntitle: Wide\n---\n\n# Wide\n')).toBe(0)
  })

  test('stays drawn while the caret is inside the front matter', () => {
    // Which is where the rows give way to the YAML: the properties go, the band
    // stays.
    expect(covers(COVERED, COVERED.indexOf('cover:') + 3)).toBe(1)
  })
})

/** The three answers a reader can give about a note's front matter, asked once in
 *  Settings and read here; see properties.ts in @nib/markdown. */
describe('what the front matter is drawn as', () => {
  const NOTE = '---\ntitle: A note\ntags: [one]\n---\n\n# Head\n'

  const built = (mode: PropertiesMode, cursor = NOTE.length - 1) =>
    parsed(
      EditorState.create({
        doc: NOTE,
        selection: EditorSelection.cursor(cursor),
        extensions: [
          markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
          dragFreeze,
          propertiesMode.of(mode),
          blockDecorations,
        ],
      }),
    ).field(blockDecorations)

  const widgets = (mode: PropertiesMode, cursor?: number) => {
    const names: (string | null)[] = []
    built(mode, cursor).decorations.between(0, NOTE.length, (_from, _to, value) => {
      names.push(value.spec.widget?.constructor.name ?? null)
    })
    return names
  }

  test('is the rows, which is where a note with no answer starts', () => {
    expect(widgets('properties')).toEqual(['PropertiesWidget'])
  })

  test('is the source, always, where the reader asked for the source', () => {
    expect(widgets('source')).toEqual([])
    // And the caret being elsewhere does not bring the rows back.
    expect(widgets('source', 0)).toEqual([])
  })

  test('is nothing at all where the reader asked for nothing', () => {
    // A replacement with no widget in it: the block is still in the file and still
    // read, it is simply not on the page.
    expect(widgets('hidden')).toEqual([null])
  })

  test('and changing the answer redraws without the note or the caret moving', () => {
    const state = parsed(
      EditorState.create({
        doc: NOTE,
        selection: EditorSelection.cursor(NOTE.length - 1),
        extensions: [
          markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
          dragFreeze,
          asked.of(propertiesMode.of('properties')),
          blockDecorations,
        ],
      }),
    )

    expect(state.field(blockDecorations).decorations.size).toBe(1)
    const after = state.update({ effects: asked.reconfigure(propertiesMode.of('hidden')) }).state
    const names: (string | null)[] = []
    after.field(blockDecorations).decorations.between(0, NOTE.length, (_f, _t, value) => {
      names.push(value.spec.widget?.constructor.name ?? null)
    })

    expect(names).toEqual([null])
  })
})
