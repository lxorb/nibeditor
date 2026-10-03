/** What is open, and who is looking at it.
 *
 *  Two things, deliberately apart. A document is a note that is open: its words,
 *  its name, whether they are on the disk yet, and the live text every view of it
 *  shares (see shared.ts in the editor package). A tab is one pane's view of a
 *  document: which pane it is in, where the caret is, how far it is scrolled.
 *
 *  That is what makes the same note in two panes one note. There is one document
 *  and two tabs: typing in either reaches the same words and the note is written
 *  once, while each tab keeps its own caret and its own place in the note. Nothing
 *  has to be kept in step, because there is nothing to keep in step. */

import { type FoldLines, SharedDoc } from '@nib/editor'
import type { Camera } from '../camera'
import { identifier } from '../identifier'
import { t } from '../i18n.svelte'
import { draftName, shownName, TITLE_CHARS } from '../note-name'

/** The name a note nobody has named carries. It is never on screen: such a note
 *  is called after its own first words instead, so a window of drafts is a window
 *  of names rather than a row of Untitleds; see `shown`. It is what a written
 *  session holds for a tab that never had a file, and what tells a draft's first
 *  file to take its name from its words; see drafts.ts. */
export const UNTITLED = 'Untitled'

/** What a tab holds. Almost always a note. The graph of the space is a tab
 *  without one, because a picture of the notes belongs beside them rather than in
 *  a panel; a PDF is a tab without one because a paper someone is reading belongs
 *  in the same place as the notes they are making about it; a canvas is a file of
 *  its own with its own surface, and its words are the JSON in it; a page note is
 *  the same file with pages in it, and the same is true of its words; a website is a
 *  note whose front matter says `url:`, drawn as the page it points at rather than
 *  as the two lines in the file. See docs/web-tabs.md. A terminal is a shell, and its
 *  words are which one and where; see docs/terminal.md. */
export type TabKind = 'note' | 'graph' | 'pdf' | 'canvas' | 'pages' | 'web' | 'terminal'

/** Whether a tab's words are a file's words: a note, a canvas, and a page note,
 *  whose words are the JSON in them.
 *
 *  What the answer decides is every place words cross between a tab and a file:
 *  what is written as the typing pauses, what a tab with no file becomes a file
 *  for, and what a tab that is put back after a restart is filled from. The graph
 *  is drawn from the space and a PDF is read, so neither has words to write down
 *  or to read back.
 *
 *  A website is not one either, and the answer carries more here than anywhere
 *  else: nothing the reader does in the page is an edit, so there is nothing to
 *  write and nothing to keep in step - and a room is only ever opened for a file
 *  whose words are a document, which is why a web tab has no collaboration and
 *  needs no switch to say so. See `workspace.openNotes`. */
export function holdsWords(kind: TabKind): boolean {
  return kind === 'note' || kind === 'canvas' || kind === 'pages'
}

export interface DocumentStart {
  kind: TabKind
  path: string | null
  name: string
  text: string
  dirty: boolean
  /** The note's id on the account, for a file somebody shared on its own: one
   *  note out of their space, which has no file on this machine and never gets
   *  one. Null for everything else, which is almost everything. */
  shared?: string | null
  /** The space a document with no file was opened in, by id; see `home`. */
  home?: string | null
}

export class NoteDoc {
  /** This document within this run of the app. What the session writes down to
   *  say that two panes were showing the same note, so a restart puts them back
   *  on one document rather than on two copies of it. */
  readonly key = identifier()
  readonly kind: TabKind

  path = $state<string | null>(null)
  name = $state('')
  dirty = $state(false)

  /** For a file somebody shared on its own: its id on the account, which is what
   *  names its room.
   *
   *  Such a document has no path, because it has no file here. One note out of
   *  somebody else's space is not something to write into a folder of ours - that
   *  would be a copy, and a copy of a shared note is the one thing sharing is
   *  for not having. Its words live in the room, which every keystroke reaches
   *  and which writes them into the owner's space; see docs/sharing.md. */
  readonly shared: string | null

  /** The live text and the undo history, shared by every view of this note. */
  readonly live: SharedDoc

  /** The words as a string, which is what the app reads: saving, the session,
   *  the outline, an export. A copy of `live`, allowed to lag behind by one
   *  pause in the typing, because turning half a megabyte of rope into a string
   *  costs the same however small the keystroke was. `flush` brings it forward,
   *  and everything that reads the text goes through it first. */
  private words = $state('')
  private behind = false

  /** How many times the words have changed, whoever changed them: a keystroke in
   *  any pane, an undo, a note a sync brought over. What a reader that is not an
   *  editor watches - the reading view - because `words` itself only catches up
   *  when something asks for it, and a pane that is only reading never does. */
  revision = $state(0)
  /** True while text is being put in that leaves the note in step with its file,
   *  which is nothing the app has to be told about; see `replace`. */
  private quiet = false

  /** The space a document with no file was opened in, by id: where it is saved to,
   *  whose search it is in and whose web data its page is built in, kept across a
   *  switch to another space and changed by Move to space. A file's space is the one
   *  holding it; see `spaceOf` in workspace.svelte.ts. */
  home = $state<string | null>(null)

  /** The words the file held when this document took it on, until the first
   *  write of the sitting has kept them as a version. What going back to how a
   *  note was this morning needs: a write is not a version of its own any more,
   *  so the one before the first is. Null once kept, and for a document that has
   *  no file or came back holding words the file never had; see `firstVersion`. */
  private before: string | null

  /** `edited` hears about every change to the words, wherever it came from: a
   *  keystroke in any pane, an undo, a picture dropped in. */
  constructor(start: DocumentStart, edited: (doc: NoteDoc) => void) {
    this.kind = start.kind
    this.shared = start.shared ?? null
    this.home = start.home ?? null
    this.path = start.path
    this.name = start.name
    this.dirty = start.dirty
    this.words = start.text
    this.before = start.path !== null && !start.dirty ? start.text : null
    this.live = new SharedDoc(start.text)
    this.retitle()

    this.live.onChange = () => {
      this.behind = true
      this.revision++
      // Before the quiet return: a note a sync brought over is still a note
      // whose name is its first line.
      this.retitle()
      if (this.quiet) return

      this.dirty = true
      edited(this)
    }
  }

  get text(): string {
    return this.words
  }

  /** The words as the views hold them this moment, for a reader that may not
   *  bring `words` forward: a derivation, which Svelte forbids to write, and so
   *  anything that builds a list of rows. The same pass `flush` makes when the
   *  typing is ahead and nothing when it is not.
   *
   *  A derivation over the rope does not hear the next keystroke, which is what
   *  keeps a list built on opening from being built again on every one. */
  get latest(): string {
    return this.behind ? this.live.text.toString() : this.words
  }

  /** Whether markup has been pasted into this document from outside the app.
   *
   *  Once it has, the HTML in it is not only this person's own writing, so it is
   *  rendered as the characters it is made of rather than run; see trust.ts. It
   *  stays set for the sitting, because a note is rendered whole and there is no
   *  saying which part of it the paste became. */
  pasted = $state(false)

  /** Whether nobody has given this document a name: no file and the placeholder the
   *  openers hand out. A note like that is called after its own first words as they
   *  are typed; a plane or a deck of pages is called Untitled, because what is in one
   *  of those is not words to read a title off. */
  private get unnamed(): boolean {
    return this.path === null && this.name === UNTITLED
  }

  /** The words at the top of an unnamed note: its first heading, else its first
   *  line. Kept in step as the note changes rather than read out of a derived,
   *  because the live rope is not something Svelte watches. Only the top of the
   *  note is looked at, so it costs the same whatever the note weighs, and only
   *  a note with no name of its own pays for it at all. */
  private firstWords = $state<string | null>(null)

  /** The words a name can be read off, for a document that has none: a note's first
   *  heading or line. A plane and a deck of pages hold JSON rather than prose, so there
   *  is nothing to read there and such a tab, and the file it becomes, says Untitled. */
  private get titleWords(): string | null {
    return this.kind === 'note' ? this.firstWords : null
  }

  /** What this document is called wherever it is listed: its tab, a row in the
   *  file list, a menu's heading, the window title.
   *
   *  Its file's name without the extension Nib keeps its own documents under -
   *  or, for a note nobody has named, the words at the top of it, so three drafts
   *  open at once read as three notes rather than three Untitleds. */
  readonly shown = $derived(
    this.unnamed ? (this.titleWords ?? t('Untitled')) : shownName(this.name),
  )

  /** Whether there is nothing in this document yet but white space. Asked of a
   *  draft on each change until it has words, so it reads a fixed slice of the rope
   *  and never the whole: a draft pasted into can be a megabyte on its first change.
   *  See drafts.ts. */
  get blank(): boolean {
    const text = this.live.text
    if (text.length > TITLE_CHARS) return false

    return text.sliceString(0, TITLE_CHARS).trim().length === 0
  }

  /** The words the file held when this document took it on, handed over once: the
   *  first write of a sitting keeps them as a version before it replaces them, and
   *  nothing after it has to. See `write` in saving.svelte.ts. */
  firstVersion(): string | null {
    const before = this.before
    this.before = null
    return before
  }

  /** Reads the note's own title off the top of the rope, for a note that has no
   *  name but that.
   *
   *  A fixed slice of it, never the whole: this runs on every keystroke, and a
   *  note has two ways of being long. Walking it by lines is bounded against one
   *  of them and not the other - a page pasted out of a browser arrives as a
   *  single line of a hundred thousand characters, and the first line is the one
   *  line a title is always read from. Asking the rope for a length is the only
   *  read here that cannot grow with the note. See TITLE_CHARS. */
  private retitle() {
    if (!this.unnamed) return

    this.firstWords = draftName(this.live.text.sliceString(0, TITLE_CHARS).split('\n'))
  }

  /** Brings the words up to what the views hold. Costs one pass over the note,
   *  and nothing at all when there is nothing waiting. */
  flush() {
    if (!this.behind) return

    this.behind = false
    const text = this.live.text.toString()
    if (this.words !== text) this.words = text
  }

  /** Text put into the note from somewhere other than the editor: a version
   *  restored, a note a sync brought over, a rename that rewrote the title. It
   *  reaches every pane showing this note.
   *
   *  `dirty` says whether this leaves the note out of step with its file. A
   *  version restored does and has to be written; a note re-read from disk does
   *  not, and text that matches the file is nothing to tell the app about.
   *
   *  `changed` is what turns the words `from` into `text`, from a writer that knows:
   *  a plane; see canvas/written.ts. Taken only while these are still those words. */
  replace(
    text: string,
    dirty = true,
    changed?: { from: string; changes: readonly { from: number; to: number; insert: string }[] },
  ) {
    this.quiet = !dirty
    const known = changed && !this.behind && this.words === changed.from
    // Whether this is a step for undo to stop at is the same question as whether it
    // leaves the note out of step with its file. A version put back is somebody
    // asking for it and has to be undoable; a note re-read from disk is not, and a
    // Ctrl+Z that put the old file back would be an edit the app invented.
    this.live.replace(text, dirty, known ? changed.changes : undefined)
    this.quiet = false

    this.words = text
    this.behind = false
    this.dirty = dirty
    // A note re-read from its file: that is what the file holds now, where the
    // version the first write keeps has not been taken yet.
    if (!dirty && this.before !== null) this.before = text
  }

  /** Words changed under the note by something other than an editor, as the
   *  ranges that changed: a replacement across the space, and putting one
   *  back. The file is written in the same breath, so this leaves the note
   *  clean, and every pane showing it keeps its caret. */
  edited(changes: readonly { from: number; to: number; insert: string }[], text: string) {
    this.quiet = true
    this.live.edit(changes)
    this.quiet = false

    this.words = text
    this.behind = false
    this.dirty = false
    if (this.before !== null) this.before = text
  }

  /** The one tab that previews a note, moving on to another one.
   *
   *  The document takes the new note on rather than being swapped for another,
   *  because a preview is never open in a second pane: nothing else is looking
   *  at these words, and the view stays where it is with the new text in it.
   *
   *  "Never" is a promise somebody has to keep, and `open` in workspace.svelte.ts
   *  is where it is kept: a preview whose document a second tab is also showing is
   *  not reused, because taking a note on here would move that pane to a note
   *  nobody asked it for. A tab reaching a note another pane already has open is
   *  pointed at that document instead; see `walk`. */
  adopt(note: { path: string; name: string; text: string }) {
    this.path = note.path
    this.name = note.name
    this.before = note.text
    this.arrivals++

    // Not `replace`: this document is not being edited, it is being pointed at
    // another note, and the note it came from must not be one step behind the one
    // it is on. `takeOn` gives it a history of its own, empty. See shared.ts.
    this.quiet = true
    this.live.takeOn(note.text)
    this.quiet = false

    this.words = note.text
    this.behind = false
    this.dirty = false
  }

  /** How many notes this document has held. Only the preview ever takes a second
   *  one on, and a pane that keeps an editor state per open note has to be able
   *  to tell "the same note, renamed" from "another note in the same tab": the
   *  first keeps its caret and its place, the second brings its own. */
  arrivals = $state(0)

  /** The words are on disk. `revision` is the revision that went down: writing a
   *  file is a round trip and a keystroke can land inside it, and those words are
   *  on this machine and nowhere else, so a note that moved while its write was
   *  in the air is still out of step with its file. */
  written(path: string, name: string, revision: number) {
    this.path = path
    this.name = name
    this.dirty = this.revision !== revision
    this.before = null
  }
}

export class Tab {
  readonly id = identifier()

  /** The document this tab is a view of, which the tab can be pointed at another
   *  of. Its rune is in the constructor, which is the first place there is a
   *  document to give it, so it is never without one.
   *
   *  It changes for one reason: the tab reaches a file that is already open, and
   *  one file is one document. Walking back along a trail is where that happens -
   *  the note two steps ago may be the note another pane is showing - and the tab
   *  becomes a second view of that document, exactly as opening a note in a second
   *  pane has always done. The alternative is a second document over one file,
   *  which is two notes wearing one name; see workspace/open.ts. */
  note: NoteDoc

  /** Which pane the tab sits in. The pane holds no list of its own: the strip
   *  is the tabs that say they are in it, in the order they were opened. */
  paneId = $state('')

  /** Offset of the caret, pixels scrolled, and the position of the line at the
   *  top, so a note reopens where it was left rather than at the top. The line
   *  is what is put back; the pixels serve sessions from older builds. */
  cursor = $state<number | undefined>(undefined)
  scroll = $state<number | undefined>(undefined)
  anchor = $state<number | undefined>(undefined)
  /** Which line the caret is on. The editor knows it without counting, and the
   *  outline would otherwise walk the note's newlines to work it out again. */
  line = $state<number | undefined>(undefined)
  /** What was folded, as pairs of line numbers; see fold.ts in the editor. Per
   *  tab like the caret, because a note open in two panes may be folded to its
   *  headings in one while the other is deep in a section of it. */
  folds = $state<readonly FoldLines[] | undefined>(undefined)

  /** The notes this tab has shown, oldest first, and where along them it is.
   *
   *  A tab that moves on from one note to another - which is what the tab being
   *  previewed in does all day - leaves a trail, and going back along it shows
   *  the note that was there before. Paths and nothing else: where the caret and
   *  the scroll were is kept per note already, so arriving back at a note arrives
   *  where it was left; see positions.ts.
   *
   *  For the sitting only. A trail is where you have been this afternoon, and a
   *  note in it may not be there tomorrow. */
  trail = $state<readonly string[]>([])
  at = $state(0)

  /** Whether there is anywhere to step, either way. */
  get canGoBack(): boolean {
    return this.at > 0
  }

  get canGoForward(): boolean {
    return this.at < this.trail.length - 1
  }

  /** Whether this tab is held at the front of the strip.
   *
   *  A note somebody keeps open all day - the one they are writing towards, the
   *  one they take notes in - and does not want a click in the file list to take
   *  away. Pinned it stays at the left, wears its mark rather than its name, is
   *  never the tab a preview reuses, and refuses the gestures that close a tab
   *  until it is let go of again. Per tab and not per note, because it is about
   *  this strip in this pane. */
  pinned = $state(false)

  /** Whether this tab is showing the note as it reads rather than as it is
   *  written. Per tab, because a note can be read in one pane while it is being
   *  written in another, and because which face is up is about this sitting with
   *  this note - a note always opens for writing. */
  reading = $state(false)

  /** Whether this tab is holding a place for a note whose words have not come
   *  down yet: a row the account's first pass named and the pass has not fetched.
   *
   *  Per tab rather than per document, because it is about this view of it: the
   *  pane draws the wait instead of an editor, so nobody types into an empty note
   *  that is about to be filled in. Cleared when the body lands; see
   *  `arrived` in workspace.svelte.ts. */
  coming = $state(false)

  /** For a canvas: where the plane is being looked at from. Kept for this
   *  sitting only and not written into the session: a canvas opens framed on
   *  what it holds, which is the right place to start from, and where somebody
   *  panned to belongs to the afternoon rather than to the file. Per tab, since
   *  one canvas can be looked at from two places in two panes. */
  camera = $state<Camera | undefined>(undefined)

  /** For a website: the address the tab is on, which is not always the one its file
   *  says. Following a link in the page is browsing rather than editing, so the
   *  file keeps the address it was written with and the tab keeps where it went.
   *  Per tab, since the same site can be open at two pages in two panes, and
   *  written into the session so a restart comes back on the page it was on. */
  address = $state<string | undefined>(undefined)

  /** For a PDF: the page being read, counting from one, and how far it is zoomed.
   *  Where a note keeps a caret and a scroll, a PDF keeps these, and for the same
   *  reason - reopening it should land where it was left. Per tab, since the same
   *  paper can be read at two places in two panes. */
  page = $state<number | undefined>(undefined)
  zoom = $state<number | undefined>(undefined)

  constructor(note: NoteDoc, paneId: string) {
    this.note = $state(note)
    this.paneId = paneId
  }

  get kind(): TabKind {
    return this.note.kind
  }

  get path(): string | null {
    return this.note.path
  }

  set path(to: string | null) {
    this.note.path = to
  }

  get name(): string {
    return this.note.name
  }

  set name(to: string) {
    this.note.name = to
  }

  /** What the strip, the tooltip and this tab's own menu call it. See
   *  NoteDoc.shown: `name` is the file, this is the document. */
  get shown(): string {
    return this.note.shown
  }

  /** The words, as far as the last flush. See NoteDoc above. */
  get doc(): string {
    return this.note.text
  }

  get dirty(): boolean {
    return this.note.dirty
  }

  set dirty(to: boolean) {
    this.note.dirty = to
  }
}
