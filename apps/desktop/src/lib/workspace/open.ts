/** One document per file, and the one place a document is made.
 *
 *  A document is a file's words while it is open (see documents.svelte.ts). Two
 *  documents over one file are two notes wearing one name: each is honest about its
 *  own words, both report theirs as that file's content, and whichever is written
 *  last is what the file ends up saying. Emil, 2026-09-17: *"I switch to a different
 *  note and then for some reason it gets some random useless content."* That is
 *  somebody's writing being replaced by somebody else's, on its way to the disk and
 *  to the account, and it is what this file exists to make unreachable.
 *
 *  Two of everything used to be born the same way every time. Opening a file reads
 *  it, a read is a round trip, and nothing said the file was being opened until the
 *  tab was there - which is after it. So two clicks on one row, a link followed
 *  twice, a note clicked while the session was still coming: each built its own
 *  document, and both survived, because what is open was deduplicated by object
 *  identity and two documents are two objects.
 *
 *  So the open is written down here before the read begins, and a second open of a
 *  path waits for the first rather than starting another.
 *
 *  What is open is not written down at all. The tabs are it: a document is open
 *  while a pane is showing it, and the path it is at is the document's own. That is
 *  what makes a path that changes - a rename, a move, the one tab that previews a
 *  note taking on another, a website being given its first file - move rather than
 *  add: there is no second copy of the fact to update and none to go stale. */

import { isCanvasTarget, isPagesTarget } from '@nib/markdown/links'
import { movedTo, nameOf, samePath, within } from '../space-paths'
import type { DocumentStart, NoteDoc, Tab } from './documents.svelte'
import type { FileOp } from './file-ops'

export class OpenDocuments {
  /** Opens whose file has not come back yet, by the path being opened. The one
   *  piece of state here, and it lives for the length of a round trip. */
  private readonly coming = new Map<string, Promise<NoteDoc | null>>()

  /** Documents an arrangement is being built out of; see `arranging`. */
  private readonly building = new Set<NoteDoc>()
  private arrangements = 0

  constructor(
    /** What is open. A document is open while a pane is showing it. */
    private readonly showing: () => readonly Tab[],
    /** Makes one, wired to the app that holds it; see `document` in
     *  workspace.svelte.ts. Handed in rather than done here, because what a
     *  document reports to and whether saving it is anybody's job are the
     *  workspace's answers, and this file is only about how many there are. */
    private readonly begin: (start: DocumentStart) => NoteDoc,
  ) {}

  /** Every open document, once each however many panes are showing it. */
  get all(): NoteDoc[] {
    const seen = new Set<NoteDoc>()
    for (const tab of this.showing()) seen.add(tab.note)

    return [...seen]
  }

  /** Every file that is spoken for: open, or on its way to being open.
   *
   *  What a name the app is about to hand out has to step aside from, beside the
   *  file list. The list is a listing and a listing is a round trip behind: a file
   *  written a moment ago is a document with a path and not yet a row, and a file
   *  being written this instant is neither. See `freeName` in workspace.svelte.ts,
   *  which is the one numbering every new name in the app goes through. */
  get paths(): Set<string> {
    const out = new Set<string>(this.coming.keys())
    for (const tab of this.showing()) {
      if (tab.note.path !== null) out.add(tab.note.path)
    }
    for (const note of this.building) {
      if (note.path !== null) out.add(note.path)
    }

    return out
  }

  /** The document a file is open as, whichever pane is showing it, however the
   *  path was spelled; see `samePath` in space-paths.ts.
   *
   *  Total rather than the first of several: with one document per file there is
   *  nothing to be first of. `workspace.reload` used to answer with the first match,
   *  so words arriving for a file reached one of the two documents over it and the
   *  other kept its own - dirty, and on its way back over the file at the next
   *  save. */
  at(path: string): NoteDoc | null {
    for (const tab of this.showing()) {
      if (samePath(tab.note.path, path)) return tab.note
    }

    for (const note of this.building) {
      if (samePath(note.path, path)) return note
    }

    return null
  }

  /** The document a session names by key, if it is still open. What makes two panes
   *  that were showing one note show one note again rather than two copies of it;
   *  see `key` in documents.svelte.ts. */
  withKey(key: string): NoteDoc | null {
    for (const tab of this.showing()) {
      if (tab.note.key === key) return tab.note
    }

    for (const note of this.building) {
      if (note.key === key) return note
    }

    return null
  }

  /** The one place a document is made.
   *
   *  A file that is already open answers with the document it is open as. Every
   *  opener asks its own question first - is this canvas open, is this paper open -
   *  and this is the one that cannot be skipped, because it is the only thing
   *  standing between a race and two sets of words under one name. */
  make(start: DocumentStart): NoteDoc {
    const held = start.path === null ? null : this.at(start.path)
    if (held?.kind === start.kind) return held

    const note = this.begin(start)
    if (this.arrangements) this.building.add(note)

    return note
  }

  /** One open of one path at a time, and the document it comes to.
   *
   *  `run` is what the opener does once it has the file: read it, make a document
   *  of it, put it in a tab. It answers the document this open came to, which is
   *  one `make` handed it or one the preview tab took the note on into, and null
   *  for a file that cannot be opened at all.
   *
   *  A path that is already open never runs it: the document is there, and the
   *  opener's own tail brings the pane showing it forward. A path that is already
   *  opening waits for that open and comes back with its document, so two clicks on
   *  one row are one open and one tab. */
  opening(path: string, run: () => Promise<NoteDoc | null>): Promise<NoteDoc | null> {
    const held = this.at(path)
    if (held) return Promise.resolve(held)

    for (const [one, coming] of this.coming) if (samePath(one, path)) return coming

    // Written down before the read begins rather than when it comes back, which is
    // the whole of this: nothing runs between these two lines, so a second open of
    // this path finds the first however closely it follows.
    const opening = this.ran(path, run)
    this.coming.set(path, opening)

    return opening
  }

  private async ran(path: string, run: () => Promise<NoteDoc | null>): Promise<NoteDoc | null> {
    try {
      return await run()
    } finally {
      this.coming.delete(path)
    }
  }

  /** The open documents following a file operation, and the tabs showing them: a
   *  document moves with its file however deep in a folder that moved and wears the
   *  kind its new name says (see `rekind`), a tab's trail walks the new names, and a
   *  tab of something that went goes, through `close`. See workspace/file-ops.ts. */
  follow(op: FileOp, close: (id: string) => void) {
    if (op.op === 'created') return

    if (op.op === 'removed') {
      for (const tab of this.showing()) {
        if (tab.path !== null && within(op.path, tab.path) !== null) close(tab.id)
      }
      return
    }

    for (const note of this.all) {
      const to = note.path === null ? null : movedTo(note.path, op.from, op.to)
      if (to === null) continue

      note.path = to
      note.name = nameOf(to)
      this.rekind(note)
    }

    for (const tab of this.showing()) {
      const trail = tab.trail.map((one) => movedTo(one, op.from, op.to) ?? one)
      if (trail.some((one, at) => one !== tab.trail[at])) tab.trail = trail
    }
  }

  /** A plane renamed across its two kinds, shown as the kind its name says now.
   *
   *  A page note and a canvas are one format - a plane of cards and ink, the page note
   *  with its pages over it - so the same words under the other name are the other
   *  kind. The open document kept the kind it was opened as, and one file is one
   *  document, so the tab went on as a page note named as a canvas and opening the
   *  file again found that same page note. So the words, and whether they are written,
   *  go over to a document of the new kind, and every tab showing the file shows it.
   *
   *  Only between those two. A note's words are no plane: shown as a canvas they are
   *  an empty one, and a stroke on it would write that plane over them. A note renamed
   *  to a plane's name goes on showing its words until it is opened again. */
  private rekind(note: NoteDoc) {
    const path = note.path
    const kind =
      path === null ? null : isPagesTarget(path) ? 'pages' : isCanvasTarget(path) ? 'canvas' : null
    if (path === null || kind === null || kind === note.kind) return
    if (note.kind !== 'canvas' && note.kind !== 'pages') return

    const fresh = this.make({ kind, path, name: note.name, text: note.latest, dirty: note.dirty })
    for (const tab of this.showing()) if (tab.note === note) tab.note = fresh
  }

  /** Runs an arrangement's read with every document it makes held open.
   *
   *  A session is read a note at a time and its tabs go into the window when the
   *  last one lands, so for the length of that read these documents are open and no
   *  pane is showing them. Without this a note clicked in that second finds nothing
   *  showing its file and opens it a second time - and the arrangement, landing a
   *  moment later, keeps both. That is the launch race, and it is the one shape of
   *  this bug a person meets without having to be quick.
   *
   *  Counted rather than a flag: an arrangement reads its panes one after another,
   *  and a document made for the first pane has to still be open when the second
   *  asks for it. */
  async arranging<T>(run: () => Promise<T>): Promise<T> {
    this.arrangements++
    try {
      return await run()
    } finally {
      if (--this.arrangements === 0) this.building.clear()
    }
  }
}

/** One tab per web note (Emil, 2026-09-30: *"it should NEVER be possible that we have
 *  the same web note open multiple times"*), the same rule one step on: one document
 *  per file above, and a web note's document in one tab. Asked of the whole strip
 *  whenever it changes, so no way of making a tab is left to forget it. The tab open
 *  already keeps the file; a second becomes an unsaved web tab at the same page. Notes,
 *  planes and page notes may still show twice. See docs/web-tabs.md. */

interface Held {
  kind: string
  path: string | null
  note: object
}

/** Each second tab of `next` over a web note, with the tab that keeps it: one of
 *  `before` where there is one, else the first. */
export function secondWebTabs<T extends Held>(before: readonly T[], next: readonly T[]): [T, T][] {
  const kept = new Map<object, T>()
  const second: [T, T][] = []

  for (const tab of [...before.filter((one) => next.includes(one)), ...next]) {
    if (tab.kind !== 'web' || tab.path === null) continue

    const first = kept.get(tab.note)
    if (!first) kept.set(tab.note, tab)
    else if (first !== tab && !second.some(([one]) => one === tab)) second.push([tab, first])
  }
  return second
}
