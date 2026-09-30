/** A note read as a deck of slides.
 *
 *  Nothing here is a format of its own. A deck is a note with horizontal rules
 *  in it, which is the convention Obsidian's own Slides plugin settled on, so a
 *  deck written in Nib presents in Obsidian and a deck written in Obsidian
 *  presents here. Everything Nib reads on top of that had to survive being
 *  opened somewhere else, which ruled out most of what the other tools use:
 *
 *  - `---` breaks a slide, and only with a blank line above it. CommonMark
 *    reads a line of dashes under a line of text as the underline of a heading
 *    and says so takes precedence, so a break written without the blank line is
 *    not a break anywhere - and would silently promote the writer's last line to
 *    a heading. Requiring the blank line is what keeps this reader and every
 *    other renderer agreeing about the same file.
 *  - `***` breaks a slide downwards instead of along. It is a thematic break
 *    like `---`, so it draws a rule in any other editor rather than leaving
 *    stray characters on the page, and unlike `--` - which reveal.js and the
 *    Obsidian community plugins use - it can neither render as two hyphens of
 *    text nor turn the line above it into a heading.
 *  - `Note:` at the start of a block hands the rest of the slide to the
 *    presenter. Elsewhere it is a paragraph that reads "Note: ...", which is
 *    what it is.
 *  - A `+` bullet arrives on its own click. `+` is one of CommonMark's three
 *    bullet markers, so the list renders exactly as a `-` list would anywhere
 *    else: the only fragment syntax that leaves no trace at all.
 *
 *  Pure: a string in, slides out. The app, an export and a published page all
 *  read the same deck out of the same note. */

import { Marked, type Token, type Tokens } from 'marked'
import { blockMath, definitionList } from './blocks'
import { BLANK, bodyStart, fenceChange, HORIZONTAL, lines, VERTICAL } from './slide-breaks'

/** How a slide is laid out, read off what it holds rather than off an
 *  annotation nobody could open in another editor. */
export type SlideShape = 'title' | 'picture' | 'prose'

export interface Slide {
  /** Where the slide's markdown begins and ends in the note, so the editor can
   *  put the caret on a slide and presenting can start where the caret is. */
  from: number
  to: number
  /** What the stage shows: the slide's markdown with the notes taken out. */
  markdown: string
  /** What only the presenter reads. Empty when the slide has none. */
  notes: string
  /** Whether the slide continues the one before it downwards. */
  vertical: boolean
  /** Which of the slide's list items wait for a click, as places in the run of
   *  every list item the slide renders. */
  fragments: number[]
  shape: SlideShape
}

/** The line that hands the rest of the slide to the presenter. Both spellings,
 *  because reveal.js reads either. */
const NOTES = /^notes?:[ \t]*/i
const HEADING = /^#{1,6}[ \t]/
/** A slide that is one picture and nothing else: a markdown image, or the
 *  wikilink embed of one. */
const PICTURE = /^!\[[^\]]*\]\([^)]*\)$|^!\[\[[^\]]+\]\]$/

/** Where the note breaks into slides: the offset each break's line starts at,
 *  and whether it goes along or down. */
interface Break {
  from: number
  to: number
  vertical: boolean
}

function breaks(source: string, start: number): Break[] {
  const found: Break[] = []
  let fence: string | null = null
  let blank = true

  for (const line of lines(source, start)) {
    const change = fenceChange(line.text, fence)
    if (change !== undefined) {
      fence = change
      blank = false
      continue
    }

    if (fence) {
      blank = false
      continue
    }

    // The blank line above is what makes a rule a rule rather than the
    // underline of the heading it would otherwise make of the line before it.
    if (blank && (HORIZONTAL.test(line.text) || VERTICAL.test(line.text))) {
      found.push({ from: line.from, to: line.to, vertical: VERTICAL.test(line.text) })
      blank = false
      continue
    }

    blank = BLANK.test(line.text)
  }

  return found
}

/** A slide's own words and the presenter's, told apart. */
function split(markdown: string): { shown: string; notes: string } {
  let fence: string | null = null
  let blank = true

  for (const line of lines(markdown, 0)) {
    const change = fenceChange(line.text, fence)
    if (change !== undefined) {
      fence = change
      blank = false
      continue
    }

    if (!fence && blank && NOTES.test(line.text)) {
      return {
        shown: markdown.slice(0, line.from).trimEnd(),
        notes: markdown.slice(line.from).replace(NOTES, '').trim(),
      }
    }

    blank = !fence && BLANK.test(line.text)
  }

  return { shown: markdown, notes: '' }
}

/** Only headings, so it is a title rather than a page of prose. */
function onlyHeadings(markdown: string): boolean {
  const rows = markdown.split('\n').filter((row) => !BLANK.test(row))
  return rows.length > 0 && rows.every((row) => HEADING.test(row))
}

function shapeOf(markdown: string): SlideShape {
  const body = markdown.trim()
  if (PICTURE.test(body)) return 'picture'
  return onlyHeadings(body) ? 'title' : 'prose'
}

/** Where this module's blocks begin and end.
 *
 *  GFM, plus the two constructs of this package's own that reach past the line
 *  they open on; see blocks.ts. That is the whole of what decides which lines are
 *  list items: a `+ x` line inside a `$$` block is a formula rather than an item
 *  in both this lexer and the renderer's, and everything else the package adds is
 *  inline or one line of its own, which no list boundary depends on.
 *
 *  Its own grammar rather than the renderer's, because the renderer's is reached
 *  through the package's entry point and drags KaTeX, its chemistry pack and the
 *  emoji table in with it - and `isDeck` is asked about every note the editor
 *  shows, which is the one place in the app that must load none of that. */
const blocks = new Marked({ gfm: true, breaks: false })
blocks.use({ extensions: [blockMath, definitionList] })

/** Every list item the slide renders, in the order the renderer emits them.
 *
 *  Read through a lexer rather than off the lines, because a list nested in a
 *  quote emits an item too and its line does not begin with a bullet. Depth
 *  first, which is the order the HTML comes out in: an item's own `<li>` opens
 *  before the list inside it. */
function listItems(markdown: string): Tokens.ListItem[] {
  const found: Tokens.ListItem[] = []

  const walk = (tokens: readonly Token[]) => {
    for (const token of tokens) {
      if (token.type === 'list') {
        for (const item of (token as Tokens.List).items) {
          found.push(item)
          walk(item.tokens)
        }
        continue
      }

      const inside = (token as { tokens?: Token[] }).tokens
      if (inside) walk(inside)
    }
  }

  walk(blocks.lexer(markdown))
  return found
}

/** Which items wait for a click: the ones written with a plus. */
function fragmentsOf(markdown: string): number[] {
  if (!markdown.includes('+')) return []

  return listItems(markdown).flatMap((item, at) => (/^[ \t]*\+/.test(item.raw) ? [at] : []))
}

/** The note as slides. A note with no break in it is one slide, which is what
 *  makes `deckOf(...).length > 1` the whole of the question "is this a deck". */
export function deckOf(source: string): Slide[] {
  const start = bodyStart(source)
  const found = breaks(source, start)

  const slides: Slide[] = []
  let from = start
  let vertical = false

  const take = (to: number, next: boolean) => {
    const raw = source.slice(from, to)
    const { shown, notes } = split(raw)
    const markdown = shown.trim()

    // A break at the very top, or two in a row, leaves nothing between them and
    // nothing is not a slide.
    if (markdown || notes) {
      slides.push({
        from,
        to,
        markdown,
        notes,
        vertical: vertical && slides.length > 0,
        fragments: fragmentsOf(markdown),
        shape: shapeOf(markdown),
      })
    }

    vertical = next
  }

  for (const one of found) {
    take(one.from, one.vertical)
    from = Math.min(one.to + 1, source.length)
  }
  take(source.length, false)

  return slides
}

/** Which slide the offset `at` falls in, so presenting can begin where the
 *  caret is and the editor can step from one slide to the next. Zero for a
 *  place above the first slide. */
export function slideAt(slides: readonly Slide[], at: number): number {
  let found = 0
  for (const [index, slide] of slides.entries()) if (slide.from <= at) found = index

  return found
}
