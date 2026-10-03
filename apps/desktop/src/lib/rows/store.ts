/** The rows of every space: a row per note and a row per task line, kept current.
 *
 *  What Today, Upcoming, a board and a reminder ask, and what they ask it of: a view
 *  never reads a file (docs/tasks.md 5.3). Built from the pass that already reads a
 *  space, `scan_links`, which carries each note's front matter and task lines raw; the
 *  open space's is the link index's own scan, taken rather than made again, and every
 *  other space is read once after the launch order, one at a time with a breath between
 *  them. From then on one file at a time: a save re-reads the note that was written,
 *  and a file operation (workspace/file-ops.ts) moves or drops the rows of the files it
 *  names. Nothing here walks a space twice, and nothing here runs per keystroke.
 *
 *  Plain rather than reactive, and told rather than asking: whoever draws rows listens
 *  (`watch`) and hears which file's rows changed, so a view moves the rows of one note
 *  between its groups rather than answering the whole space again. Its links to the
 *  rest of the app come in as a `Host`, so the store is tested without one; see
 *  start.svelte.ts for the app's. */

import type { Row } from '@nib/bases'
import type { ScannedNote, SpaceLinks } from '../scan-note'
import { scanNote } from '../scan-note'
import { scanRows } from '../scan-rows'
import { insideSpace, isMarkdownPath, pathKey, samePath, within } from '../space-paths'
import { type FileOp } from '../workspace/file-ops'
import { movedRows, type NoteRead, rowsOf } from './build'

/** A space as the store is told of it. */
export interface SpaceName {
  root: string
  name: string
}

/** One file's rows changing, or a whole space's when `path` is null: the space read,
 *  renamed or gone. `removed` and `added` are the rows before and after. */
export interface RowsChange {
  root: string
  space: string
  path: string | null
  removed: readonly Row[]
  added: readonly Row[]
}

export type RowsListener = (change: RowsChange) => void

/** What the store needs of the app. */
export interface Host {
  /** A space read whole, or a folder of one: `scan_links`. */
  scan(root: string): Promise<SpaceLinks | null>
  /** One file's words. */
  read(path: string): Promise<string | null>
  /** The link index of the open space, whose scan is the open space's rows. */
  open(): { root: string | null; scanned(): Promise<void>; notes(): readonly ScannedNote[] }
  /** Hands the thread back inside a long pass. */
  breathe(): Promise<void>
  /** Milliseconds since the epoch, for a note just written. */
  now(): number
}

/** How many notes are made into rows between two breaths. */
const CHUNK = 250

interface Held {
  root: string
  name: string
  /** By `pathKey` of the note's path within the space. */
  files: Map<string, Row[]>
  /** Every row of the space in one list, made when first asked for after a change. */
  flat: Row[] | null
  /** Whether the space is being read, and what it was told meanwhile, to be told
   *  again over what the read brings back. */
  reading: boolean
  since: ((files: Map<string, Row[]>) => void)[]
}

export class RowsStore {
  private readonly spaces = new Map<string, Held>()
  private readonly listeners = new Set<RowsListener>()
  /** Spaces waiting for their read, one at a time. */
  private readonly queue: Held[] = []
  private draining = false

  constructor(private readonly host: Host) {}

  /** Every row of one space, by its name or its root, or of every space. The same
   *  list until something in it changes. */
  of(space?: string): readonly Row[] {
    if (space === undefined) return [...this.spaces.values()].flatMap((held) => this.flat(held))

    const held = [...this.spaces.values()].find(
      (one) => one.name === space || samePath(one.root, space),
    )
    return held ? this.flat(held) : []
  }

  /** The rows of one note, by its path as the app holds it. */
  at(path: string): readonly Row[] {
    const held = this.holding(path)
    if (!held) return []
    const relative = within(held.root, path, held.root)
    return relative === null ? [] : (held.files.get(pathKey(relative, held.root)) ?? [])
  }

  /** The space a row is in, by its root. */
  rootOf(row: Row): string | null {
    return [...this.spaces.values()].find((one) => one.name === row.space)?.root ?? null
  }

  /** Whether every space told of has been read. */
  get ready(): boolean {
    return [...this.spaces.values()].every((one) => !one.reading) && !this.queue.length
  }

  /** Hears every change from now on. Answers the way to stop. */
  watch(listener: RowsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The spaces there are now. A new one is read in its turn; one that went is
   *  forgotten; one renamed keeps its rows under its new name. Decides from what it is
   *  handed, so an effect may call it. */
  spacesAre(spaces: readonly SpaceName[]) {
    for (const [key, held] of this.spaces) {
      if (!spaces.some((one) => samePath(one.root, held.root))) this.forget(key)
    }

    for (const space of spaces) {
      const held = this.spaces.get(pathKey(space.root))
      if (!held) {
        this.add(space)
        continue
      }
      if (held.name !== space.name) this.rename(held, space.name)
    }
  }

  /** A file the app has just written, in any space: its rows read again from what was
   *  written. */
  saved(path: string, content: string) {
    const held = this.holding(path)
    if (!held) return
    const relative = within(held.root, path, held.root)
    if (relative === null || !isMarkdownPath(relative)) return

    const key = pathKey(relative, held.root)
    const now = this.host.now()
    this.edit(held, key, (before) => {
      // A creation time the scan never knew is the moment it was first written here.
      const known = before?.[0]?.file.ctime ?? 0
      const ctime = known > 0 ? known : now
      const stamp = { size: content.length, mtime: now, ctime }
      return rowsOf(
        held.name,
        readOf({ ...scanNote(relative, content), ...scanRows(content), stamp }),
      )
    })
  }

  /** A file operation, heard as everything kept by path hears one. */
  follow(op: FileOp): Promise<void> | undefined {
    if (op.op === 'removed') {
      if (op.kind === 'space') this.forget(pathKey(op.path))
      else this.gone(op.path)
      return undefined
    }

    if (op.op === 'moved') {
      if (op.kind === 'space') this.spaceMoved(op.from, op.to)
      else if (this.moved(op.from, op.to)) return undefined
      // Into a space still being read, or out of one: the rows in hand are not the
      // whole of it, so what arrived is read again where it is now.
      else return op.kind === 'folder' ? this.folderCame(op.to) : this.fileCame(op.to)
      return undefined
    }

    return op.kind === 'folder' ? this.folderCame(op.path) : this.fileCame(op.path)
  }

  private flat(held: Held): Row[] {
    held.flat ??= [...held.files.values()].flat()
    return held.flat
  }

  private holding(path: string): Held | null {
    for (const held of this.spaces.values()) {
      if (within(held.root, path, held.root) !== null) return held
    }
    return null
  }

  private tell(change: RowsChange) {
    for (const listener of this.listeners) listener(change)
  }

  /** One file's rows replaced, made now and again over a read in the air. */
  private edit(held: Held, key: string, next: (before: Row[] | undefined) => Row[] | null) {
    const change = (files: Map<string, Row[]>) => {
      const rows = next(files.get(key))
      if (!rows?.length) files.delete(key)
      else files.set(key, rows)
    }
    if (held.reading) held.since.push(change)

    const before = held.files.get(key) ?? []
    change(held.files)
    held.flat = null
    const after = held.files.get(key) ?? []
    const path = after[0]?.path ?? before[0]?.path ?? key
    this.tell({ root: held.root, space: held.name, path, removed: before, added: after })
  }

  private add(space: SpaceName) {
    const held: Held = {
      root: space.root,
      name: space.name,
      files: new Map(),
      flat: null,
      reading: true,
      since: [],
    }
    this.spaces.set(pathKey(space.root), held)
    this.queue.push(held)
    void this.drain()
  }

  private forget(key: string) {
    const held = this.spaces.get(key)
    if (!held) return
    this.spaces.delete(key)
    const removed = this.flat(held)
    this.tell({ root: held.root, space: held.name, path: null, removed, added: [] })
  }

  private rename(held: Held, name: string) {
    const removed = this.flat(held)
    held.name = name
    for (const [key, rows] of held.files)
      held.files.set(
        key,
        rows.map((row) => ({ ...row, space: name })),
      )
    held.flat = null
    this.tell({ root: held.root, space: name, path: null, removed, added: this.flat(held) })
  }

  private spaceMoved(from: string, to: string) {
    const held = this.spaces.get(pathKey(from))
    if (!held) return
    this.spaces.delete(pathKey(from))
    held.root = to
    this.spaces.set(pathKey(to), held)
  }

  /** The files under a path that went, rows and all. */
  private gone(path: string) {
    const held = this.holding(path)
    if (!held) return
    const at = within(held.root, path, held.root)
    if (at === null) return

    // What the read in the air brings back is told it went as well.
    if (held.reading) {
      held.since.push((files) => {
        for (const [key, rows] of files) {
          const under = rows[0]?.path
          if (under !== undefined && within(at, under, held.root) !== null) files.delete(key)
        }
      })
    }
    for (const key of this.keysUnder(held, at)) this.edit(held, key, () => null)
  }

  /** A file or a folder renamed or moved, perhaps into another space: its rows go
   *  with it, saying where they are now. Answers false where the rows in hand cannot
   *  be carried, because a space either side is still being read; the caller reads
   *  what arrived instead. */
  private moved(from: string, to: string): boolean {
    const was = this.holding(from)
    const now = this.holding(to)
    if (!was) return !now
    const at = within(was.root, from, was.root)
    const there = now ? within(now.root, to, now.root) : null
    if (at === null) return true

    if (was.reading || now?.reading) {
      this.gone(from)
      return !now
    }

    for (const key of this.keysUnder(was, at)) {
      const rows = was.files.get(key) ?? []
      const path = rows[0]?.path
      this.edit(was, key, () => null)
      if (!now || there === null || path === undefined) continue

      const rest = within(at, path, was.root) ?? ''
      const moved = rest ? (there ? `${there}/${rest}` : rest) : there
      this.edit(now, pathKey(moved, now.root), () => movedRows(rows, moved, now.name))
    }
    return true
  }

  /** The keys of every note at or under a path within a space. */
  private keysUnder(held: Held, at: string): string[] {
    const keys: string[] = []
    for (const [key, rows] of held.files) {
      const path = rows[0]?.path
      if (path !== undefined && within(at, path, held.root) !== null) keys.push(key)
    }
    return keys
  }

  /** A note that came: a delete undone, a copy, a file put back from the trash. */
  private async fileCame(path: string) {
    const held = this.holding(path)
    if (!held || !isMarkdownPath(path)) return
    const content = await this.host.read(path)
    if (content !== null) this.saved(path, content)
  }

  /** A folder that came, read the way its space was. */
  private async folderCame(path: string) {
    const held = this.holding(path)
    if (!held) return
    const at = within(held.root, path, held.root)
    const found = await this.host.scan(path)
    if (!found || at === null || this.spaces.get(pathKey(held.root)) !== held) return

    for (const note of found.notes) {
      const relative = at ? `${at}/${note.path}` : note.path
      if (!isMarkdownPath(relative)) continue
      this.edit(held, pathKey(relative, held.root), () =>
        rowsOf(held.name, readOf({ ...note, path: relative })),
      )
    }
  }

  /** The spaces waiting for their read, one at a time with a breath between them. */
  private async drain() {
    if (this.draining) return
    this.draining = true
    try {
      for (let held = this.queue.shift(); held; held = this.queue.shift()) {
        await this.read(held).catch(() => undefined)
        held.reading = false
        await this.host.breathe()
      }
    } finally {
      this.draining = false
    }
  }

  /** One space read whole: the link index's scan where it is the open space, a scan of
   *  its own otherwise. */
  private async read(held: Held) {
    const notes = await this.notesOf(held)
    if (this.spaces.get(pathKey(held.root)) !== held) return

    const files = new Map<string, Row[]>()
    let counted = 0
    for (const note of notes) {
      if (!isMarkdownPath(note.path)) continue
      if (note.tasks === undefined) {
        // Saved since the index's scan, which the index read again without what the
        // rows need: read once more, here.
        const content = await this.host.read(insideSpace(held.root, note.path))
        if (content !== null) {
          const stamp = { size: content.length, mtime: this.host.now(), ctime: this.host.now() }
          files.set(
            pathKey(note.path, held.root),
            rowsOf(held.name, readOf({ ...note, ...scanRows(content), stamp })),
          )
        }
      } else {
        files.set(pathKey(note.path, held.root), rowsOf(held.name, readOf(note)))
      }
      if (++counted % CHUNK === 0) await this.host.breathe()
    }

    for (const change of held.since) change(files)
    held.since = []
    const removed = this.flat(held)
    held.files = files
    held.flat = null
    held.reading = false
    this.tell({ root: held.root, space: held.name, path: null, removed, added: this.flat(held) })
  }

  private async notesOf(held: Held): Promise<readonly ScannedNote[]> {
    const open = this.host.open()
    if (samePath(open.root, held.root)) {
      await open.scanned()
      const now = this.host.open()
      if (samePath(now.root, held.root)) return now.notes()
    }
    return (await this.host.scan(held.root))?.notes ?? []
  }
}

/** A scanned note as the rows read it. */
function readOf(note: ScannedNote): NoteRead {
  return {
    path: note.path,
    front: note.front ?? null,
    tasks: note.tasks ?? [],
    stamp: note.stamp ?? null,
    tags: note.tags,
    links: note.links,
  }
}
