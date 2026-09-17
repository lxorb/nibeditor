/** Writing what is open down, and the dot that says so.
 *
 *  Two rules, and everything here is one of them. A note in a space is Nib's to
 *  look after: it is written as soon as the typing pauses, wears no mark and asks
 *  nobody anything. A file opened from the computer is the reader's: it is written
 *  when they say so, and until they do it wears the dot. Which of the two a path
 *  is, is the workspace's to answer - see `keepsItself` - and everything below
 *  takes that answer as given.
 *
 *  Its own module because its state is its own: which documents are waiting for
 *  the pause, which have a mark on them, and the timers behind both. The
 *  workspace holds one of these and hands its own calls straight through, so
 *  `workspace.save()` still means what it always did. */

import { flushTableEdits } from '@nib/editor'
import { flushCardEdits } from '../canvas/writing'
import { key, t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { endingOf, nameFromContent, shownName } from '../note-name'
import { owesLast } from '../parting'
import { without } from '../records'
import { isMarkdownPath, nameOf } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { afterQuiet } from '../timing'
import { keep, storedText } from '../stored'
import { entryAt } from '../tree-edits'
import type { Entry, Space } from '../workspace.svelte'
import { holdsWords, NoteDoc, type Tab, UNTITLED } from './documents.svelte'

/** How long after the last keystroke a note that keeps itself is written, in
 *  milliseconds. A second is long enough that a burst of typing is one write and
 *  short enough that nothing is ever lost worth minding. */
const SAVE_DELAY = 1200

/** How long the dot stays as a tick once the note is down, in milliseconds. */
const SAVED_SHOWN = 1400

/** The kinds of document a save can write. Every kind a tab holds but the two that
 *  are somebody else's file already: a PDF is read and never written, and the graph is
 *  a picture of the space rather than a document. */
type Savable = 'note' | 'canvas' | 'pages' | 'web'

const SAVABLE = new Set<string>(['note', 'canvas', 'pages', 'web'])

const savable = (kind: string): kind is Savable => SAVABLE.has(kind)

/** What writing needs of the store the documents are open in. */
export interface Writes {
  readonly tabs: Tab[]
  readonly documents: NoteDoc[]
  readonly active: Tab | null
  readonly previewTabId: string | null
  readonly spaces: Space[]
  readonly activeSpaceId: string | null
  /** The space on screen as the file list holds it, for the folders a save offers. */
  readonly tree: Entry | null
  keep(id: string): void
  scheduleSession(): void
  loadTree(): Promise<void>
  persist(): void
  /** Writes the shortcut for a website nobody has saved yet. The one document whose
   *  file is not its own words, so the workspace writes it rather than this; see
   *  `keepWeb` in workspace.svelte.ts. */
  keepWeb(tab: Tab, path: string): Promise<void>
  /** The name a folder will take: the wanted one, or the next number after it where the
   *  folder already holds that name. The rule the file list follows for a duplicate, so
   *  a save can never write over anything. */
  freeName(folder: string, name: string): string
}

/** The ending each kind of document is written under, and how a name that already
 *  wears one is recognised. Read through the app's own two answers rather than a regex
 *  of this file's own: `isMarkdownPath` for a note and `endingOf` for the rest, so
 *  saving `Plan.canvas` does not make `Plan.canvas.canvas`. See note-name.ts, which
 *  says why nothing here takes an ending off by hand. */
const EXTENSION: Record<Savable, string> = {
  note: '.md',
  canvas: '.canvas',
  pages: '.pages',
  web: '.url',
}

/** The file a typed name comes to, under its kind's own ending. */
function fileNamed(name: string, kind: Savable): string {
  const already =
    kind === 'note' ? isMarkdownPath(name) : endingOf(name)?.toLowerCase() === EXTENSION[kind]

  return already ? name : `${name}${EXTENSION[kind]}`
}

/** The folder a save was last pointed at. This machine's, not the space's and not the
 *  account's: it is where a hand was a moment ago. */
const FOLDER_KEY = 'nib:save-folder'

/** A name for a file that has none, and the folder to put it in.
 *
 *  One sheet for every kind, and it is the sheet Chrome shows when a page is
 *  bookmarked, for the same reason: the two things nobody else can decide are what to
 *  call it and where to keep it. The folder starts at the one used last, so a run of
 *  drafts is one press each after the first.
 *
 *  **Nothing is ever replaced.** A name the chosen folder already holds steps aside by
 *  number - `Plan` becomes `Plan 2` - which is the rule the file list already follows
 *  for a duplicate, out of the same helper. The field starts on a free name, the sheet
 *  says so while a taken one is typed, and the path that comes back is free whatever was
 *  typed: a save that quietly wrote over somebody's note was the one thing this could get
 *  wrong.
 *
 *  Null where the question was dismissed, which always means "do nothing". */
async function pickSavePath(ask: {
  kind: Savable
  doc: string
  name: string
  spaces: Space[]
  activeId: string | null
  tree: Entry | null
  /** The name that folder will take, which is the wanted one or the next free number
   *  after it; see `freeName` in workspace.svelte.ts. */
  freeName: (folder: string, name: string) => string
}): Promise<{ path: string; name: string } | null> {
  const here = ask.spaces.find((one) => one.id === ask.activeId) ?? ask.spaces[0]
  if (!here) return null

  // Every folder a file could go in, which is the list a move already works out: the
  // space's own room, every note in it - a note that holds notes is a folder - and any
  // other space there is. Fetched rather than imported, because nothing here is wanted
  // until somebody saves something that has never been saved.
  const { moveTargets } = await import('../move-targets')
  const folders = moveTargets({
    moving: null,
    tree: ask.tree,
    spaces: ask.spaces,
    here: here.root,
  })

  const last = storedText(FOLDER_KEY)
  const start = folders.some((one) => one.id === last) ? last : here.root

  /** The file that name would be, free of anything already there: the name itself, or
   *  the next number after it. The name as the field holds it - without the ending,
   *  which a reader never types and never reads; see note-name.ts. */
  const freeIn = (folder: string | null, name: string): string =>
    shownName(ask.freeName(folder ?? here.root, fileNamed(name.trim() || UNTITLED, ask.kind)))

  // The name it has, else the words at the top of it - which only a note has; a plane
  // and a deck of pages hold JSON, and the first line of that is not a name. A website
  // arrives here already called what the page calls itself.
  const wanted =
    (ask.name !== UNTITLED ? shownName(ask.name) : null) ??
    (ask.kind === 'note' ? nameFromContent(ask.doc) : null) ??
    UNTITLED

  const { prompt } = await import('../prompt.svelte')
  const answer = await prompt.askName({
    title: t('Save'),
    value: freeIn(start, wanted),
    placeholder: t('Untitled'),
    confirmLabel: key('Save'),
    // A folder says which space it is in, so the spaces are not asked about twice.
    spaces: [],
    space: null,
    folders: folders.map((one) => ({ id: one.id, label: one.label })),
    folder: start,
    // What the sheet says under the field while the name is one the folder already has.
    // Asked of the sheet's own two values, so it answers the folder being changed as
    // well as the name being typed.
    taken: (name, folder) =>
      freeIn(folder, name) === name.trim() ? null : t('That name is taken'),
  })

  if (!answer?.name) return null

  const folder = answer.folder ?? here.root
  keep(FOLDER_KEY, folder)

  const clean = answer.name.replace(/[\\/]/g, ' ').trim()
  if (!clean) return null

  // Free again, at the moment of writing: the sheet said what was taken, and this is
  // what makes it true whatever was typed over it.
  const named = ask.freeName(folder, fileNamed(clean, ask.kind))
  return { path: joinPath(folder, named), name: shownName(named) }
}

export class Saving {
  /** What the dot beside each name is saying, by the document's key. */
  private state = $state<Record<string, 'saving' | 'saved'>>({})
  private savedTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  /** The write that waits for a pause in the typing; see timing.ts. */
  private readonly soon = afterQuiet(() => void this.saveWaiting(), SAVE_DELAY)

  /** Notes waiting to be written when the typing stops. A set rather than one
   *  note, because two panes may hold two different notes and both be edited
   *  between one pause and the next. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly waiting = new Set<NoteDoc>()

  constructor(private readonly ws: Writes) {
    // A window closing runs no teardown, so the pause a note is written after never
    // comes: a sentence typed and then closed on was gone, with nothing on the disk
    // and nothing in the session either. Last of all, because a plane turns itself
    // into its document first and this is what writes the document out. See
    // parting.ts.
    owesLast(() => this.part())
  }

  /** What is owed when the window goes: the session, and the write that was waiting
   *  for the typing to stop.
   *
   *  The session always. It holds which notes are open, which one is in front and
   *  what is unsaved in each of them, and it too is written after a pause - a tab
   *  opened or brought forward in the last half second was simply not there on the
   *  way back in. It is one synchronous line of storage, so it costs a closing window
   *  nothing to be sure of it.
   *
   *  And the write, where there is one. That is a round trip, and a page being torn
   *  down may not come back from it - which is the other reason the session goes
   *  first: the words are in it either way, so whichever of the two landed, nothing
   *  was typed and lost. */
  private part() {
    this.ws.persist()
    if (this.waiting.size) void this.saveWaiting()
  }

  /** What a document reports whenever it changes, wherever the change came from:
   *  a keystroke in either pane, an undo, a picture dropped in. Nothing here
   *  touches the text - the rope is left as it is and `flush` turns it into a
   *  string later, so the cost of a keystroke does not grow with the size of the
   *  note. What happens at once is the dirty mark, because that is what the
   *  writer is looking at, and the document has already set it. */
  edited(note: NoteDoc) {
    // Typing in a note you were only previewing is what makes it yours.
    const preview = this.ws.tabs.find((tab) => tab.id === this.ws.previewTabId)
    if (preview?.note === note) this.ws.keep(preview.id)

    this.scheduleSave(note)
    // The note may have nowhere to be written to, or be one nobody has asked to
    // save yet. Either way the words themselves are written down.
    this.ws.scheduleSession()
  }

  /** What the dot beside a name is saying, if anything. */
  of(tab: Tab): 'saving' | 'saved' | undefined {
    return this.state[tab.note.key]
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

  /** A note in a space is written as soon as the typing pauses, because nothing in
   *  the app is going to ask anybody to save it: it has no mark and no question on
   *  the way out, and the light on the settings button is the whole report on
   *  where its words have got to.
   *
   *  A file opened from the computer is written when the reader says so, and not
   *  a moment before. That is the only place saving is still a thing somebody
   *  does, so it is the only place where waiting for them is right.
   *
   *  A file somebody shared on its own has no file here at all: its room is what
   *  keeps it, and there is nowhere on this machine for a write to go. */
  private scheduleSave(note: NoteDoc) {
    if (!note.keepsItself || note.shared !== null) return

    this.waiting.add(note)
    this.soon()
  }

  private async saveWaiting() {
    const notes = [...this.waiting]
    this.waiting.clear()

    for (const note of notes) await this.write(note)
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
    if (path === null || !tree) return false
    if (this.ws.tabs.some((tab) => tab.note === note)) return false
    if (!path.startsWith(`${tree.path}/`)) return false

    return !entryAt(tree, path)
  }

  /** The dot's three states. `saved` stands for a moment and then goes: it is
   *  a confirmation, not a status, and a note with nothing to write should not
   *  wear a mark forever.
   *
   *  A note in a space wears no dot at all. It is written every second or so, and
   *  a mark that blinks whenever somebody pauses is not a report on anything they
   *  have to know; the light on the settings button says how the space itself is
   *  doing. */
  private markSaving(note: NoteDoc) {
    if (note.keepsItself) return

    const id = note.key
    this.forgetSavedTimer(id)
    this.state = { ...this.state, [id]: 'saving' }
  }

  private markSaved(note: NoteDoc) {
    if (note.keepsItself) return

    const id = note.key
    this.state = { ...this.state, [id]: 'saved' }
    this.savedTimers[id] = setTimeout(() => this.clearSaveState(id), SAVED_SHOWN)
  }

  private clearSaveState(id: string) {
    this.forgetSavedTimer(id)
    this.state = without(this.state, id)
  }

  private forgetSavedTimer(id: string) {
    clearTimeout(this.savedTimers[id])
    this.savedTimers = without(this.savedTimers, id)
  }

  /** Notes holding work nothing else has hold of: notes and not tabs, so a note
   *  open in two panes is one thing to ask about. What counts is the document's
   *  own answer; see NoteDoc.unsaved. */
  get unsaved(): NoteDoc[] {
    this.flush()
    return this.ws.documents.filter((note) => note.unsaved)
  }

  /** The open notes a version could be kept of: each one's file, its words as
   *  they stand, and which revision those words are at.
   *
   *  Every note with a file, rather than only the unsaved ones: a note in a space
   *  is written as fast as it is typed and so is never unsaved, which is to say
   *  almost every note there is. The revision is how file recovery tells the ones
   *  that have moved since it last looked. See recovery.svelte.ts. */
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

  async save(target?: Tab) {
    // A table cell holds its text until it loses focus; make sure it landed. A card
    // on a canvas holds its words the same way, and saving on purpose used to write
    // the empty card over the file; see canvas/writing.ts.
    flushTableEdits()
    flushCardEdits()

    const tab = target ?? this.ws.active
    if (!tab) return

    // Saving is as deliberate as it gets: a note that was only being looked
    // at is one to stay from here on, whether or not there was anything to
    // write.
    this.ws.keep(tab.id)

    // A website nobody has saved is the one document whose file is not its words: what
    // goes down is a shortcut holding the address the tab is on, so the same sheet asks
    // the same two questions and the workspace writes the file. A saved one needs
    // nothing here - the file follows the reading on its own; see keep.ts.
    if (tab.kind === 'web') {
      if (tab.path !== null) return

      const picked = await pickSavePath({
        kind: 'web',
        doc: '',
        name: tab.name,
        spaces: this.ws.spaces,
        activeId: this.ws.activeSpaceId,
        tree: this.ws.tree,
        freeName: (folder, name) => this.ws.freeName(folder, name),
      })
      if (!picked) return

      await this.ws.keepWeb(tab, picked.path)
      return
    }

    if (!holdsWords(tab.kind)) return
    await this.write(tab.note)
  }

  /** Writes one document down: a note, or a canvas, which are the two things a
   *  tab holds that have words of their own. Everything that saves comes through
   *  here, so a note open in two panes is written once however the saving was
   *  asked for.
   *
   *  Public for the one caller that has a document rather than a tab: the question
   *  asked on the way out of a note somebody has to save; see `askToClose`. */
  async write(note: NoteDoc) {
    // The keystrokes since the last pause, which are still only a rope.
    note.flush()
    if (!holdsWords(note.kind)) return

    // The file this write is for may have been deleted while the write was waiting;
    // see `gone`. Nothing is written, because writing would be undeleting.
    if (this.gone(note)) {
      this.clearSaveState(note.key)
      return
    }

    // Which note this document is on as the write begins. A document outlives the
    // file in it - the one tab that previews a note takes another note on rather
    // than being swapped for another document - and a write is a round trip with a
    // name prompt in it, so the words and the path can otherwise be read a click
    // apart and belong to two different notes. Checked again at the write below,
    // which is the last moment before the pair reaches the disk. See
    // NoteDoc.arrivals.
    const holding = note.arrivals

    let path = note.path
    if (!path) {
      // Every kind that has words asks the same two questions - what to call it, and
      // which folder - and is written under its own extension. A plane used to refuse
      // here, because a plane was only ever made with a file already; now one can be
      // made as a tab and saved afterwards, which is what Emil asked for.
      if (!savable(note.kind)) return

      const picked = await pickSavePath({
        kind: note.kind,
        doc: note.text,
        name: note.name,
        spaces: this.ws.spaces,
        activeId: this.ws.activeSpaceId,
        tree: this.ws.tree,
        freeName: (folder, name) => this.ws.freeName(folder, name),
      })
      if (!picked) return
      path = picked.path
    }

    // The words going down, and which revision of the note they are, both read
    // once. Writing a file is a round trip: a keystroke landing inside it belongs
    // to the next write, and the note has to be told which one it just had.
    const content = note.text
    const revision = note.revision

    this.markSaving(note)

    try {
      // Keep the version that is about to be replaced, before replacing it.
      if (note.path) {
        await invoke('snapshot_note', { path, content }).catch(() => undefined)
      }

      // The document moved on to another note while this write was being got
      // ready. Refused rather than written: these words are that other note's, and
      // this path is not theirs to go to.
      if (note.arrivals !== holding) {
        console.warn(`nib: a write of ${path} was refused - those words are another note’s now`)
        this.clearSaveState(note.key)
        return
      }

      await invoke('write_note', { path, content })
    } catch (error) {
      this.clearSaveState(note.key)
      throw error
    }

    note.written(path, nameOf(path), revision)
    this.markSaved(note)

    // The one file that changed, read again from what was written. This is the
    // whole of keeping the index up to date after the first scan of a space; it
    // knows a canvas from a note by its name.
    links.noteSaved(path, content)

    // Editing the config files in Nib should take effect on save.
    if (/custom\.css$|snippets\.json$/.test(path)) {
      const { settings } = await import('../settings.svelte')
      const { theme } = await import('../theme.svelte')
      await Promise.all([settings.loadSnippets(), theme.reload()])
    }

    await this.ws.loadTree()
    this.ws.persist()

    // Imported here rather than at the top: syncing reads the workspace, and
    // the two would import each other.
    const { sync } = await import('../sync.svelte')
    sync.nudge()
  }
}
