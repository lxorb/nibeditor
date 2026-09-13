import { Facet } from '@codemirror/state'
import {
  activateHover,
  closeHoverTooltip,
  type EditorView,
  hoverTooltip,
  type Tooltip,
  type TooltipView,
} from '@codemirror/view'
import { isTabFile, linkTarget, sectionOf } from '@nib/markdown/links'
import { label } from '../labels'
import { modifierHeld } from '../links'
import { type LinkSpan, linkAt } from './at'
import { noteIndex, resolveLink } from './notes'
import { renderNote } from './preview'

/** The note behind a link, while the modifier is held over it - and a place to fix
 *  a word of it without leaving the note you are in.
 *
 *  Held rather than merely hovered because the pointer crosses a link on its way
 *  to anywhere: a popup that opened on its own would keep appearing over the
 *  words being read. It is the same key that turns a click into a jump, so
 *  holding it is already "I mean this link", and the preview is what that shows.
 *
 *  The card is the note, not a picture of it. What the app mounts in it is a small
 *  editor on that note's own words, with the reader's own modes, and what is typed
 *  goes back to the file the way every other write to a note nobody has open does -
 *  a snapshot kept, the words that changed handed to any pane showing the same note
 *  so no caret moves, one thing to undo. Obsidian's hover is editable and this is
 *  why: a typo you can see is a typo you should be able to fix, and opening the note
 *  to fix it loses the sentence you were writing.
 *
 *  So the card has to outlive the pointer. A hover tooltip closes when the pointer
 *  wanders off it, which is right for a glance and wrong for a caret; the moment
 *  something inside it takes focus it is re-opened locked - the same card, because
 *  the host recognises a tooltip by its `create` and leaves that one alone - and from
 *  then on only Escape, focus leaving it, or the note under it changing puts it away.
 *
 *  Only links between notes. A web address has nothing to preview that is not a
 *  page load, and loading a stranger's page because a pointer passed over it is
 *  not something a note editor should do. */

/** How long the pointer rests before the note is read. Long enough that reading
 *  past a link costs nothing, short enough to feel like an answer. */
const DELAY = 300

/** How much of a note the card shows when it is showing rather than holding one.
 *  It is a glance, not the note. */
const MOST_PREVIEWED = 4000

/** How long a note may be and still be written in from a card.
 *
 *  A card is opened by resting a pointer, so it is opened by accident far more often
 *  than on purpose, and building an editor over a novel every time a pointer rests on
 *  a link to one is not a thing this should do. Past this the card is the reading it
 *  always was, which is what a glance wanted anyway. */
const MOST_EDITED = 40_000

/** Where in a note the card opens, and what it holds. */
export interface PreviewNote {
  /** The note's path inside the space - what `read` speaks in, and what the app
   *  writes back to. */
  path: string
  /** Everything the note says. The whole of it and never the part the link named:
   *  what is typed goes back to the file, and a section spliced into a note at an
   *  offset nobody can check is a note rewritten wrong. */
  text: string
  /** Where in those words the link pointed: the heading it named, the block it
   *  named, or the top of the note. */
  at: number
}

/** Mounts an editor on another note's words inside the card that previewed it, and
 *  answers with what takes it down again - or null where the app would rather the
 *  card stayed a reading.
 *
 *  The app's, because neither half of it is the editor's. The modes a reader chose
 *  live in the app, and so does the one path a note is written by. Without it the
 *  card is the reading view's own rendering of the note, which is what an editor
 *  standing on its own can show and what every card was until now. */
export type PreviewMount = (host: HTMLElement, note: PreviewNote) => (() => void) | null

export const previewEditor = Facet.define<PreviewMount, PreviewMount>({
  combine: (values) => values[0] ?? (() => null),
})

/** The card that is up, per view: the `create` it was made with.
 *
 *  Kept because locking the card open means opening it again, and the host keeps the
 *  tooltip whose `create` it already knows rather than building a second one. A fresh
 *  function each time would take the card down and the caret in it with it. */
const shown = new WeakMap<EditorView, { key: string; create: (view: EditorView) => TooltipView }>()

/** Whether the card is being asked for again rather than hovered over.
 *
 *  Locking the card open means opening it again, and by then the modifier the reader
 *  held to open it has been let go of for a while: without this the source would
 *  answer nothing and there would be nothing to lock. True for exactly the one
 *  synchronous call. */
let asking = false

/** Whether the card that is up is locked open, which is what a caret in it does to
 *  it. Read by the hiding rule, because a locked tooltip is still asked: a card being
 *  typed in must not be closed by a transaction in the note underneath, and what
 *  should close it - that note being edited - is the lock's own answer instead. */
let locked = false

export const notePreviews = hoverTooltip(
  (view, pos, side): Tooltip | null => {
    // CodeMirror reports a hover as a position and not as the event behind it,
    // so whether the key is down has to be asked of links.ts, which watches it
    // for the pointer already. One place decides what "held" means.
    if (!modifierHeld() && !asking) return null

    const link = linkAt(view.state, pos)
    if (!link) return null
    // A PDF has no markdown to show in a popover, and rendering its bytes as
    // words would be worse than showing nothing.
    if (isTabFile(link.target)) return null

    const index = view.state.facet(noteIndex)
    const path = link.target ? (resolveLink(index, link, link.kind)?.path ?? null) : index.path

    // The same card for the same link, so that asking for it again is asking for the
    // one on screen; see `shown`.
    const key = `${path ?? ''} ${link.from} ${link.to} ${linkTarget(link)}`
    const held = shown.get(view)
    const create = held?.key === key ? held.create : cardFor(link, path, side < 0 ? -1 : 1)
    shown.set(view, { key, create })

    return { pos: link.from, end: link.to, above: side < 0, create }
  },
  {
    // Gone as soon as the document or the caret moves: a preview is about the link
    // the pointer is on, and typing means the writer has moved on. Unless the card
    // is the thing being typed in, which is the one case where the note underneath
    // is not what changed; see `locked` and the lock below.
    hoverTime: DELAY,
    hideOn: (transaction) => !locked && (transaction.docChanged || !!transaction.selection),
  },
)

/** One card: the link's name, and the note under it.
 *
 *  Returned as the `create` the host will recognise, so everything about this card -
 *  the editor in it, what it has to write back, the listeners that keep it up - lives
 *  for exactly as long as the card does. */
function cardFor(link: LinkSpan, path: string | null, side: -1 | 1) {
  return (view: EditorView): TooltipView => {
    const dom = document.createElement('div')
    dom.className = 'nib-note-preview'

    const name = document.createElement('div')
    name.className = 'nib-note-preview-name'
    name.textContent = linkTarget(link)
    dom.append(name)

    const body = document.createElement('div')
    // The card is a writing surface like every other place a note is read.
    // CodeMirror hangs a tooltip off the editor rather than inside its
    // content, so without the id this sits outside `#write` - the one scope
    // every prose rule in @nib/themes and in a reader's own theme is written
    // against - and a code block in it would arrive with no frame and no
    // colours, a callout with no icon, a table with no rules. Reading.svelte,
    // a slide and the presenter carry it for the same reason.
    body.id = 'write'
    body.className = 'nib-note-preview-body'
    body.textContent = label('loadingNote')
    dom.append(body)

    /** What takes the editor in the card down again, when there is one. */
    let release: (() => void) | null = null

    const close = () => {
      view.dispatch({ effects: closeHoverTooltip(notePreviews) })
    }

    // The caret has arrived in the card, so the card stops being a glance: opened
    // again, locked, which is the library's own way of saying "this one does not
    // close when the pointer moves". The same `create`, so the host keeps this very
    // card and the caret in it stays where it landed.
    dom.addEventListener('focusin', () => {
      if (locked) return
      locked = true
      asking = true
      try {
        // Closes when the note this card was opened from is edited underneath it:
        // the link it stands beside may not be there any more.
        activateHover(view, link.from, side, {
          tooltip: notePreviews,
          until: (transaction) => transaction.docChanged,
        })
      } finally {
        asking = false
      }
    })

    // And leaving it puts it away. Focus moving inside the card is not leaving it,
    // which is what the related target says.
    dom.addEventListener('focusout', (event) => {
      const to = event.relatedTarget
      if (to instanceof Node && dom.contains(to)) return
      close()
    })

    // Escape hands the caret back to the note it came from, which is where the
    // reader was. Only when nothing inside the card wanted the key first - a
    // completion popup in it closes on Escape, and that press was not for this.
    dom.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      view.focus()
      close()
    })

    if (path === null) {
      body.textContent = label('noteNotFound')
      return { dom }
    }

    // Asked rather than read: the card is filled in over two round trips -
    // the note off the disk, then the render or the editor - and the pointer may
    // have moved on through either of them. A call each time, so that what was true
    // before the first await is not taken as true after the second.
    const showing = () => body.isConnected

    void view.state
      .facet(noteIndex)
      .read(path)
      .then(async (source) => {
        if (!showing()) return
        const section = source === null ? null : sectionOf(source, link)
        if (source === null || section === null) {
          body.textContent = label('noteNotFound')
          return
        }

        // Written in where the app can mount an editor and the note is short enough
        // to be worth one. The whole note goes in, opened at the part the link
        // named; see `PreviewNote`.
        if (source.length <= MOST_EDITED) {
          const host = document.createElement('div')
          release = view.state.facet(previewEditor)(host, {
            path,
            text: source,
            at: anchorOf(source, section),
          })

          if (release) {
            body.dataset.written = 'yes'
            body.replaceChildren(host)
            return
          }
        }

        const html = await renderNote(section.slice(0, MOST_PREVIEWED), path, view.state)
        if (showing()) body.innerHTML = html
      })
      .catch(() => {
        if (showing()) body.textContent = label('noteNotFound')
      })

    return {
      dom,
      destroy: () => {
        // Whatever has been typed goes to the file on the way out; see the app's
        // own mount.
        release?.()
        release = null
        locked = false
      },
    }
  }
}

/** Where in the note the card opens: the first line of the part the link named,
 *  found in the note itself, or the top for a link that named the whole of it.
 *
 *  By its first line rather than by the whole section, because the section a block
 *  link names has had the block's own name taken off it and is no longer a slice of
 *  the note. A line nothing matches opens the note at the top, which is the answer a
 *  reader can still read. */
function anchorOf(source: string, section: string): number {
  if (section === source) return 0

  const first = section.split('\n')[0] ?? ''
  const at = first ? source.indexOf(first) : -1
  return at === -1 ? 0 : at
}
