/** Every link in the open space, and what the app does with them.
 *
 *  One index, three readers. The editor asks it which notes exist, so `[[` can
 *  offer them and a link can be drawn as resolved or not. The Links panel asks it
 *  what points at the open note and what it points at. A rename asks it which
 *  notes have to be rewritten.
 *
 *  Built once per space by one command that reads every note in a single pass -
 *  `scan_links`, in Rust on the desktop and over IndexedDB in the browser - and
 *  kept up to date from then on by re-reading only the note that was just saved.
 *  A space of a few thousand notes is scanned in one call and off the main
 *  thread; nothing here walks a space again.
 *
 *  Which is why the two overlap rather than take turns. That one pass reads the
 *  space as it was when it was asked for, and the app goes on writing, deleting
 *  and moving notes for as long as it takes to answer - a launch is nothing but
 *  that. So the rows it brings back are where the index starts and not what it
 *  becomes: see `build` and `edit`.
 *
 *  Paths are relative to the space and `/`-separated throughout, because that is
 *  what a link says. `space-paths.ts` is the only place that converts. */

import {
  type FileDrawing,
  type NoteIndex,
  type NoteRef,
  resolveFile,
  resolveNote,
  resolveRelative,
  type SpaceBlock,
  type SpaceTag,
} from '@nib/editor'
import {
  blockIdOf,
  blockIds,
  type FoundLink,
  freeBlockId,
  isCanvasTarget,
  isPagesTarget,
  isTabFile,
  isWebTarget,
  type LinkKind,
  withoutBlockIds,
} from '@nib/markdown/links'
import { buildGraph, type NoteGraph } from './graph'
import { drawFile } from './reading/drawn'
import { rewriteLinks } from './link-rewrite'
import { t } from './i18n.svelte'
import { shownName } from './note-name'
import { pressRow, queryRowsHtml } from './query-block'
import type { Hit } from './search/match'
import { parseQuery } from './search/query'
import { searchSpace } from './search/space'
import { type ScannedNote, scanNote, scanShortcut, type SpaceLinks } from './scan-note'
import { startup } from './startup.svelte'
import { mark } from './trace'
import {
  folderOf,
  insideSpace,
  isMarkdownPath,
  nameOf,
  noteName,
  relativePath,
  relativeTo,
} from './space-paths'
import { invoke } from './tauri'

/** One place a link was found, as a row in the panel. */
export interface Reference {
  /** The note it is in, relative to the space. */
  path: string
  /** That note's file name, ending and all: what a row shows is `shownName` of it,
   *  read once by whatever draws the row rather than half here and half there. A
   *  name an ending had already come off of had a second one taken off, so a note
   *  called `a.canvas.md` read `a` in this panel and `a.canvas` in every other
   *  list. See note-name.ts. */
  name: string
  line: number
  /** The line, as the context the row is read in. */
  text: string
}

/** A link out of the open note: the same, plus where it goes. */
export interface Outgoing extends Reference {
  /** What the link says, for a row that has nowhere to point. */
  target: string
  /** The note it resolves to, or null when the space holds none. */
  to: string | null
}

/** How many mentions are worth looking for. The same ceiling the search field
 *  uses, and for the same reason. */
const MOST_MENTIONS = 200

/** How many notes a read-through keeps in hand for the embeds and previews on
 *  screen. A handful is all a screenful of embeds can ask for. */
const CACHED = 24

/** The extensions a link may leave out, which is the same list the editor's own
 *  resolver keeps and for the same reasons; see `OWN` in wikilink/notes.ts. */
const OWN = /\.(md|markdown|mdown|mkd|url|webloc)$/i

/** A path as something to compare: no extension of our own, folded case. The same
 *  reading `resolveNote` does, so a candidate here is a candidate there. */
function comparable(path: string): string {
  return path.replace(/\\/g, '/').replace(OWN, '').toLowerCase()
}

/** Every name a note answers to, folded: the last part of its path, and the
 *  aliases it gave itself in its own front matter. */
function namesOf(note: { path: string; aliases: readonly string[] }): ReadonlySet<string> {
  const folded = note.aliases.map((alias) => comparable(alias.trim())).filter(Boolean)
  return new Set([comparable(nameOf(note.path)), ...folded])
}

class Links {
  /** Every note of the open space as the last scan read it.
   *
   *  Raw state, not deep: every write below replaces the whole array, and nothing
   *  anywhere reaches into a scanned note to change it. Deep, the proxy would be
   *  paid for per note, per heading, per link and per alias the first time anything
   *  walked the index - which the file list does, once, to find out which rows wear
   *  an icon - so a space of a few thousand notes spent part of its launch making
   *  objects reactive that never change. The same trade the syncing loop makes with
   *  its mirrors, for the same reason; see sync.svelte.ts. */
  private notes = $state.raw<ScannedNote[]>([])
  private files = $state.raw<string[]>([])
  /** Which space the index is of, so a listing for another one is dropped. */
  private root: string | null = null
  /** Bumped whenever the index changed. The editor is handed a new object only
   *  when this moves, so a keystroke does not redraw every link on screen. */
  version = $state(0)
  /** True while the first scan of a space is in flight, so the panel can say
   *  so rather than showing an empty list that is not the answer. */
  scanning = $state(false)

  /** Notes read for an embed or a preview, newest last. Cleared whenever the
   *  index changes, so a frame never shows a note as it was two saves ago. */
  private read = new Map<string, string>()

  /** Every note as the editor needs to see it. Derived once per change rather
   *  than per link drawn, since resolving a name walks it. */
  private readonly refs = $derived.by((): NoteRef[] =>
    this.notes.map((note) => ({
      path: note.path,
      name: note.name,
      headings: note.headings,
      blocks: note.blocks,
      aliases: note.aliases,
    })),
  )

  /** Every tag of the space with the notes under it, most carried first.
   *
   *  The one answer to "what is this space tagged with", and both surfaces that ask
   *  read it: the editor's `#` popup, which is handed it with the rest of the index,
   *  and the tag tree above the search field. They used to ask two different things
   *  of two different places - the popup this, and the tree `space_tags`, which read
   *  every body in the space again to count uses rather than notes.
   *
   *  What a number here means, said once. It is notes and not uses: a note that
   *  writes `#work` three times is one note under `work`. It is folded: `#Work` and
   *  `#work` are one tag, which is what the `tag:` operator already means and what
   *  the tree already grouped by. And it counts towards every level above it, since
   *  `#work/nib` is a note under `work` as well - the slashes are a path, the way the
   *  tree and the operator both read them. So the list holds a row per level, and
   *  whatever draws it takes the levels as given rather than rolling them up again.
   *
   *  Out of the same scan the links came from, which already read every note's tags:
   *  asking the space instead was twenty-two megabytes of strings built on the thread
   *  the panel was opening on, three to four hundred milliseconds of it.
   *
   *  Derived, so it is nothing at all until something asks and is built again only
   *  when the index has actually changed; see `refs` above for why the notes are
   *  raw state. */
  readonly spaceTags = $derived.by((): SpaceTag[] => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const counts = new Map<string, number>()

    for (const note of this.notes) {
      // One note is one count per name, whatever it wrote twice and whatever two
      // of its tags share a level. A list rather than a set: a note carries a
      // handful of tags, and the reading below is a walk either way.
      const under: string[] = []

      for (const tag of note.tags) {
        const parts = tag.split('/').filter(Boolean)
        for (let depth = 1; depth <= parts.length; depth++) {
          const path = parts.slice(0, depth).join('/')
          if (!under.includes(path)) under.push(path)
        }
      }

      for (const path of under) counts.set(path, (counts.get(path) ?? 0) + 1)
    }

    return [...counts]
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((one, other) => other.notes - one.notes || (one.tag < other.tag ? -1 : 1))
  })

  /** The whole space as a graph: a node per note, an edge per pair of notes that
   *  link to each other. The graph view reads this one, so there is no second
   *  index of the space anywhere.
   *
   *  Derived, which makes it two things at once: nothing at all until a graph is
   *  asked for, and built again only when the index has actually changed. It
   *  walks every link once and resolves each through the cache above, which is
   *  what makes a space of two thousand notes a few milliseconds rather than a
   *  second. */
  readonly graph = $derived.by((): NoteGraph =>
    buildGraph(this.notes, (from, link) => this.resolveFrom(from, link)),
  )

  /** The same space with the files its notes embed in it as nodes of their own.
   *
   *  A second derived rather than an argument, because both of these are lazy: a
   *  space whose card never asks for attachments never builds this one, and a space
   *  that does asks for it once per change to the index rather than once per frame.
   *  Which of the two a surface reads is the `attachments` switch; see
   *  workspace/graph-settings.svelte.ts. */
  readonly graphWithFiles = $derived.by((): NoteGraph =>
    buildGraph(this.notes, (from, link) => this.resolveFrom(from, link), { attachments: true }),
  )

  /** Whichever of the two the card is asking for. */
  pictureOf(attachments: boolean): NoteGraph {
    return attachments ? this.graphWithFiles : this.graph
  }

  /** Reads a whole space. Called when a space opens; everything after that is
   *  `noteSaved`.
   *
   *  It waits for the file list to be on screen first. This is the one thing in
   *  the app that reads every body there is, and a space of a few thousand notes
   *  is a second of disk on a desktop and several on a phone: started in the same
   *  breath as the listing, it was a second of the launch spent on the panel
   *  nobody had asked for yet, competing with the one read that was in anybody's
   *  way - the open note's. The space it is of is written down at once, though, so
   *  a second space opening while this is still queued still cancels it - see
   *  `scans` - and the panel can say it is scanning rather than showing an empty
   *  list as an answer.
   *
   *  The index empties in the same breath, because from here until the rows land
   *  it is an index of this space and holds nothing of it. It used to keep the
   *  last space's notes under the new space's name for the whole of that second,
   *  so `[[` offered notes from the space somebody had just left and a link drawn
   *  in this one resolved against another's. A space being read says so - see
   *  `scanning` - and saying nothing is the honest answer until it has one.
   *
   *  Rows go up without their chosen icons and take them when this lands; see
   *  `icons` below and chosen-icon.ts. See startup.svelte.ts for the order. */
  async build(root: string) {
    // Which scan this is. A root cannot say: a space closed and opened again is
    // the same string, and the first scan landing into the second one's index
    // would take the second one's news with it. Counted, the way the syncing loop
    // counts its own runs and for the same reason; see `generation` in
    // sync.svelte.ts.
    const mine = ++this.scans
    this.root = root
    this.scanning = true
    this.notes = []
    this.files = []
    this.since = []
    this.changed()

    // A scan's own hand, held in its own frame rather than on a field of the
    // class. A second space opening replaces the field, so a scan that finds
    // itself out of date used to let go of the *new* space's waiters on its way
    // out - and whoever was drawn from the whole index read one that held
    // nothing yet.
    let landed: () => void = () => undefined
    this.landing = new Promise<void>((go) => (landed = go))

    await startup.turn('index')
    if (this.scans !== mine) {
      landed()
      return
    }

    mark('scan_links asked')
    const found = await invoke<SpaceLinks>('scan_links', { root }).catch(() => null)
    mark('scan_links answered')

    // Another space may have opened while this one was being read.
    if (this.scans !== mine) {
      landed()
      return
    }

    this.scanning = false
    // The rows are the space as it was when the scan was asked for, and the app
    // has gone on writing, deleting and moving notes for as long as it took to
    // read. So they are not what the index becomes: they are what it starts from,
    // and everything it was told meanwhile is done again on top, in the order it
    // happened. Taking the rows as the answer dropped every note saved during the
    // scan - which on a launch is whatever a space opens onto and whatever the
    // account has just brought down - and nothing reads a space twice, so they
    // stayed dropped until the next one. See `edit`.
    this.notes = this.since.reduce((notes, again) => again(notes), found?.notes ?? [])
    this.since = []
    // A file has no words to be stale, so the two lists are simply both true: what
    // the walk found, and what was put there while it walked.
    this.files = [...new Set([...(found?.files ?? []), ...this.files])].sort()
    this.changed()
    landed()
  }

  /** Whoever is waiting for the scan in flight. */
  private landing: Promise<void> = Promise.resolve()

  /** How many scans have been started, ever. A scan's own number is the whole of
   *  how it tells whether it is still the one being waited for; see `build`. */
  private scans = 0

  /** Everything the index was told while a scan was in the air, as the changes
   *  themselves, ready to be made again over the rows the scan brings back.
   *
   *  Empty except for the length of one scan, which is the first second of a
   *  space; the one piece of state here that lives for the length of a round trip,
   *  the way `coming` does in workspace/open.ts. */
  private since: ((notes: readonly ScannedNote[]) => ScannedNote[])[] = []

  /** One change to what the index holds, which is also what a change *is*: a new
   *  list of notes made out of the one there was.
   *
   *  Made now, and written down to be made again if a scan is still in the air,
   *  so that the news never depends on which of the two lands first. Every way the
   *  index learns about one note goes through here, so there is nothing to
   *  remember at a call site and nothing to forget at a new one. */
  private edit(change: (notes: readonly ScannedNote[]) => ScannedNote[]) {
    if (this.scanning) this.since.push(change)

    this.notes = change(this.notes)
    this.changed()
  }

  /** Resolves when the scan in flight has landed, or at once when none is.
   *
   *  What a surface drawn from the whole index waits for rather than polling
   *  `scanning`: the tag tree is the case, since it is a fact about every note in
   *  the space and the honest answer before the scan lands is nothing. */
  scanned(): Promise<void> {
    return this.scanning ? this.landing : Promise.resolve()
  }

  /** Which space the index is of, so the caller can tell whether it is the one
   *  now open without holding a copy of the answer. */
  rootOf(): string | null {
    return this.root
  }

  /** The notes that said they wear an icon, by path.
   *
   *  Only those, because a space of a thousand notes has a handful: the map is
   *  the size of what was chosen rather than of the space. Derived, so a row asks
   *  a lookup rather than a walk, and so every row that shows a note redraws by
   *  itself the moment the note's front matter changes - which is what makes
   *  choosing an icon land in the tree, the tabs and the search results at once
   *  without any of them being told. */
  private readonly icons = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const note of this.notes) {
      if (note.icon) map.set(note.path, note.icon)
    }

    return map
  })

  /** And the colour each of those is drawn in, where one was chosen. A second map
   *  rather than a second field on the first, because it is the rarer of the two:
   *  most notes that wear an icon wear it in the plain foreground, and the map is
   *  the size of what was chosen. */
  private readonly tints = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const note of this.notes) {
      if (note.icon && note.iconColor) map.set(note.path, note.iconColor)
    }

    return map
  })

  /** The notes that were written as websites, by the address each points at.
   *
   *  A website is a shortcut file now - `Svelte docs.url` - and its name says so,
   *  which is why no list asks this any more. What is left in here is the old format:
   *  a `.md` note with `url:` in its front matter, from a space written by an older
   *  nib. So this map is what says a note wants converting, and the only thing it
   *  says; see web-tab/shortcut.ts and `workspace.asShortcut`.
   *
   *  The same shape as the icons above and for the same reason: a space of a
   *  thousand notes holds a handful of these, so the map is the size of what is
   *  there rather than of the space, and it empties itself as they are converted. */
  private readonly addresses = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const note of this.notes) {
      if (note.url) map.set(note.path, note.url)
    }

    return map
  })

  /** The websites that carry the site's own mark, by path: a `.url`'s `Nib-Icon`,
   *  which the file list draws in front of the row rather than the plain globe.
   *
   *  The same shape as the icons above and for the same reason: a space holds a
   *  handful of websites, so the map is the size of what is there rather than of the
   *  space, and a row redraws by itself the moment the file's `Nib-Icon` changes -
   *  which is what makes a favicon a page found land in the tree without the row being
   *  told. It is kept apart from `icons` because a favicon is an address the row draws
   *  as a picture, not an icon name icons.ts reads. See file-mark and web-tab. */
  private readonly favicons = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const note of this.notes) {
      if (note.favicon) map.set(note.path, note.favicon)
    }

    return map
  })

  /** The notes that carry a cover, by path.
   *
   *  The same shape and the same reason as the icons: a handful of a space, asked
   *  by a lookup rather than a walk, and derived so the row's own menu says Change
   *  rather than Set the moment a cover is written - without the tree being told.
   *  Only which picture, not where its band sits: what asks this is a menu deciding
   *  between three words. See cover.ts in @nib/markdown. */
  private readonly covers = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const note of this.notes) {
      if (note.cover) map.set(note.path, note.cover)
    }

    return map
  })

  /** What the note at this path says it wears, as written, or null where it says
   *  nothing. The value is read in icons.ts, which knows the conventions.
   *
   *  Takes a path as the app holds one or as the index speaks it, because the
   *  surfaces that show a file disagree: a row in the tree knows where the file
   *  is on the disk, and a bookmark or a search hit knows it relative to the
   *  space. */
  iconOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.icons.get(relative) ?? null
  }

  /** The picture across the top of the note at this path, as written, or null where
   *  it has none. Takes either spelling of a path, like the two around it. */
  coverOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.covers.get(relative) ?? null
  }

  /** The colour that icon is drawn in, or null for the plain foreground. */
  tintOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.tints.get(relative) ?? null
  }

  /** The address the note at this path points at, or null for a note that is prose.
   *  Takes either spelling of a path, like the two above. */
  urlOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.addresses.get(relative) ?? null
  }

  /** The site's own mark for the website at this path, as an address, or null where
   *  there is none - a website nobody has followed a link out of yet, or anything
   *  that is not one. Drawn as a picture in front of the row; see FileMark.svelte.
   *  Takes either spelling of a path, like the icon above it. */
  faviconOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.favicons.get(relative) ?? null
  }

  /** Whether this space still holds a website written as a note, which is what the
   *  palette's Convert row is offered for. Reactive, so the row goes as the last one
   *  is converted. */
  get websiteNotes(): boolean {
    return this.addresses.size > 0
  }

  /** Forgets everything, for a window with no space open.
   *
   *  A scan still in the air is forgotten with the rest: it finds no space of its
   *  own to land in and says nothing, so the state that says one is being read has
   *  to come down here rather than wait for a landing that never comes. */
  clear() {
    this.root = null
    this.scanning = false
    this.notes = []
    this.files = []
    this.since = []
    this.changed()
  }

  private changed() {
    this.read.clear()
    this.resolved.clear()
    this.version++
  }

  /** The file that has just been written, read again from the text that was
   *  written. One file rather than the space: this runs on every save.
   *
   *  A canvas counts, because the notes its file nodes name are links out of it;
   *  see `canvasRead`. */
  noteSaved(path: string, content: string) {
    const relative = this.relative(path)
    if (!relative) return

    // A page note too: its pages are file nodes naming the PDF behind them, which
    // is a link out of it exactly as a canvas's cards are.
    if (isCanvasTarget(relative) || isPagesTarget(relative)) {
      this.putCanvas(relative, content)
      return
    }

    // A website is a file the app writes as well: the keeper brings the `.url` up to
    // date as the reading moves, and the site's own mark arrives in it a moment after
    // the page loads. The row in the file list draws that mark rather than the plain
    // globe, so it has to be read in here - nothing rescans a space while it is open,
    // and the row would otherwise wear the globe until the next launch. See
    // web-tab/keep.ts and scanShortcut.
    if (isWebTarget(relative)) {
      this.put(scanShortcut(relative, content))
      return
    }

    if (!isMarkdownPath(relative)) return

    this.put(scanNote(relative, content))
    // What was written is what the note says, so an embed of it needs no read.
    this.read.set(relative, content)
  }

  /** A canvas that has just been opened, so the panel can say what it points at
   *  before anybody has saved it.
   *
   *  Only the canvases somebody has opened or written are in the index: the scan
   *  of a space reads the notes and lists the other files by name, and reading
   *  every canvas in a space to find its file nodes would be a second pass over
   *  the disk for a panel that is about the file on screen. */
  canvasRead(path: string, content: string) {
    const relative = this.relative(path)
    if (!relative || !(isCanvasTarget(relative) || isPagesTarget(relative))) return

    this.putCanvas(relative, content)
  }

  /** A plane into the index, through the reader that is fetched with the first one.
   *
   *  Reading a canvas means the whole JSON Canvas format, and a window that opens on a
   *  note has no plane to read: so it is asked for here rather than carried, and the
   *  index takes the file's links a moment later than it takes a note's. Nothing waits
   *  on it - the panel that shows them is drawn from the index as it changes - and
   *  there is nothing to wait for on the second plane. See scan-canvas.ts. */
  private putCanvas(relative: string, content: string) {
    // The reader is fetched, so a space can open between the asking and the
    // reading. The path was read against the space that was open then, and a plane
    // of the space before this one has no place in this one's index - less than
    // ever now that a save lands on top of a scan rather than under it, since a
    // stale row put here would be replayed over the rows the new space brings
    // back. See `edit`.
    const mine = this.scans
    void import('./scan-canvas').then(({ scanCanvas }) => {
      if (this.scans === mine) this.put(scanCanvas(relative, content))
    })
  }

  /** One scanned file into the index, replacing whatever was there under its
   *  path. */
  private put(scanned: ScannedNote) {
    this.edit((notes) => {
      const at = notes.findIndex((note) => note.path === scanned.path)

      return at === -1
        ? [...notes, scanned]
        : [...notes.slice(0, at), scanned, ...notes.slice(at + 1)]
    })
  }

  /** A note that has gone. */
  noteGone(path: string) {
    const relative = this.relative(path)
    if (!relative) return

    // A scan in the air is told whatever it did not see, and this is the shape of
    // that: nothing here to take away, and a row for it on its way back. Without
    // the second half a note deleted in a space's first second came back with the
    // rows and stayed in `[[` until the next launch.
    const gone = (notes: readonly ScannedNote[]) =>
      notes.filter((note) => note.path !== relative && !note.path.startsWith(`${relative}/`))

    if (!this.scanning && gone(this.notes).length === this.notes.length) return

    this.edit(gone)
  }

  /** A note or a folder that has moved. The links inside the notes that moved
   *  are unchanged; only where they live is. */
  notesMoved(from: string, to: string) {
    const was = this.relative(from)
    const now = this.relative(to)
    if (!was || !now) return

    this.edit((notes) =>
      notes.map((note) => {
        if (note.path !== was && !note.path.startsWith(`${was}/`)) return note
        const path = now + note.path.slice(was.length)
        return { ...note, path, name: noteName(path) }
      }),
    )
  }

  /** A path the app holds as one the index speaks in, or null for a note that
   *  lives outside the open space - a file opened from elsewhere, which has no
   *  place in a space's links. */
  private relative(path: string): string | null {
    const root = this.root
    return root && path.startsWith(root) ? relativeTo(root, path) : null
  }

  /** What the editor is handed: the notes, which one is open, and a way to read
   *  one. A fresh object each time the index changes and the same one otherwise,
   *  which is what decides whether every link on screen is redrawn. */
  index(openPath: string | null): NoteIndex {
    const path = openPath === null ? null : this.relative(openPath)

    // One object per open note rather than one in all. A pane going back to a
    // note it was on a moment ago is handed the same object it had before, so
    // switching between two tabs does not redraw every link in either of them.
    if (this.handedAt !== this.version) {
      this.handedAt = this.version
      this.handed.clear()
    }

    const key = path ?? ''
    const known = this.handed.get(key)
    if (known) return known

    const made: NoteIndex = {
      notes: this.refs,
      files: this.files,
      path,
      read: (wanted) => this.readNote(wanted),
      // What the `#` popup offers, and what `[[^^` asks the space for. Both go
      // with the rest of what the space holds rather than through a facet of
      // their own, for the same reason the query fence does: they are the same
      // fact, and they are replaced when it changes.
      tags: this.spaceTags,
      searchBlocks: (text, most) => this.searchBlocks(text, most),
      // What a ` ```query ` fence in the note answers with, and what a row in it
      // opens. Handed over with the rest of what the space holds, so a fence is
      // answered again whenever a note is saved: this object is remade then, and a
      // widget holding the old one is not equal to one holding the new.
      query: (code) => queryRowsHtml(code, t('Nothing found')),
      pressRow: (target) => pressRow(target),
      // How a note the editor shows rather than edits is rendered: an embed, and
      // the preview over a link. The reading view's own call, so one render
      // serves every place a note is read; see reading/render.ts.
      render: (source, from) => this.shownHtml(source, from),
      // A page of a paper and a plane, drawn inside the card that stands for one.
      // The reading view's own drawing, so a note shows the same page in the same
      // frame whichever face it is read on; see reading/drawn.ts. Handed over with
      // the rest of what the space holds for the reason a query fence is: a paper
      // replaced on disk or a plane saved in the tab beside this one is a drawing
      // that has to be made again, and this object being remade is what says so.
      drawFile: (card, file) => this.drawnFile(card, file),
    }
    this.handed.set(key, made)
    return made
  }

  /** One card filled in with the file it names. Nothing to draw for a note opened
   *  from outside any space: the path a card asks about is relative to a space, and
   *  there is no space to read it against. */
  private drawnFile(card: HTMLElement, file: FileDrawing): () => void {
    const root = this.root
    return root === null ? () => undefined : drawFile(card, { ...file, root })
  }

  /** One note as the HTML that shows it, for the editor: the note inside an
   *  `![[embed]]`, and the note behind a hover preview. The reading view's own
   *  call, with the reading view's own options - there is one such call in the
   *  app, which is what keeps a note glanced at from being a thinner rendering of
   *  the note read.
   *
   *  `from` is a path relative to the space, which is what a link speaks in; the
   *  render wants the path the app holds, since that is what resolves a picture
   *  and reaches the space a wikilink points into. A note outside the open space
   *  has no place here and is rendered as a note with no home, exactly as the
   *  reading view renders one.
   *
   *  Everything is asked for where it is used rather than imported at the top.
   *  The reading view's render reaches back into this index for the notes an embed
   *  names and for what a query fence answers, and the sharing store reaches the
   *  workspace, which reaches this file: either written statically is a cycle. */
  private async shownHtml(source: string, from: string | null): Promise<string> {
    const [{ readingHtml }, { theme }, { trustsHtmlAt }] = await Promise.all([
      import('./reading/render'),
      import('./theme.svelte'),
      import('./sharing.svelte'),
    ])

    const root = this.root
    const path = from === null || root === null ? null : insideSpace(root, from)

    return readingHtml({ text: source, path }, theme.current, trustsHtmlAt(path))
  }

  private readonly handed = new Map<string, NoteIndex>()
  /** Which version of the space the objects above describe. */
  private handedAt = -1

  /** One note's text, for an embed or a hover preview. Kept for a moment after
   *  it arrives, because a screen of embeds asks for the same few notes. */
  private async readNote(relative: string): Promise<string | null> {
    const held = this.read.get(relative)
    if (held !== undefined) return held

    const root = this.root
    if (!root) return null

    const text = await invoke<string>('read_note', {
      path: insideSpace(root, relative),
    }).catch(() => null)
    if (text === null) return null

    // Oldest out first, so a long session does not hold a whole space in hand.
    if (this.read.size >= CACHED) {
      const oldest = this.read.keys().next().value
      if (oldest !== undefined) this.read.delete(oldest)
    }
    this.read.set(relative, text)

    return text
  }

  /** What each target has already been found to mean, keyed by the folder it was
   *  written in - which is the only thing about the source note that decides the
   *  answer. Cleared whenever the space changes.
   *
   *  Resolving a name walks every note, and a space where four hundred notes link
   *  to the same one asks the same question four hundred times: with this it is
   *  asked once per folder, which is what makes opening the panel a few
   *  milliseconds rather than a fifth of a second. */
  private resolved = new Map<string, string | null>()

  /** Every note by the last part of its path, folded. Only a note whose own name
   *  is the last thing a target says can be what that target means, whichever way
   *  it is spelled: `[[Plan]]`, `[[ideas/Plan]]` and `[x](../ideas/Plan.md)` all
   *  end in the note's name. So resolving asks this for the handful of candidates
   *  rather than walking the space for each link.
   *
   *  What that is worth: the graph of a space of two thousand notes resolves four
   *  thousand links, and walking every note for each of them took a second and a
   *  half. */
  private readonly byName = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, NoteRef[]>()

    for (const ref of this.refs) {
      // Under its own name, and under every other name it gave itself, or a
      // link by an alias would never reach the resolver at all.
      for (const key of namesOf(ref)) {
        const held = map.get(key)
        if (held) held.push(ref)
        else map.set(key, [ref])
      }
    }

    return map
  })

  /** Which note, which PDF or which canvas a link in `source` points at.
   *
   *  A PDF and a canvas resolve through the files rather than the notes: they are
   *  what a link can open beside a note, so a note that links a paper or a plane
   *  is a note that links somewhere. Anything else beside the notes stays
   *  unresolved. */
  /** Where a link written in one note points, as a path relative to the space,
   *  or null for a link the space cannot answer.
   *
   *  The one way in for every surface that draws a link, so that all of them get
   *  the name index and the memo above rather than only the editor. What it is
   *  worth: the reading view used to resolve each link by filtering every note in
   *  the space, so a note of twenty thousand lines with eighteen hundred links in
   *  it compared nine million paths to draw one page - 1.7 seconds of the five it
   *  took, all of it in `comparable`. Through here it is one lookup per distinct
   *  target and nothing at all for a target already seen.
   *
   *  `from` is an absolute path, the way a tab holds one, or null for a note with
   *  no home yet. */
  targetOf(from: string | null, link: { kind: LinkKind; target: string }): string | null {
    return this.resolveFrom(from === null ? null : this.relative(from), link)
  }

  /** How many notes the resolver has compared paths with, ever - a running total,
   *  read as a difference either side of whatever is being asked about.
   *
   *  Counted rather than timed, for the reason fuzzy.ts gives beside its own
   *  counters: a clock says what the machine was doing and a count says what the
   *  code did. That this is the number of links rather than the number of links
   *  times the size of the space is the whole of the paragraph above, and it is
   *  asserted in link-index.test.ts. */
  examined = 0

  private resolveFrom(
    source: string | null,
    link: { kind: LinkKind; target: string },
  ): string | null {
    if (!link.target) return null

    // A note with no home of its own is not the same question as a note at the
    // root of the space: the first has no folder to be beside, and `nearest`
    // reads the two differently. So they are not one another's answer.
    const where = source === null ? '\0nowhere' : folderOf(source)
    const key = `${where}\0${link.kind}\0${link.target}`
    const held = this.resolved.get(key)
    if (held !== undefined) return held

    const found = isTabFile(link.target)
      ? resolveFile(this.spaceFiles(source), link.target, link.kind)
      : this.noteFrom(source, link)

    this.resolved.set(key, found)
    return found
  }

  private noteFrom(source: string | null, link: { kind: LinkKind; target: string }): string | null {
    // Only the notes the target could name at all; see `byName`.
    const last = comparable(link.target).split('/').pop() ?? ''
    const candidates = this.byName.get(last) ?? []
    this.examined += candidates.length

    const index: NoteIndex = {
      notes: candidates,
      files: [],
      path: source,
      read: nothing,
    }
    const found =
      link.kind === 'markdown'
        ? resolveRelative(index, link.target)
        : resolveNote(index, link.target)

    return found?.path ?? null
  }

  /** The space's files as a link resolver sees them, from one note's point of
   *  view: `source` is what a relative markdown target folds against. */
  private spaceFiles(source: string | null): NoteIndex {
    return { notes: [], files: this.files, path: source, read: nothing }
  }

  /** Whether a link could name the note at `path`, before anything is resolved.
   *  The last part of a target has to be the note's own name for either spelling
   *  to reach it, which turns twenty thousand links into twenty thousand string
   *  comparisons and a handful of lookups. */
  private couldName(link: { target: string }, names: ReadonlySet<string>): boolean {
    if (!link.target) return false
    const last = comparable(link.target).split('/').pop() ?? ''
    return names.has(last)
  }

  /** Every name a note in the space answers to, by its path relative to the
   *  space. Its own name where the space has never heard of it. */
  private namesFor(relative: string): ReadonlySet<string> {
    const note = this.notes.find((one) => one.path === relative)
    return namesOf(note ?? { path: relative, aliases: [] })
  }

  /** Every link in the space that points at this note. */
  backlinks(path: string): Reference[] {
    const relative = this.relative(path)
    if (!relative) return []

    // Its own name and every other name it answers to, so a link written with an
    // alias counts as a link here.
    const names = this.namesFor(relative)
    const out: Reference[] = []

    for (const note of this.notes) {
      if (note.path === relative) continue

      for (const link of note.links) {
        if (!this.couldName(link, names)) continue
        if (this.resolveFrom(note.path, link) !== relative) continue
        out.push({ path: note.path, name: nameOf(note.path), line: link.line, text: link.text })
      }
    }

    return out
  }

  /** Every link out of this note, resolved. */
  outgoing(path: string): Outgoing[] {
    const relative = this.relative(path)
    const note = this.notes.find((one) => one.path === relative)
    if (!relative || !note) return []

    return note.links
      .filter((link) => link.target)
      .map((link) => {
        const to = this.resolveFrom(relative, link)
        return {
          path: relative,
          name: nameOf(to ?? link.target),
          line: link.line,
          text: link.text,
          target: link.target,
          to,
        }
      })
  }

  /** Lines elsewhere in the space that write this note's name without linking to
   *  it. Asked of the space search rather than of the index: a mention is any text
   *  at all, and searching a space is what that already is.
   *
   *  Through `searchSpace`, which is the one road to it: the desktop's walk is
   *  behind the Rust crate and the browser's is in a worker, and both of them take
   *  a parsed query rather than a word. Asking either of them for a bare string was
   *  asking for a shape neither could read, so this answered with nothing at all
   *  and the panel showed no mentions. It also means the notes the space leaves out
   *  are left out of this too, which is the point of leaving them out. */
  async unlinked(path: string, root: string): Promise<Reference[]> {
    const relative = this.relative(path)
    if (!relative) return []

    // Its own name, and every other name it answers to: somebody writing the
    // alias has mentioned this note as surely as somebody writing the filename.
    //
    // The name as the app shows it, which is the name a reader would have written in
    // their prose: a canvas was looked for as `Board.canvas` and so a plane nobody
    // spells that way had no mentions at all.
    const note = this.notes.find((one) => one.path === relative)
    const written = [shownName(nameOf(relative)), ...(note?.aliases ?? [])]
      .map((one) => one.trim())
      .filter((one) => one.length >= 2)
    if (!written.length) return []

    // Quoted, so a name of two words is one phrase rather than two words that may
    // be anywhere; a quote inside a name is escaped the way the grammar escapes
    // one. See search/query.ts.
    const found: Hit[] = []
    await Promise.all(
      written.map((one) =>
        searchSpace(
          root,
          parseQuery(`"${one.replace(/(["\\])/g, '\\$1')}"`),
          [],
          MOST_MENTIONS,
          (batch) => found.push(...batch.hits),
        ).catch(() => undefined),
      ),
    )

    const linked = new Set(
      this.backlinks(path).map((reference) => `${reference.path}\0${reference.line}`),
    )
    const needles = written.map((one) => one.toLowerCase())
    // One line mentioning two of the names is one mention of the note. A list
    // rather than a set: a few hundred lines come back at most, and a set in a
    // reactive file would have to be a reactive one for no reason at all.
    const seen: string[] = []

    return (
      found
        .map((hit) => ({
          path: this.relative(hit.path) ?? hit.path,
          name: hit.name,
          line: hit.line,
          text: hit.text,
        }))
        .filter((hit) => hit.path !== relative)
        // A line that already links here is a backlink, not a mention of one.
        .filter((hit) => !linked.has(`${hit.path}\0${hit.line}`))
        // And the name has to stand as a word rather than inside a longer one.
        .filter((hit) => needles.some((needle) => standsAlone(hit.text.toLowerCase(), needle)))
        .filter((hit) => {
          const key = `${hit.path}\0${hit.line}`
          if (seen.includes(key)) return false
          seen.push(key)
          return true
        })
    )
  }

  /** Rewrites every link to `from` so it points at `to`, in every note of the
   *  space, and returns how many notes were touched.
   *
   *  Each note keeps one snapshot of what it said before, so the rewrite shows up
   *  in the version history of every note it touched and can be undone note by
   *  note there as well as through the file undo. */
  async retarget(from: string, to: string, root: string): Promise<number> {
    const was = this.relative(from)
    const now = this.relative(to)
    if (!was || !now || was === now) return 0

    // The file's own name and nothing else. A rename rewrites the links that
    // spelled out the name that changed; a link written with an alias still says
    // what the note still answers to, so rewriting it would turn a name the
    // writer chose into a filename they did not.
    const byFile = new Set([comparable(nameOf(was))])
    const move = { from: was, to: now }
    let touched = 0

    for (const note of [...this.notes]) {
      // Whether this note is worth reading at all, decided from the index.
      const candidates = note.links.filter((link) => this.couldName(link, byFile))
      if (!candidates.length) continue
      if (!candidates.some((link) => this.resolveFrom(note.path, link) === was)) continue

      const absolute = insideSpace(root, note.path)
      const before = await invoke<string>('read_note', { path: absolute }).catch(() => null)
      if (before === null) continue

      const points = (link: FoundLink) => this.resolveFrom(note.path, link) === was
      const after = rewriteLinks(before, note.path, move, points)
      if (after === null || after === before) continue

      await invoke('snapshot_note', { path: absolute, content: before }).catch(() => undefined)
      await invoke('write_note', { path: absolute, content: after })

      this.notes = this.notes.map((one) =>
        one.path === note.path ? scanNote(note.path, after) : one,
      )
      touched++
    }

    if (touched) this.changed()
    return touched
  }

  /** Blocks anywhere in the space whose words hold `text`: what the editor's
   *  `[[^^` offers past the blocks that already carry a name.
   *
   *  Through `searchSpace`, which is the one road to a space's words - the
   *  desktop's walk is behind the Rust crate and the browser's is in a worker,
   *  with the bodies already in hand - so this costs one search and never a read
   *  per note. Asked once per `^^`, not once per keystroke: the popup filters what
   *  came back as more is typed. See wikilink/complete.ts in the editor.
   *
   *  Quoted, so a phrase of two words is one phrase; the notes the space leaves
   *  out are left out of this too, the way they are left out of the search and the
   *  graph. */
  async searchBlocks(text: string, most: number): Promise<SpaceBlock[]> {
    const root = this.root
    const needle = text.trim()
    if (!root || needle.length < 2) return []

    const { workspace } = await import('./workspace.svelte')
    const found: Hit[] = []

    await searchSpace(
      root,
      parseQuery(`"${needle.replace(/(["\\])/g, '\\$1')}"`),
      [],
      most,
      (batch) => found.push(...batch.hits),
      workspace.excluded.of(root),
    ).catch(() => undefined)

    return (
      found
        // A paper has pages rather than blocks and nothing to write a name into.
        .filter((hit) => hit.page === undefined)
        .slice(0, most)
        .map((hit) => ({
          path: this.relative(hit.path) ?? hit.path,
          line: hit.line,
          // The name a block already carries is a marker and not a word of the
          // row; the link writes it, and nothing that shows a note shows it.
          text: withoutBlockIds(hit.text).trim(),
          id: blockIdOf(hit.text),
        }))
    )
  }

  /** Gives a block of another note a name, so a link can point at the block.
   *  Called by the editor's `[[…#^` completion, which has nowhere else to get
   *  one: the block is in a note that is not open. */
  async nameBlock(relative: string, line: number, root: string): Promise<string | null> {
    const absolute = insideSpace(root, relative)
    const before = await invoke<string>('read_note', { path: absolute }).catch(() => null)
    if (before === null) return null

    const lines = before.split('\n')
    // The name goes at the end of the block, which is the last line of the run
    // that starts at `line`.
    let end = line
    while (end + 1 < lines.length && (lines[end + 1] ?? '').trim()) end++

    const existing = blockIdOf(lines[end] ?? '')
    if (existing) return existing

    const taken = new Set(blockIds(before).map((one) => one.id))
    const id = freeBlockId(taken)

    lines[end] = `${(lines[end] ?? '').trimEnd()} ^${id}`
    const after = lines.join('\n')

    await invoke('snapshot_note', { path: absolute, content: before }).catch(() => undefined)
    await invoke('write_note', { path: absolute, content: after })

    this.noteSaved(absolute, after)
    return id
  }

  /** The note an embed names, for an export: the renderer cannot wait on a disk,
   *  so the notes a document embeds are read before it is rendered. */
  async embedSource(target: string, from: string | null): Promise<string | null> {
    const source = from === null ? null : this.relative(from)
    const found = this.resolveFrom(source ?? '', { kind: 'wikilink', target })

    return found === null ? null : this.readNote(found)
  }

  /** Where a `[[wikilink]]` points, as a path relative to the note it is written
   *  in, or null when the space holds no such note.
   *
   *  What the markdown export writes in place of the brackets: no other editor
   *  knows what they mean, and a link nobody can follow is worse than the words
   *  the link showed. The same resolution the editor's own links get, so the
   *  export points where the app does.
   *
   *  `from` is the note's path as the app holds it; a note opened from outside
   *  the space has no place in the index and resolves to nothing. */
  relativeTarget(link: FoundLink, from: string | null): string | null {
    const source = from === null ? null : this.relative(from)
    if (source === null) return null

    const found = this.resolveFrom(source, link)
    return found === null ? null : relativePath(folderOf(source), found)
  }

  /** Where a picture named by `![[picture.png]]` lives, when the space holds one
   *  by that name. Obsidian finds an attachment wherever it is; without this the
   *  name would only work for a picture beside the note.
   *
   *  The same reading a link to a PDF gets, so a file is found one way whichever
   *  of the two named it. */
  fileNamed(name: string): string | null {
    return resolveFile(this.spaceFiles(null), name, 'wikilink')
  }

  /** A file that was not there when the space was read: a recording the app has just
   *  written beside a note.
   *
   *  The notes look after themselves - every save goes through `noteSaved` - and until
   *  now nothing but a fresh scan of the whole space ever added a file. A recording
   *  cannot wait for one: the embed naming it is written into the note in the same
   *  breath, and a name the index has never heard of resolves to nothing and draws no
   *  player. So one path, appended, kept in the order a walk would have found it in.
   *
   *  Relative to the space's root, which is how a walk reports one. */
  fileAdded(relative: string) {
    if (!relative || this.files.includes(relative)) return

    this.files = [...this.files, relative].sort()
    this.changed()
  }
}

const nothing = () => Promise.resolve(null)

/** Whether a name stands as a word in a line rather than inside a longer one, so
 *  a note called `Plan` is not mentioned by the word `Planning`. */
function standsAlone(line: string, name: string): boolean {
  const word = /[\p{L}\p{N}]/u
  let at = line.indexOf(name)

  while (at !== -1) {
    const before = line[at - 1]
    const after = line[at + name.length]
    if (!(before && word.test(before)) && !(after && word.test(after))) return true
    at = line.indexOf(name, at + 1)
  }

  return false
}

export const links = new Links()
