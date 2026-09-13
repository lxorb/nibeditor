import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Line, type Range, StateEffect, type Text } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  type WidgetType,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { askingAt, asksMoved } from '../ai/run'
import { concealable, hide, meta } from './conceal'
import { numberEquations } from './blocks'
import { dragging } from './dragging'
import { lineRevealed, noReveal, overlaps, revealed } from './reveal'
import { MathWidget, RENDERED_LANGUAGES } from './render'
import { emojiFor } from '../emoji'
import { HEADING_LEVEL } from '../headings'
import { fenceCaption, fenceCode, fenceLanguage } from '../fence'
import { hrefOf, linkTitle } from '../links'
import { calloutOf } from '@nib/markdown/callouts'
import { readChart } from '@nib/markdown/chart'
import { onEngines } from '@nib/markdown/engines'
import { readHighlight } from '@nib/markdown/highlights'
import { htmlBlockCard } from '@nib/markdown/html-block'
import { blockIdOf, embedKind, linkTarget } from '@nib/markdown/links'
import { readProperties } from '@nib/markdown/properties'
import { type LinkSpan, noteLinkOfNode, wikilinkOfNode } from '../wikilink/at'
import { embedOfBlock, EmbedImageWidget, EmbedMediaWidget } from '../wikilink/embed'
import { noteLinkTitle } from '../wikilink/follow'
import { trustChanged, trustsMarkup } from '../markup'
import { noteIndex, resolves } from '../wikilink/notes'
import { iframeCard, webCard } from '@nib/markdown/web-embed'
import { ImageWidget, imageOfNode, imageRevealed } from './image'
import { WebEmbedWidget } from './web'
import {
  BulletWidget,
  CalloutWidget,
  CheckboxWidget,
  EmojiWidget,
  FenceHeaderWidget,
  PageBreakWidget,
  RuleWidget,
} from './widgets'

/** Nodes whose own lines carry a class, and which one.
 *
 *  A table rather than a pattern per node: the walk asks about every node it
 *  meets, so reading a heading's level off its name with a pattern was the
 *  most-run line in the preview - a thousand-line note spent nearly four thousand
 *  matches a keystroke on it, which a lookup does not. The heading rows are built
 *  from headings.ts rather than written out again, so the one list of heading node
 *  names serves the preview, the table of contents and the block handles. */
const LINE_CLASS: Record<string, string> = {
  Table: 'nib-table',
  FrontMatter: 'nib-frontmatter',
  FootnoteDef: 'nib-footnote',
  DefinitionDetail: 'nib-definition',
  AbbrevDef: 'nib-abbrev',
}

for (const [name, level] of Object.entries(HEADING_LEVEL)) LINE_CLASS[name] = `nib-h${level}`

class Decorator {
  private readonly marks: Range<Decoration>[] = []
  private readonly hidden: Range<Decoration>[] = []
  private readonly lineClasses = new Map<number, Set<string>>()
  /** What a line carries besides its classes, keyed the same way: the code line
   *  numbers and their column width, and the type a callout was written with. */
  private readonly lineAttrs = new Map<number, Record<string, string>>()
  /** Spans already replaced wholesale. Nested syntax inside them must not be
   *  decorated again, or the two replacements would overlap and throw. */
  private readonly claimed: { from: number; to: number }[] = []

  constructor(private readonly state: EditorState) {}

  build(ranges: readonly { from: number; to: number }[]) {
    for (const { from, to } of ranges) {
      syntaxTree(this.state).iterate({ from, to, enter: (node) => this.visit(node.node) })
    }

    // After the walk, because whether a line is code is settled by it.
    for (const { from, to } of ranges) this.blockNames(from, to)

    const lines: Range<Decoration>[] = []
    for (const [pos, classes] of this.lineClasses) {
      const attributes = this.lineAttrs.get(pos)
      const className = [...classes].join(' ')
      lines.push(
        Decoration.line(attributes ? { class: className, attributes } : { class: className }).range(
          pos,
        ),
      )
    }

    return {
      decorations: Decoration.set([...lines, ...this.marks, ...this.hidden], true),
      // Only concealed text is atomic, so the caret steps over hidden syntax
      // instead of landing inside it. Visible marks stay freely editable.
      atomic: Decoration.set(this.hidden, true),
    }
  }

  /** Whether the walk should go on into this node's children. False for a node
   *  that was replaced wholesale: the syntax inside it is part of what the
   *  replacement stands for, and decorating it again would overlap. */
  private visit(node: SyntaxNode): boolean {
    const name = node.name

    // Front matter drawn as rows is a block replacement, which only a state
    // field may provide - see blocks.ts. Step aside so nothing decorates the
    // lines underneath it; a block whose shape cannot be read is still source,
    // and source is styled here.
    if (
      name === 'FrontMatter' &&
      !overlaps(this.state, node.from, node.to) &&
      readProperties(this.state.doc.sliceString(node.from, node.to)) !== null
    ) {
      return false
    }

    const lineClass = LINE_CLASS[name]
    if (lineClass) {
      this.markLines(node, lineClass)
      return true
    }

    switch (name) {
      case 'Blockquote':
        this.blockquote(node)
        return true
      case 'FencedCode':
        return this.fence(node)
      case 'CodeBlock':
        // Indented code: every line of it is code, so every line is numbered,
        // and its own first line is where the numbering starts again.
        this.markLines(node, 'nib-code')
        this.numberLines(node.from, node.to, false)
        return true
      case 'ListItem':
        this.markLines(node, 'nib-li', true)
        return true
      case 'HeaderMark':
      case 'QuoteMark':
        // Block marks follow the caret's line, and swallow the space after them
        // so hiding `# ` does not indent the heading by one column.
        this.conceal(node.from, this.eatSpace(node.to), lineRevealed(this.state, node.from))
        return true
      case 'CodeMark':
        // Both of a fence's ``` show together whenever the caret is anywhere in
        // the block, so its extent is never in doubt while it is being edited.
        // Inline backticks follow their own span.
        this.conceal(node.from, node.to, revealed(this.state, node))
        return true
      case 'ListMark':
        this.listMark(node)
        return true
      case 'TaskMarker':
        this.taskMarker(node)
        return true
      case 'HorizontalRule':
        // Where a deck breaks into its next slide. The line is marked either way
        // and the stylesheet shows the mark only while the note is a deck, so
        // nothing about an ordinary note changes. Two lines read, not a scan.
        if (this.slideBreak(node)) this.markLines(node, 'nib-slide-break', true)
        this.inlineWidget(node, new RuleWidget(), lineRevealed(this.state, node.from))
        return true
      case 'Image':
        return this.image(node)
      case 'HTMLTag':
      case 'HTMLBlock':
        return this.htmlImage(node)
      case 'Comment':
      case 'CommentBlock':
      case 'PercentComment':
        // A note to the writer rather than to the reader. Hidden here the way it
        // is hidden in the reading view, in every export and on a published page
        // - see `withoutComments` in @nib/markdown - and shown again the moment
        // the caret is inside it, so it stays as editable as anything else.
        this.conceal(node.from, node.to, overlaps(this.state, node.from, node.to))
        return false
      case 'Emoji':
        return this.emoji(node)
      case 'InlineMath':
        return this.inlineMath(node)
      case 'BlockMath':
        return this.blockMath(node)
      case 'CodeInfo':
        // Shown alongside the fences it belongs to, not on its own schedule.
        this.conceal(node.from, node.to, revealed(this.state, node))
        return true
      case 'Escape':
        // `\*` is a marker saying the next character is a character. The
        // backslash is syntax like any other, so it goes the way `*` does and
        // comes back when the caret is on it. What is escaped stays: only the
        // first of the two characters is hidden. A page pasted into a note
        // writes its tags this way - see `from-html` in @nib/markdown - and
        // reading it back with a backslash in front of every one of them is
        // reading the markup rather than the words.
        this.conceal(node.from, node.from + 1, overlaps(this.state, node.from, node.to))
        return true
      case 'TableDelimiter':
        this.tableDelimiter(node)
        return true
      case 'InlineCode':
        // The mono face alone is a weak signal at this size, so inline code
        // gets the same box the exported HTML gives it. Pushed before the walk
        // reaches the backticks inside, which conceal themselves as usual.
        this.marks.push(Decoration.mark({ class: 'nib-inline-code' }).range(node.from, node.to))
        return true
      case 'Link':
        this.link(node)
        return true
      case 'Wikilink':
        return this.wikilink(node)
      case 'URL':
        if (concealable(node)) this.conceal(node.from, node.to, revealed(this.state, node))
        // A bare address, or one between the `<` `>` of an autolink: shown as
        // itself, and it is the link.
        else this.linkText(node.from, node.to, this.state.doc.sliceString(node.from, node.to))
        return true
      case 'Highlight':
        this.highlight(node)
        return true
      case 'Subscript':
        this.marks.push(Decoration.mark({ class: 'nib-sub' }).range(node.from, node.to))
        return true
      case 'Superscript':
        this.marks.push(Decoration.mark({ class: 'nib-sup' }).range(node.from, node.to))
        return true
      default:
        if (concealable(node)) this.conceal(node.from, node.to, revealed(this.state, node))
        return true
    }
  }

  /** The label of `[label](target)` reads as a link: coloured, underlined, and
   *  the target in its tooltip, which a modifier-click follows (see links.ts).
   *  The marks around it conceal themselves as usual on the walk below.
   *
   *  A target that names a note in the space rather than a page on the web is a
   *  link between notes, and reads as one: `[the plan](ideas/Plan.md)` follows
   *  and previews exactly as `[[ideas/Plan]]` does. */
  private link(node: SyntaxNode) {
    const open = node.firstChild
    const close = open?.nextSibling
    if (!open || !close || open.name !== 'LinkMark' || close.name !== 'LinkMark') return

    const note = noteLinkOfNode(this.state, node)
    if (note) {
      this.noteLink(note, open.to, close.from)
      return
    }

    const url = node.getChild('URL')
    const target = url ? this.state.doc.sliceString(url.from, url.to) : ''
    this.linkText(open.to, close.from, target)
  }

  /** `[[Note]]` reads as a link to the note, with its brackets - and the target
   *  of an aliased link - concealed like any other syntax.
   *
   *  An embed alone on its line is drawn as the note's content instead, by
   *  blocks.ts; inline, or while the caret is inside it, it stays a link, so the
   *  markup is always reachable. */
  private wikilink(node: SyntaxNode): boolean {
    const link = wikilinkOfNode(this.state, node)
    if (!link) return true

    const shown = overlaps(this.state, node.from, node.to)

    if (link.embed && !shown) {
      // A picture, a recording and a film are what they are wherever they are
      // written; a note and a document are drawn by blocks.ts, and only when
      // they have a line to themselves.
      const kind = embedKind(link.target)
      if (kind === 'image') {
        this.inlineWidget(node, new EmbedImageWidget(link), false)
        return false
      }
      if (kind === 'audio' || kind === 'video') {
        this.inlineWidget(node, new EmbedMediaWidget(link, kind), false)
        return false
      }
      // Its own marks are part of what blocks.ts replaces.
      if (embedOfBlock(this.state, node.from, node.to)) return false
    }

    const open = node.firstChild
    const close = open?.nextSibling
    if (!open || !close) return true

    this.conceal(open.from, open.to, shown)
    this.conceal(close.from, close.to, shown)
    this.noteLink(link, open.to, close.from)

    // Its marks are decorated here; the walk has nothing left to visit.
    return false
  }

  /** A link to another note, however it was written. Coloured like any link,
   *  muted when the space holds no such note - a click on that one makes it -
   *  and marked `data-note` so follow.ts and the hover preview know what it is. */
  private noteLink(link: LinkSpan, from: number, to: number) {
    if (from >= to) return

    const missing = !resolves(this.state.facet(noteIndex), link, link.kind)
    this.marks.push(
      Decoration.mark({
        class: missing ? 'nib-link nib-link-missing' : 'nib-link',
        attributes: { 'data-note': linkTarget(link), title: noteLinkTitle(link, missing) },
      }).range(from, to),
    )
  }

  private linkText(from: number, to: number, target: string) {
    if (from >= to) return
    // A target the browser cannot follow - a relative path, a `#heading` -
    // still reads as a link, but carries no `data-href` for links.ts to open.
    const href = hrefOf(target)
    const spec = href
      ? { class: 'nib-link', attributes: { 'data-href': href, title: linkTitle(href) } }
      : { class: 'nib-link' }
    this.marks.push(Decoration.mark(spec).range(from, to))
  }

  /** Lines whose text is not prose, and where a `^word` at the end is therefore
   *  a `^word` and not the name of a block. */
  private static readonly VERBATIM = ['nib-code', 'nib-frontmatter', 'nib-math-source']

  /** `^abc123` at the end of a line names the block, so a link can point at it.
   *  It is a marker rather than a word, so it hides like any other syntax and
   *  comes back while the caret is on its line.
   *
   *  Read off the lines rather than out of the tree, because the parser has no
   *  node for it: it is Obsidian's construct, not markdown's. Only the visible
   *  lines are looked at, which is what the caller hands over. */
  private blockNames(from: number, to: number) {
    const doc = this.state.doc

    for (const line of linesBetween(doc, from, to)) {
      const classes = this.lineClasses.get(line.from)
      if (classes && Decorator.VERBATIM.some((one) => classes.has(one))) continue

      const id = blockIdOf(line.text)
      if (!id) continue

      const end = line.from + line.text.trimEnd().length
      const caret = end - id.length - 1
      const before = doc.sliceString(caret - 1, caret)
      const start = before === ' ' || before === '\t' ? caret - 1 : caret

      this.conceal(start, end, lineRevealed(this.state, line.from))
    }
  }

  private isClaimed(from: number, to: number): boolean {
    return this.claimed.some((range) => from >= range.from && to <= range.to)
  }

  /** Hidden when inactive; tagged `.md-meta` when shown so it bleeds back in. */
  private conceal(from: number, to: number, show: boolean) {
    if (from >= to || this.isClaimed(from, to)) return
    if (show) this.marks.push(meta.range(from, to))
    else this.hidden.push(hide.range(from, to))
  }

  /** `==🔴 careful==` reads as the words, washed in the colour it named.
   *
   *  The emoji is the colour, not a word of the note, so it goes the way the `==`
   *  around it goes: hidden until the caret is inside, and atomic while it is
   *  hidden so the caret steps over it rather than into it. The `==` themselves
   *  are `HighlightMark` nodes and conceal themselves on the walk below.
   *
   *  A highlight with no colour of its own is left entirely to the syntax theme,
   *  which is what has always drawn it - and which is also what draws it in source
   *  mode, where there is no preview at all. */
  private highlight(node: SyntaxNode) {
    const open = node.firstChild
    const close = node.lastChild
    if (!open || !close || open.name !== 'HighlightMark' || close.name !== 'HighlightMark') return

    const inner = this.state.doc.sliceString(open.to, close.from)
    const { colour, from } = readHighlight(inner)
    if (colour.className === '') return

    this.marks.push(
      Decoration.mark({ class: `nib-mark ${colour.className}` }).range(node.from, node.to),
    )
    this.conceal(open.to, open.to + from, overlaps(this.state, node.from, node.to))
  }

  private inlineWidget(node: SyntaxNode, widget: WidgetType, show: boolean) {
    if (show || node.from >= node.to || this.isClaimed(node.from, node.to)) return
    this.hidden.push(Decoration.replace({ widget }).range(node.from, node.to))
  }

  private blockquote(node: SyntaxNode) {
    this.markLines(node, 'nib-quote')

    const first = this.state.doc.lineAt(node.from)
    // The quote marks are the editor's own to take off; what is left is the
    // line as `calloutOf` reads it everywhere else. See @nib/markdown/callouts.
    const opened = first.text.indexOf('[!')
    const found = opened < 0 ? null : calloutOf(first.text.slice(opened))
    if (!found) return

    // Every line needs the look, not just the header, so the accent runs the
    // full height of the callout. The type as written rides along as an
    // attribute, so a theme can dress a type nib has never heard of.
    this.markLines(node, 'nib-callout')
    if (found.look) this.markLines(node, `nib-callout-${found.look}`)
    this.markLines(node, '', false, { 'data-callout': found.type })

    const from = first.from + opened
    // The fold sign belongs to the marker: it says how the callout opens, and
    // it is not a word of the note.
    const to = first.from + first.text.indexOf(']', opened) + 1 + (found.foldable ? 1 : 0)

    // `[!NOTE]` also parses as a link label, so claim it before the walk reaches
    // the LinkMarks inside it.
    this.claimed.push({ from, to })

    if (lineRevealed(this.state, first.from)) this.marks.push(meta.range(from, to))
    else {
      // A title of the writer's own is words on the line already, so the widget
      // only carries what is not written down: the icon, and the type's own
      // name where no title was given.
      const widget = new CalloutWidget(found.type, found.look, found.title ? '' : found.label)
      this.hidden.push(Decoration.replace({ widget }).range(from, to))
    }
  }

  private fence(node: SyntaxNode): boolean {
    const language = fenceLanguage(this.state, node)

    // A drawn fence is a block replacement, which only a state field may provide
    // - see blocks.ts. Skip the subtree so nothing double-decorates it. Except
    // for a chart nobody can read, which blocks.ts leaves alone: that one is
    // still code, and code is decorated here.
    const drawn =
      RENDERED_LANGUAGES.has(language) &&
      (language !== 'chart' || readChart(fenceCode(this.state, node)) !== null)
    if (drawn && !overlaps(this.state, node.from, node.to)) return false

    this.markLines(node, 'nib-code')
    const doc = this.state.doc
    const open = doc.lineAt(node.from)
    this.addLineClass(open.from, 'nib-code-open')
    this.addLineClass(doc.lineAt(node.to).from, 'nib-code-close')
    this.numberLines(node.from, node.to, true)

    // The opening line reads as empty once its fence is hidden, which leaves
    // room for what the block is, the language, and a copy button.
    const info = node.getChild('CodeInfo')
    const mark = node.firstChild
    const infoFrom = info ? info.from : (mark?.to ?? open.to)

    this.marks.push(
      Decoration.widget({
        widget: new FenceHeaderWidget(
          language,
          // The caption steps aside while the fence shows its own text: the same
          // words are on the line then, and both would be drawn in one place.
          overlaps(this.state, node.from, node.to) ? '' : fenceCaption(this.state, node),
          infoFrom,
          // The language's own end, not the info string's, so retyping the
          // language leaves the caption after it alone.
          infoFrom + language.length,
          open.from,
          // Only an `ai` fence can be waiting on anything; asked of every fence
          // because the answer is a lookup in a list that is nearly always empty.
          askingAt(this.state, open.from),
        ),
        side: 1,
      }).range(open.to),
    )
    return true
  }

  /** Its own range and not its parent's, unlike a syntax mark: `revealed` looks
   *  at the parent because a mark's construct is what owns it, and maths *is* a
   *  construct - so asking about its parent asked about the whole paragraph, and
   *  a caret anywhere in a paragraph turned every equation in it back to source. */
  private inlineMath(node: SyntaxNode): boolean {
    if (overlaps(this.state, node.from, node.to)) return true

    const tex = this.state.doc.sliceString(node.from + 1, node.to - 1)
    this.inlineWidget(node, new MathWidget(tex, false), false)
    return false
  }

  private blockMath(node: SyntaxNode): boolean {
    if (overlaps(this.state, node.from, node.to)) {
      this.markLines(node, 'nib-math-source')
      return true
    }
    // Rendered by the block state field; see blocks.ts.
    return false
  }

  private listMark(node: SyntaxNode) {
    // A task item renders a checkbox instead, and hides this mark with it.
    if (node.parent?.getChild('Task')) return

    const ordered = /\d/.test(this.state.doc.sliceString(node.from, node.to))
    if (ordered) {
      this.marks.push(Decoration.mark({ class: 'nib-ordered-mark' }).range(node.from, node.to))
      return
    }

    this.inlineWidget(node, new BulletWidget(this.depth(node)), false)
  }

  private taskMarker(node: SyntaxNode) {
    const checked = /x/i.test(this.state.doc.sliceString(node.from, node.to))

    const listMark = node.parent?.parent?.getChild('ListMark')
    if (listMark) this.conceal(listMark.from, this.eatSpace(listMark.to), false)

    this.hidden.push(
      Decoration.replace({ widget: new CheckboxWidget(checked, node.from, node.to) }).range(
        node.from,
        node.to,
      ),
    )

    if (checked) this.addLineClass(this.state.doc.lineAt(node.from).from, 'nib-task-done')
  }

  /** A picture stays a picture while the caret is beside it, or selects it;
   *  only a caret inside the markup shows the markup. image.ts has the rest. */
  private image(node: SyntaxNode): boolean {
    if (imageRevealed(this.state, node.from, node.to)) return true

    const image = imageOfNode(this.state, node)
    if (!image) return true

    // An address a provider answers for is that page, not a picture. Asked here
    // rather than in image.ts because it is the same question the renderer asks:
    // what did the note point at?
    const card = webCard(image.src)
    if (card) {
      this.inlineWidget(node, new WebEmbedWidget(card), false)
      return false
    }

    this.inlineWidget(node, new ImageWidget(image), false)
    // Its marks live inside the replacement now; decorating them would overlap.
    return false
  }

  /** `<u>text</u>` is how markdown underlines, and Ctrl+U writes it. The
   *  pair reads as the underline it means: tags hidden until the caret is
   *  between them, the text between drawn underlined. The parser hands out
   *  each tag on its own, so the closer is looked for among the siblings,
   *  minding nested pairs, and claimed so its own visit leaves it alone. */
  private underline(node: SyntaxNode): boolean {
    if (!/^<u\s*>$/i.test(this.state.doc.sliceString(node.from, node.to))) return false

    let depth = 0
    for (let next = node.nextSibling; next; next = next.nextSibling) {
      if (next.name !== 'HTMLTag') continue
      const tag = this.state.doc.sliceString(next.from, next.to)
      if (/^<u\s*>$/i.test(tag)) depth++
      if (!/^<\/u\s*>$/i.test(tag)) continue
      if (depth > 0) {
        depth--
        continue
      }

      const shown = overlaps(this.state, node.from, next.to)
      this.conceal(node.from, node.to, shown)
      this.conceal(next.from, next.to, shown)
      // Claimed after its own concealment, which the claim would otherwise skip.
      this.claimed.push({ from: next.from, to: next.to })
      if (node.to < next.from) {
        this.marks.push(Decoration.mark({ class: 'nib-underline' }).range(node.to, next.from))
      }
      return true
    }
    return false
  }

  /** Three pieces of HTML get rendered rather than shown: a resized image, which
   *  is how a size is recorded, a page break, which has no markdown form, and an
   *  `<iframe>`, which is a page somewhere else. */
  private htmlImage(node: SyntaxNode): boolean {
    // A closing tag already paired up by its opener.
    if (this.isClaimed(node.from, node.to)) return true
    if (node.name === 'HTMLTag' && this.underline(node)) return true

    const tag = this.state.doc.sliceString(node.from, node.to)

    if (/page-break-(after|before)\s*:\s*always/i.test(tag)) {
      // Its own range, not its parent's: a block-level tag's parent is the
      // whole document, which the caret always overlaps.
      if (overlaps(this.state, node.from, node.to)) return true
      this.inlineWidget(node, new PageBreakWidget(), false)
      return false
    }

    // The same card the reading view and a published page show for it, and the
    // same one a provider's address gets: nothing is fetched until it is pressed.
    // See web-embed.ts.
    const framed = iframeCard(tag)
    if (framed) {
      // Written on a line of its own the tag is one node, closing half and all.
      // Written inside a sentence it is two, and the card stands for both - so
      // the closer is found first, because the caret being in either half is the
      // caret being in the markup.
      const closer = node.name === 'HTMLTag' ? this.closingIframe(node) : null
      if (overlaps(this.state, node.from, closer?.to ?? node.to)) return true

      this.inlineWidget(node, new WebEmbedWidget(framed), false)
      if (closer) {
        this.conceal(closer.from, closer.to, false)
        this.claimed.push({ from: closer.from, to: closer.to })
      }
      return false
    }

    // A block of the note's own HTML that runs rather than shows: the same
    // click-to-load card the reading view draws for it, and only where this
    // document's markup is markup. What runs, runs in a frame with an opaque
    // origin and never in the app; see html-block.ts and web-frame.ts.
    const own = trustsMarkup(this.state) ? htmlBlockCard(tag) : null
    if (own) {
      if (overlaps(this.state, node.from, node.to)) return true

      this.inlineWidget(node, new WebEmbedWidget(own), false)
      return false
    }

    return this.image(node)
  }

  /** The `</iframe>` belonging to an inline `<iframe>`, or null when the note
   *  never wrote one. The next tag along or nothing: a frame inside a frame is
   *  not a thing anybody writes, and a closer further away than that belongs to
   *  something else. */
  private closingIframe(node: SyntaxNode): SyntaxNode | null {
    for (let next = node.nextSibling; next; next = next.nextSibling) {
      if (next.name !== 'HTMLTag') continue
      const tag = this.state.doc.sliceString(next.from, next.to)
      return /^<\/iframe\s*>$/i.test(tag) ? next : null
    }
    return null
  }

  /** Its own range, for the same reason as `inlineMath` above. */
  private emoji(node: SyntaxNode): boolean {
    if (overlaps(this.state, node.from, node.to)) return true

    const shortcode = this.state.doc.sliceString(node.from + 1, node.to - 1)
    const character = emojiFor(shortcode)
    if (!character) return true

    this.inlineWidget(node, new EmojiWidget(character), false)
    return false
  }

  /** Only reached while the caret is in the table's source; blocks.ts renders
   *  the real table otherwise. Dimming the pipes keeps the source readable. */
  private tableDelimiter(node: SyntaxNode) {
    this.marks.push(Decoration.mark({ class: 'nib-table-pipe' }).range(node.from, node.to))
  }

  private eatSpace(pos: number): number {
    const doc = this.state.doc
    const line = doc.lineAt(pos)
    let end = pos
    while (end < line.to && doc.sliceString(end, end + 1) === ' ') end++
    return end
  }

  private depth(node: SyntaxNode): number {
    let depth = 0
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.name === 'BulletList') depth++
    }
    return Math.max(depth - 1, 0)
  }

  private addLineClass(pos: number, className: string) {
    const classes = this.lineClasses.get(pos) ?? new Set<string>()
    classes.add(className)
    this.lineClasses.set(pos, classes)
  }

  private addLineAttrs(pos: number, attrs: Record<string, string>) {
    const carried = this.lineAttrs.get(pos)
    if (carried) Object.assign(carried, attrs)
    else this.lineAttrs.set(pos, { ...attrs })
  }

  /** What line-number mode needs from a code block: which number each of its
   *  lines is, counting from one per block, and how many digits the last of
   *  them has - which is what the gutter is as wide as.
   *
   *  Both are written onto the lines rather than left to a CSS counter, because
   *  only the lines in the viewport are in the DOM: a counter would start again
   *  at one wherever the reader happened to have scrolled to, and could not know
   *  how wide a column the block needs before reaching the end of it. The width
   *  goes on every line of the block, the fences included, so the code keeps one
   *  left edge whether or not the line it is on carries a number.
   *
   *  `fenced` leaves the ``` lines unnumbered: they are the block's markup
   *  rather than code, and the first of them carries the language and the copy
   *  button. Nothing here depends on the mode - only the stylesheet draws any of
   *  it, and only while the mode is on, so turning the numbers on and off
   *  rebuilds no decorations at all. See editor.css in @nib/themes. */
  private numberLines(from: number, to: number, fenced: boolean) {
    const doc = this.state.doc
    const opening = doc.lineAt(from).number
    const closing = doc.lineAt(Math.min(to, doc.length)).number
    const first = fenced ? opening + 1 : opening
    const last = fenced ? closing - 1 : closing
    const digits = String(Math.max(last - first + 1, 1)).length

    for (let number = opening; number <= closing; number++) {
      const line = doc.line(number)
      this.addLineAttrs(line.from, { style: `--code-digits:${digits}` })
      if (number < first || number > last) continue
      this.addLineAttrs(line.from, { 'data-code-number': String(number - first + 1) })
    }
  }

  /** Whether this rule is the one that breaks a deck into its next slide.
   *
   *  The same reading `deckOf` does, so the mark and the deck never disagree: an
   *  unbroken run of hyphens or asterisks, and a blank line above it - which is
   *  what stops CommonMark taking the dashes for the underline of a heading. A
   *  rule of underscores, or one written with spaces between the marks, is an
   *  ordinary rule. See packages/markdown/src/slides.ts. */
  private slideBreak(node: SyntaxNode): boolean {
    const line = this.state.doc.lineAt(node.from)
    if (!/^(?:-{3,}|\*{3,})[ \t]*$/.test(line.text)) return false

    return line.number === 1 || this.state.doc.line(line.number - 1).text.trim() === ''
  }

  /** `firstOnly` keeps a nested list item from restyling its children's lines. */
  private markLines(
    node: SyntaxNode,
    className: string,
    firstOnly = false,
    attrs?: Record<string, string>,
  ) {
    const doc = this.state.doc
    const last = firstOnly ? node.from : Math.min(node.to, doc.length)

    for (const line of linesBetween(doc, node.from, last)) {
      if (className) this.addLineClass(line.from, className)
      if (attrs) this.addLineAttrs(line.from, attrs)
    }
  }
}

/** Every line from `from` to `to`, both ends included.
 *
 *  Written once because two walks here want it, and because the end of it is
 *  where the loop goes wrong: the last line of a document has no newline after it
 *  to step over, so a loop that only watches `to` never finishes. */
function* linesBetween(doc: Text, from: number, to: number): Generator<Line> {
  for (let pos = from; pos <= to;) {
    const line = doc.lineAt(pos)
    yield line
    if (line.to >= doc.length) break
    pos = line.to + 1
  }
}

/** Exposed for tests: builds the same decorations a view would, without a DOM. */
export function buildDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
) {
  return new Decorator(state).build(ranges)
}

/** Said when a library a decoration needs has arrived, so the note is drawn again
 *  with it. The emoji table is the one that needs this: a `:shortcode:` with no table
 *  behind it is left as the characters it was written with and gets no widget at all,
 *  so there is nothing on screen to fill in later the way a formula's box is filled.
 *  See @nib/markdown/engines. */
const enginesLanded = StateEffect.define()

export const livePreviewDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    atomic: DecorationSet
    private readonly stopWaiting: () => void

    constructor(view: EditorView) {
      const built = buildDecorations(view.state, view.visibleRanges)
      this.decorations = built.decorations
      this.atomic = built.atomic
      this.stopWaiting = onEngines(() => view.dispatch({ effects: enginesLanded.of(null) }))
    }

    destroy() {
      this.stopWaiting()
    }

    update(update: ViewUpdate) {
      const held = update.state.field(dragging, false)
      const released = update.startState.field(dragging, false) && !held

      // Selection decides what is revealed, so it rebuilds as often as edits do
      // - except mid-drag, when reflowing the line would move the text out from
      // under the pointer.
      const settled = update.selectionSet && !held
      // A note just opened is parsed a little at a time, and the rest of the
      // tree arrives in updates of its own. Without this the part that was
      // not parsed yet stays raw until something else - a click - rebuilds.
      const reparsed = syntaxTree(update.state) !== syntaxTree(update.startState)
      // Reading mode holds every reveal shut, and it comes on in a transaction
      // that moves neither the document nor the caret - so it has to say so
      // itself, or the syntax around the caret would stay showing.
      // Numbering is here as well as in blocks.ts: an inline `\eqref` resolves to
      // the number a display equation was given, so turning the numbers off has
      // to redraw the references too.
      //
      // The note index belongs here for the same reason: whether a `[[link]]`
      // points at a note that exists is what decides how it is drawn, and the
      // answer changes when a note is saved, made or renamed - none of which
      // touches this document.
      // A question being asked or stopped changes only the glyph on one fence's
      // header, and nothing else in the document; see ai/run.ts.
      const asked = asksMoved(update.startState, update.state)
      const sealed =
        update.startState.facet(noReveal) !== update.state.facet(noReveal) ||
        update.startState.facet(numberEquations) !== update.state.facet(numberEquations) ||
        update.startState.facet(noteIndex) !== update.state.facet(noteIndex) ||
        // Whether the note's own HTML is markup: a paste or a peer arriving takes
        // the card an interactive block draws away again, and puts it back.
        trustChanged(update.startState, update.state)
      const landed = update.transactions.some((one) =>
        one.effects.some((effect) => effect.is(enginesLanded)),
      )
      if (
        update.docChanged ||
        update.viewportChanged ||
        settled ||
        released ||
        reparsed ||
        sealed ||
        asked ||
        landed
      ) {
        const built = buildDecorations(update.view.state, update.view.visibleRanges)
        this.decorations = built.decorations
        this.atomic = built.atomic
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
)
