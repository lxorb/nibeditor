/** Writing what is open down.
 *
 *  One rule, and everything here is it: a document with words writes itself. A
 *  note, a canvas and a page note are written a moment after their changes stop,
 *  wherever the file is, and nobody is asked anything - no key to press, no mark
 *  beside a name, no question on the way out. Emil, 2026-09-30: *"I don't want
 *  there to be any manual saving anymore. Only autosaving, that's it."*
 *
 *  A document with no file yet - a new tab - is a draft, and the first words put
 *  in it are what make it a file: where it goes and what it is called are
 *  drafts.ts, and the moment itself is `born` below.
 *
 *  Its own module because its state is its own: which documents are waiting for
 *  the pause, which file operation each is in the middle of, and the timers behind
 *  both. The workspace holds one of these and hands its calls straight through. */

import { flushTableEdits } from '@nib/editor'
import { saveRetryDelay } from '../backoff'
import { flushCardEdits } from '../canvas/writing'
import { t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { log } from '../log'
import { owesLast, settleUp } from '../parting'
import { folderOf, nameOf } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { afterQuiet } from '../timing'
import { entryAt } from '../tree-edits'
import type { Entry } from '../workspace.svelte'
import { holdsWords, type NoteDoc, type Tab } from './documents.svelte'
import { draftFile, followedName, hasWords, isDraft, namedByWords } from './drafts'

/** How long after the last change a document is written, in milliseconds.
 *
 *  Short, because nothing else keeps the words: a window killed a second after the
 *  typing stopped has lost nothing. Still a pause rather than a keystroke, so a
 *  burst of typing - whose gaps are shorter than this - is one write, and what a
 *  write costs is paid per pause and never per character. */
const SAVE_DELAY = 400

/** And the longest the first unwritten change waits while the changes never stop:
 *  somebody typing without a pause for a minute is written every couple of
 *  seconds all the same. */
const SAVE_AT_MOST = 2000

/** Pauses in a row that ended in a refused write before the light says so. One is
 *  a virus scanner holding the file for a moment; three is a file that will not be
 *  written until somebody does something about it. */
const REFUSALS_TOLD = 3

/** What writing needs of the store the documents are open in. */
export interface Writes {
  readonly tabs: Tab[]
  readonly documents: NoteDoc[]
  readonly active: Tab | null
  readonly previewTabId: string | null
  /** The space on screen as the file list holds it: what says whether a note that
   *  nobody is showing still has a file; see `gone`. */
  readonly tree: Entry | null
  keep(id: string): void
  scheduleSession(): void
  persist(): void
  loadTree(): Promise<void>
  /** The folder a draft becomes a file in; see `draftHome` in workspace.svelte.ts. */
  draftHome(): Promise<string | null>
  /** The name a folder will take: the wanted one, or the next number after it where
   *  the folder already holds that name - `except` left out of what it holds. The
   *  rule the file list follows for a duplicate, so a draft never writes over
   *  anything. */
  freeName(folder: string, name: string, except?: string): string
  /** A file renamed because the words it is named after changed: everything a rename
   *  owes, but no step on the undo stack; see `retitle` in workspace.svelte.ts. */
  retitle(path: string, name: string): Promise<void>
  /** A file a draft has just become: its row in the list and a place among the notes
   *  opened lately, before the disk has it. */
  born(path: string): void
  /** A file written over, so a list sorted by when things changed moves it. */
  touched(path: string): void
  /** A note born this sitting that ended up with nothing in it, gone again as its
   *  last tab closes; see `closed`. */
  discard(path: string): Promise<void>
}

export class Saving {
  /** The write that waits for a pause in the changes; see timing.ts. */
  private readonly soon = afterQuiet(() => void this.saveWaiting(), SAVE_DELAY, SAVE_AT_MOST)

  /** Pauses in a row that ended in a refused write. */
  private failures = 0
  private readonly retry = afterQuiet(
    () => void this.saveWaiting(),
    () => saveRetryDelay(this.failures),
  )

  /** Documents waiting to be written when the changes stop. A set rather than one,
   *  because two panes may hold two different notes and both be edited between one
   *  pause and the next. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly waiting = new Set<NoteDoc>()

  /** The file operation each document is in the middle of: a write, a rename, a
   *  birth. One at a time per document, so a rename never lands inside a write and
   *  moves the file out from under it; see `holding`. */
  private readonly busy = new WeakMap<NoteDoc, Promise<void>>()

  /** Every one of those still running, for whoever has to wait for all of them: the
   *  window going, and Ctrl+S. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly running = new Set<Promise<void>>()

  /** Drafts on their way to being files, so a keystroke landing inside the round
   *  trip that finds them a folder does not make a second file. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly bearing = new Set<NoteDoc>()

  /** Born and not written yet: their first write is the one that makes the file, so
   *  it is the one after which the list is read again. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly making = new Set<NoteDoc>()

  constructor(private readonly ws: Writes) {
    // A window closing runs no teardown, so the pause a note is written after never
    // comes. Last of all, because a plane turns itself into its document first and
    // this is what writes the document out. See parting.ts.
    owesLast(() => this.part())

    // Leaving the window - another program, the lid, the screen locking - writes
    // what is waiting now rather than a pause later: a machine going to sleep is a
    // pause that may not end.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('blur', () => this.hurry())
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.hurry()
      })
    }
  }

  /** What is owed when the window goes: the session, and every write that was
   *  waiting for the changes to stop.
   *
   *  The session first and always. It holds which notes are open and the words of
   *  any that are not on the disk yet, it is one synchronous line of storage, and a
   *  page being torn down may not come back from the writes' round trips - so
   *  whichever of the two lands, nothing typed is lost. A launch after a crash puts
   *  those words back and writes them; see `owed`. */
  private part() {
    this.ws.persist()
    this.hurry()
  }

  /** What a document reports whenever it changes, wherever the change came from:
   *  a keystroke in either pane, an undo, a picture dropped in, a stroke on a plane.
   *  Nothing here touches the text - the rope is left as it is and `flush` turns it
   *  into a string at the write - so the cost of a keystroke does not grow with the
   *  size of the note. */
  edited(note: NoteDoc) {
    // Typing in a note you were only previewing is what makes it yours.
    const preview = this.ws.tabs.find((tab) => tab.id === this.ws.previewTabId)
    if (preview?.note === note) this.ws.keep(preview.id)

    this.owed(note)
    // Whatever the write is waiting for, the words themselves are written down.
    this.ws.scheduleSession()
  }

  /** A document whose words are not on its file: one just changed, or one a launch
   *  brought back with words a crash kept from the disk.
   *
   *  A file somebody shared on its own has no file here at all: its room is what
   *  keeps it, and there is nowhere on this machine for a write to go. A draft is
   *  written once it has something in it, which is the moment it becomes a file. */
  owed(note: NoteDoc) {
    if (note.shared !== null || !holdsWords(note.kind)) return

    if (isDraft(note)) {
      if (!hasWords(note)) return

      const birth = this.born(note)
      this.track(birth)
      void birth.catch((error: unknown) =>
        log('error', `save: a new ${note.kind} - ${String(error)}`),
      )
      return
    }

    this.waiting.add(note)
    this.soon()
  }

  /** Brings every open note's words up to what its views hold. Everything that
   *  reads the text of a note calls this first; it costs one pass over the notes
   *  that have been typed in, and nothing at all when none have. */
  flush() {
    for (const note of this.ws.documents) note.flush()
  }

  /** Text put into a note from somewhere other than the editor: a version
   *  restored from the history, a note pulled in by a sync. It reaches every pane
   *  showing that note, since they are all views of the one document. */
  replace(text: string, target?: Tab) {
    const note = (target ?? this.ws.active)?.note
    note?.replace(text)
  }

  /** Everything waiting, written now rather than a pause later: a tab brought
   *  forward or closed, the window left, the window going. Nothing at all when
   *  nothing is waiting, so it is safe to say on every one of those. */
  hurry() {
    if (!this.waiting.size) return

    this.soon.cancel()
    void this.saveWaiting()
  }

  /** A document's last tab has closed. What it was waiting to write goes down now,
   *  and a note born this sitting that says nothing any more goes with its tab: it
   *  was a file only because a draft once had a letter in it, and an empty
   *  `Untitled` left behind by every note somebody changed their mind about is the
   *  litter this whole way of making notes exists to avoid. */
  closed(note: NoteDoc) {
    if (this.ws.tabs.some((tab) => tab.note === note)) return

    const path = note.path
    if (path !== null && note.follows && note.blank) {
      this.waiting.delete(note)
      this.making.delete(note)
      void this.holding(note, () => this.ws.discard(path)).catch((error: unknown) => {
        log('warn', `discard: ${path} - ${String(error)}`)
      })
      return
    }

    this.hurry()
  }

  /** Ctrl+S, `:w`, and a program that wrote into a note and wants it on the disk
   *  before it answers: every write that is owed, done, and waited for. Never a
   *  question and never a file picker.
   *
   *  The note in front is kept as a version too, because pressing the key is the one
   *  thing a hand still says about a note: this is a moment worth going back to. A
   *  version the same as the last is not kept twice; see history.rs. And a note that
   *  was only being previewed is one to stay from here on. */
  async writeNow(): Promise<void> {
    // A table cell and a card on a plane hold their words until they lose focus;
    // make sure they landed. Then everything else that writes on a timer.
    flushTableEdits()
    flushCardEdits()
    settleUp()

    const tab = this.ws.active
    if (tab) this.ws.keep(tab.id)

    await this.settled()

    const path = tab?.path ?? null
    if (tab && path !== null && holdsWords(tab.kind) && !tab.note.dirty) {
      await invoke('snapshot_note', { path, content: tab.note.text }).catch(() => undefined)
    }
  }

  /** Whether anything is waiting to be written or being written now: what decides
   *  whether a window going has anything to wait for. */
  get writing(): boolean {
    return this.waiting.size > 0 || this.running.size > 0
  }

  /** Waits until nothing is waiting and nothing is being written. A few rounds at
   *  most, because a write that lands can leave a keystroke from inside it waiting,
   *  and a window going cannot wait for somebody who is still typing. */
  async settled(): Promise<void> {
    for (let round = 0; round < 4; round++) {
      if (this.waiting.size) await this.saveWaiting()
      if (!this.running.size) return

      await Promise.all(this.running)
    }
  }

  /** Each note on its own: a refused one is queued again, not lost with every
   *  note behind it. */
  private async saveWaiting() {
    const notes = [...this.waiting]
    this.waiting.clear()

    const refused: NoteDoc[] = []
    await Promise.all(
      notes.map((note) =>
        this.write(note).catch((error: unknown) => {
          refused.push(note)
          this.waiting.add(note)
          log('error', `save: ${note.path ?? note.name} - ${String(error)}`)
        }),
      ),
    )

    this.failures = refused.length ? this.failures + 1 : 0
    if (!refused.length) return

    this.retry()
    if (this.failures === REFUSALS_TOLD) await this.tell(refused)
  }

  /** A note the disk keeps refusing, on the light in the corner: the same place a
   *  sync that failed is told, and the same kind of news. The words stay in the
   *  note and in the session, and the writes go on being tried. */
  private async tell(refused: readonly NoteDoc[]) {
    const first = refused[0]
    if (!first) return

    // Imported here rather than at the top: syncing reads the workspace, and the
    // two would import each other.
    const { sync } = await import('../sync.svelte')
    sync.status = 'error'
    sync.lastError = t('{name} could not be written.', { name: first.shown })
  }

  /** One file operation on a document, after the one before it has finished.
   *
   *  A write and a rename of the same file are two round trips, and nothing orders
   *  two round trips but this: a rename landing while a write was still in the air
   *  moved the file, and the write then put the old name back beside it. So each
   *  waits its turn, whoever asked for it - the pause, Ctrl+S, the window going, a
   *  row renamed in the file list. */
  holding(note: NoteDoc, run: () => Promise<void>): Promise<void> {
    const before = this.busy.get(note) ?? Promise.resolve()
    const mine = before.then(run)
    this.busy.set(
      note,
      mine.catch(() => undefined),
    )

    this.track(mine)
    return mine
  }

  /** Writes one document down: a note, a canvas or a page note. Everything that
   *  writes comes through here, so a note open in two panes is written once
   *  however the writing was asked for. */
  write(note: NoteDoc): Promise<void> {
    return this.holding(note, () => this.writeOne(note))
  }

  /** Whatever is running, known about until it has finished. Whoever started it
   *  hears how it went; this only waits for it. */
  private track(work: Promise<void>) {
    const done = work.catch(() => undefined)
    this.running.add(done)
    void done.then(() => this.running.delete(done))
  }

  /** A draft's first words, which make it a file: in the space, under the name its
   *  words or its own name give it, written at once. See drafts.ts.
   *
   *  The path is claimed in the same breath as it is chosen - the document has it
   *  before anything else can ask - so two drafts born together step aside from each
   *  other rather than landing on one file; see `freeName` in workspace.svelte.ts,
   *  which counts every open document's path. */
  private async born(note: NoteDoc): Promise<void> {
    if (this.bearing.has(note)) return
    this.bearing.add(note)

    try {
      const home = await this.ws.draftHome()
      // Given a file some other way while the folder was being found, or nowhere
      // to put one at all: either way this is not the moment.
      if (home === null || note.path !== null) return

      const follows = namedByWords(note)
      const path = joinPath(home, this.ws.freeName(home, draftFile(note)))
      note.path = path
      note.name = nameOf(path)
      note.follows = follows
      this.making.add(note)
      this.ws.born(path)
    } finally {
      this.bearing.delete(note)
    }

    this.waiting.add(note)
    this.hurry()
  }

  /** Whether a note's file went out from under a write that was still waiting for
   *  the typing to stop.
   *
   *  Deleting a note closes its tab and takes the file, and the keystrokes from the
   *  second before are still here waiting to go down. Writing them then put the note
   *  straight back on the disk a moment after it was deleted - and, where the folder
   *  around it went too, put the folder back as well.
   *
   *  Two things have to be true, and both are read rather than asked of the disk. No
   *  tab is holding the note, so nobody can still be typing in it: a tab closed on a
   *  note that is still there is the ordinary case, and the last thing typed before
   *  it was shut has to go down. And the listing no longer holds the path, which is
   *  what a delete does to the tree before it touches the file; see `hideEntry` in
   *  workspace.svelte.ts. A note belonging to some other space is nothing this
   *  listing can answer for, so it is left alone. */
  private gone(note: NoteDoc): boolean {
    const path = note.path
    const tree = this.ws.tree
    if (path === null || !tree || this.making.has(note)) return false
    if (this.ws.tabs.some((tab) => tab.note === note)) return false
    if (!path.startsWith(`${tree.path}/`)) return false

    return !entryAt(tree, path)
  }

  /** The open notes a version could be kept of: each one's file, its words as
   *  they stand, and which revision those words are at. The revision is how file
   *  recovery tells the ones that have moved since it last looked. See
   *  recovery.svelte.ts. */
  get worthKeeping(): { key: string; path: string; text: string; revision: number }[] {
    this.flush()
    const out: { key: string; path: string; text: string; revision: number }[] = []

    for (const note of this.ws.documents) {
      const path = note.path
      if (path === null || !holdsWords(note.kind)) continue

      out.push({ key: note.key, path, text: note.text, revision: note.revision })
    }

    return out
  }

  private async writeOne(note: NoteDoc): Promise<void> {
    // The keystrokes since the last pause, which are still only a rope.
    note.flush()

    let path = note.path
    if (path === null || !holdsWords(note.kind)) return

    // The file this write is for may have been deleted while the write was waiting;
    // see `gone`. Nothing is written, because writing would be undeleting.
    if (this.gone(note)) return

    // Which note this document is on as the write begins. A document outlives the
    // file in it - the one tab that previews a note takes another note on rather
    // than being swapped for another document - so the words and the path can
    // otherwise be read a round trip apart and belong to two different notes.
    // Checked again at the write below. See NoteDoc.arrivals.
    const holding = note.arrivals
    const making = this.making.has(note)

    // A note named after its words follows them: the name they ask for now, before
    // the words go down. A file that is not on the disk yet is simply pointed at the
    // new name; one that is, is renamed, links and all.
    const was = path
    const folder = folderOf(was)
    const renamed = followedName(note, (file) => this.ws.freeName(folder, file, was))
    if (renamed !== null) {
      if (making) {
        note.path = joinPath(folder, renamed)
        note.name = renamed
      } else {
        await this.ws.retitle(was, renamed).catch((error: unknown) => {
          log('warn', `retitle: ${was} - ${String(error)}`)
        })
      }
      path = note.path ?? was
    }

    // The words going down, and which revision of the note they are, both read
    // once. A keystroke landing inside the round trip belongs to the next write,
    // and the note has to be told which one it just had.
    const content = note.text
    const revision = note.revision

    // The words the file held when this sitting began, kept as a version before the
    // first write replaces them. Every write is not a version: a note written as
    // fast as it is typed would fill a history of forty with the last minute. The
    // recovery timer keeps the rest; see recovery.svelte.ts.
    const before = note.firstVersion()
    if (before?.trim() && before !== content) {
      await invoke('snapshot_note', { path, content: before }).catch(() => undefined)
    }

    // The document moved on to another note while this write was being got ready.
    // Refused rather than written: these words are that other note's, and this path
    // is not theirs to go to.
    if (note.arrivals !== holding) {
      console.warn(`nib: a write of ${path} was refused - those words are another note’s now`)
      return
    }

    // Moved while the write was being got ready: the words follow the file.
    if (note.path !== null) path = note.path

    await invoke('write_note', { path, content })
    note.written(path, nameOf(path), revision)

    // The one file that changed, read again from what was written. This is the
    // whole of keeping the index up to date after the first scan of a space; it
    // knows a canvas from a note by its name.
    links.noteSaved(path, content)

    // Editing the config files in Nib should take effect as they are written.
    if (/\.css$|snippets\.json$/.test(path)) {
      const { settings } = await import('../settings.svelte')
      const { theme } = await import('../theme.svelte')
      await Promise.all([settings.loadSnippets(), theme.reload()])
    }

    // A file that is new is a row the list has not read yet; one written over is
    // the row it was, a moment later.
    if (making) {
      this.making.delete(note)
      await this.ws.loadTree()
    } else {
      this.ws.touched(path)
    }
    this.ws.persist()

    // Imported here rather than at the top: syncing reads the workspace, and the
    // two would import each other.
    const { sync } = await import('../sync.svelte')
    sync.nudge()
  }
}
