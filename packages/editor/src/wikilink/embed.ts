import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { DOCUMENT, PLANE } from '@nib/markdown/icons'
import {
  embedKind,
  embedSize,
  linkTarget,
  pageFragment,
  parseWikilink,
  sectionOf,
} from '@nib/markdown/links'
import { iconElement } from '../icon'
import { imageResolver } from '../images'
import { label } from '../labels'
import { pressedByKey } from '../press'
import { openLightbox } from '../live-preview/image/lightbox'
import { NibWidget } from '../live-preview/widget'
import { renderNote } from './preview'
import type { LinkSpan } from './at'
import { type FileDrawing, jumpFor, noteIndex, noteOpener, resolveFile, resolveLink } from './notes'

/** What `![[…]]` draws: a note inside the note that names it, or a picture.
 *
 *  A note gets a thin frame, its name along the bottom, its content inside, and
 *  a click on the name to open the real thing. Read-only on purpose: what is on
 *  screen belongs to another file, and editing it here would be editing a note
 *  that is not open.
 *
 *  One level deep. The content is rendered without a resolver for the links
 *  inside it, so a `[[…]]` in an embedded note comes out as its own words rather
 *  than as an embed of an embed - which is also what Obsidian does.
 *
 *  A picture is drawn as a picture, plainly: no frame, no handles and no
 *  toolbar. Those belong to `![](…)`, which is the note's own image and the one
 *  a resize may rewrite; this one is a picture that lives somewhere else, and
 *  `![[pic.png|300]]` is how Obsidian says how wide to draw it. */

/** How much of a note an embed shows. Well past any note anyone embeds, and a
 *  ceiling so that pointing an embed at a very large note cannot make the
 *  editor render a megabyte inside a paragraph. */
const MOST_EMBEDDED = 40_000

/** The longest an embed's line can be, so a paragraph is dismissed on its length
 *  before its text is read out of the document at all. */
const EMBED_MAX = 512

/** The embed a block is, when the block is nothing but one: `![[Note]]` on a
 *  line of its own with blank lines around it, which is where Obsidian shows the
 *  note rather than a link to it.
 *
 *  Read from the text rather than from the tree, because blocks.ts asks about a
 *  paragraph it has deliberately not walked into: descending into every
 *  single-line paragraph of a note to look for one would cost more than every
 *  other block construct put together. decorate.ts asks the same question of the
 *  same function, since the two have to agree - one drawing a range the other
 *  also draws is how two decorations come to overlap and throw. */
export function embedOfBlock(state: EditorState, from: number, to: number): LinkSpan | null {
  if (to - from > EMBED_MAX) return null

  const doc = state.doc
  const line = doc.lineAt(from)
  const text = line.text.trim()

  // The block has to be the whole line, whichever node asked: a `Wikilink`
  // leaves the space around it out and a `Paragraph` may take it in.
  if (from !== line.from + (line.text.length - line.text.trimStart().length)) return null
  if (to !== line.from + line.text.trimEnd().length) return null

  const above = line.number > 1 ? doc.line(line.number - 1).text : ''
  const below = line.number < doc.lines ? doc.line(line.number + 1).text : ''
  if (above.trim() !== '' || below.trim() !== '') return null

  if (!text.startsWith('![[') || !text.endsWith(']]')) return null

  const link = parseWikilink(text.slice(3, -2), true)
  return link && { ...link, kind: 'wikilink', from, to }
}

export class EmbedWidget extends NibWidget {
  constructor(
    private readonly link: LinkSpan,
    /** The path the target resolved to, or null when the space has no such
     *  note: an embed of nothing says so rather than showing an empty frame. */
    private readonly path: string | null,
  ) {
    super()
  }

  override eq(other: EmbedWidget) {
    return (
      other.path === this.path &&
      other.link.target === this.link.target &&
      other.link.heading === this.link.heading &&
      other.link.block === this.link.block &&
      other.link.alias === this.link.alias
    )
  }

  toDOM(view: EditorView) {
    const frame = document.createElement('div')
    frame.className = 'nib-embed'

    const body = document.createElement('div')
    body.className = 'nib-embed-body'
    frame.append(body)

    const caption = document.createElement('button')
    caption.className = 'nib-embed-name'
    caption.type = 'button'
    caption.textContent = this.link.alias ?? linkTarget(this.link)
    const open = () => {
      const state = view.state
      state.facet(noteOpener)(jumpFor(state.facet(noteIndex), this.link, this.link.kind))
    }
    caption.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      open()
    })
    pressedByKey(caption, open)
    frame.append(caption)

    const missing = () => {
      frame.classList.remove('nib-embed-loading')
      frame.classList.add('nib-embed-missing')
      body.textContent = label('noteNotFound')
    }

    if (this.path === null) {
      missing()
      return frame
    }

    // The frame is on screen before the note in it has been read, so an embed
    // appears with the keystroke that made it rather than after a round trip.
    frame.classList.add('nib-embed-loading')

    // Asked rather than read: the frame is filled in over two round trips - the
    // note off the disk, then the render - and the editor may have moved on
    // through either of them. A call each time, so that what was true before the
    // first await is not taken as true after the second.
    const showing = () => body.isConnected

    void view.state
      .facet(noteIndex)
      .read(this.path)
      .then(async (source) => {
        if (!showing()) return

        const section = source === null ? null : sectionOf(source, this.link)
        if (section === null) {
          missing()
          return
        }

        // The note's own path, not the open note's: an embed shows another file,
        // and the pictures and links in it point from where that file sits.
        const html = await renderNote(section.slice(0, MOST_EMBEDDED), this.path, view.state)
        if (!showing()) return

        frame.classList.remove('nib-embed-loading')
        body.innerHTML = html
      })
      .catch(() => {
        if (showing()) missing()
      })

    return frame
  }

  /** Clicks inside belong to the embed - the caption opens the note - rather
   *  than to the document behind it. */
  override ignoreEvent() {
    return true
  }
}

/** The widget for one embedded note. An embed of a note the space does not hold
 *  still gets a frame, saying so: the markup is there to be corrected, and an
 *  empty space says nothing. */
export function embedWidget(state: EditorState, link: LinkSpan): EmbedWidget | EmbedFileWidget {
  const index = state.facet(noteIndex)
  const kind = embedKind(link.target)

  // A paper and a plane resolve against the files of the space rather than its
  // notes, the same way a link to one does; see `isTabFile`.
  if (kind === 'pdf' || kind === 'canvas') {
    return new EmbedFileWidget(link, kind, resolveFile(index, link.target, link.kind))
  }

  const path = link.target ? (resolveLink(index, link, link.kind)?.path ?? null) : index.path
  return new EmbedWidget(link, path)
}

export class EmbedImageWidget extends NibWidget {
  constructor(private readonly link: LinkSpan) {
    super()
  }

  override eq(other: EmbedImageWidget) {
    return other.link.target === this.link.target && other.link.alias === this.link.alias
  }

  toDOM(view: EditorView) {
    const picture = document.createElement('img')
    picture.className = 'nib-embed-image'
    picture.draggable = false
    picture.alt = ''

    const size = embedSize(this.link.alias)
    if (size) {
      picture.width = size.width
      if (size.height !== null) picture.height = size.height
    } else if (this.link.alias) {
      // Anything that is not a size is what the picture is of, as in markdown.
      picture.alt = this.link.alias
    }

    picture.addEventListener('dragstart', (event) => event.preventDefault())
    picture.addEventListener('dblclick', (event) => {
      event.preventDefault()
      openLightbox(view, picture.src, picture.alt)
    })

    picture.src = view.state.facet(imageResolver)(this.link.target)
    return picture
  }

  /** The double click is the widget's own; everything else belongs to the text. */
  override ignoreEvent(event: Event) {
    return event.type === 'dblclick'
  }
}

/** What `![[clip.mp3]]` and `![[demo.mp4]]` draw: the player the browser already
 *  has, pointed at the file through the same resolver a picture uses.
 *
 *  Plain, like the picture above it and for the same reason: a player is already
 *  a box with its own furniture, and a frame around one would be furniture around
 *  furniture. Nothing plays until somebody presses play, and `preload` asks only
 *  for the length and the first frame - opening a note should not cost the
 *  recording. That first frame is the poster where the platform gives one, which
 *  is what `metadata` buys and why no poster is written by hand.
 *
 *  The element is given back on the way out: a widget that leaves the document
 *  while it is playing would otherwise go on playing from nowhere. */
export class EmbedMediaWidget extends NibWidget {
  constructor(
    private readonly link: LinkSpan,
    private readonly kind: 'audio' | 'video',
  ) {
    super()
  }

  override eq(other: EmbedMediaWidget) {
    return (
      other.kind === this.kind &&
      other.link.target === this.link.target &&
      other.link.alias === this.link.alias
    )
  }

  toDOM(view: EditorView) {
    const player = document.createElement(this.kind)
    player.className = `nib-embed-media nib-embed-${this.kind}`
    player.controls = true
    player.preload = 'metadata'
    player.draggable = false

    const size = embedSize(this.link.alias)
    if (size && player instanceof HTMLVideoElement) {
      player.width = size.width
      if (size.height !== null) player.height = size.height
    } else if (this.link.alias !== null && size === null) {
      // Anything after the bar that is not a size says what this is. A player has
      // no alt text of its own, so it is the name it hovers under.
      player.title = this.link.alias
    }

    player.addEventListener('dragstart', (event) => event.preventDefault())
    player.src = view.state.facet(imageResolver)(this.link.target)

    this.onDestroy(player, () => {
      player.pause()
      player.removeAttribute('src')
      player.load()
    })

    return player
  }

  /** The controls are the widget's own, all of them. */
  override ignoreEvent() {
    return true
  }
}

/** What `![[paper.pdf#page=3]]` and `![[board.canvas]]` draw: the page of the
 *  paper, or the plane, drawn where the embed stands - over the card that names
 *  the file and opens it.
 *
 *  The card comes first and stays underneath. It is what the markup is on every
 *  surface, including the two that can never draw anything: a published page runs
 *  no script and an exported document has no space behind it to read a paper out
 *  of. So the card is the honest reading everywhere, and the drawing is what the
 *  app adds on top of it where there is a script and a disk. Nothing is lost if
 *  the drawing never comes - no such page, no such file, a paper that turned out
 *  to be broken - because what is left is the card, which is what this used to be
 *  in every case.
 *
 *  The drawing itself is the app's, and arrives through the index's `drawFile`:
 *  pdf.js and the canvas painter both live in the app, and neither could be
 *  reached from here. Read-only, and lazily - the app draws nothing until the card
 *  is scrolled into view - so a note that names thirty papers costs thirty cards
 *  and the pages the reader actually reaches.
 *
 *  The press is unchanged and is the whole card, the drawing included: a click
 *  opens the paper at that page, or the plane, in a tab of its own. What is drawn
 *  here is a page rather than a reader - no scrolling, no selecting, no marks -
 *  and the tab is where the reading happens.
 *
 *  A card for a file the space has not got says so, exactly as an embed of a
 *  missing note does: the markup is there to be corrected. */
export class EmbedFileWidget extends NibWidget {
  constructor(
    private readonly link: LinkSpan,
    private readonly kind: 'pdf' | 'canvas',
    /** Where the file resolved to, or null when the space holds no such file. */
    private readonly path: string | null,
  ) {
    super()
  }

  override eq(other: EmbedFileWidget) {
    return (
      other.kind === this.kind &&
      other.path === this.path &&
      other.link.target === this.link.target &&
      other.link.heading === this.link.heading &&
      other.link.alias === this.link.alias
    )
  }

  /** What this card asks the app to draw in it, or null when there is nothing to
   *  draw: the space holds no such file, so the card stays the name and the click.
   *
   *  The arithmetic on the link and no more, which is the whole of the editor's
   *  side of this and the reason it is a method rather than a line inside `toDOM`:
   *  what is drawn is the app's, but which page of which file is the grammar's, and
   *  the grammar is what this package can be held to. */
  drawing(): FileDrawing | null {
    if (this.path === null) return null

    return {
      kind: this.kind,
      path: this.path,
      // A paper's page is written in the link rather than in the file, and
      // `pageFragment` answers nothing for a fragment that is not a page.
      page: this.kind === 'pdf' ? pageFragment(this.link.heading) : null,
    }
  }

  toDOM(view: EditorView) {
    const card = document.createElement('button')
    card.className = 'nib-embed nib-embed-file'
    card.type = 'button'
    card.dataset.kind = this.kind
    if (this.path === null) card.classList.add('nib-embed-missing')

    card.append(iconElement(this.kind === 'pdf' ? DOCUMENT : PLANE, 'nib-embed-icon'))

    const name = document.createElement('span')
    name.className = 'nib-embed-name'
    name.textContent = this.link.alias ?? linkTarget(this.link)
    card.append(name)

    const open = () => {
      const state = view.state
      state.facet(noteOpener)(jumpFor(state.facet(noteIndex), this.link, this.link.kind))
    }
    card.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      open()
    })
    pressedByKey(card, open)

    // And then the page, or the plane, over the top of it - if the app can draw
    // one. Given the card rather than asked for a picture: the app waits until the
    // reader can see it, measures the column it landed in, and draws at that width.
    const drawing = this.drawing()
    const draw = view.state.facet(noteIndex).drawFile
    if (drawing !== null && draw !== undefined) this.onDestroy(card, draw(card, drawing))

    return card
  }

  /** The click opens the file; nothing else here belongs to the document. */
  override ignoreEvent() {
    return true
  }
}
