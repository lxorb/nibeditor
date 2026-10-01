/** Sync v2's engine: every note, canvas and page note a document this device keeps, the
 *  files their projection, the tree as operations, and the one question asked only when
 *  two sides really wrote two things in one place (docs/sync-v2.md sections 5 and 9).
 *
 *  This is the engine's face: what the app and the simulator both call. The world it
 *  runs in is handed in (world.ts), so the engine the simulator's seeds judge is the one
 *  the window runs. What is behind it, one responsibility a file:
 *
 *  - core.ts - what is held, in memory and in the store, and the one way it is written;
 *  - docs.ts - one document, confirmed and pending;
 *  - places.ts - the tree as shown, and where each entry is on this disk;
 *  - pass.ts - one pass over one space;
 *  - rejoin.ts - pending edits meeting the account's;
 *  - held.ts - the held notes and the three answers;
 *  - project.ts, ingest.ts - the file as the document's projection, and edits made to it
 *    by other programs;
 *  - create.ts - this device's own tree operations;
 *  - migrate.ts - the first v2 pass of a space that v1 kept, and the way back. */

import type { EngineEvents, Engine as AskedEngine } from './asking.svelte'
import { Core } from './core'
import { made, moved, removed } from './create'
import type { Doc } from './docs'
import { HeldList, type Names } from './held'
import { foldIn } from './ingest'
import { settle, type SpaceState } from './places'
import { pass, type Passed } from './pass'
import { project, wrote } from './project'
import { againstBytes } from './records'
import { put, type Change, type LogRow, type SyncStore } from './store'
import type { World } from './world'

type Listeners = { [T in keyof EngineEvents]: Set<(event: EngineEvents[T]) => void> }

export interface Starting {
  /** Device names by id, for the other side of a held note. */
  names?: Names
  /** Whether an answer asks the account for its newest words first. The simulator's
   *  person answers between requests, and says no. */
  freshens?: boolean
}

/** Where a path is: which space, and where in it. */
export interface Placed {
  space: SpaceState
  path: string
}

export class Engine implements AskedEngine {
  readonly held: HeldList
  private readonly listeners: Listeners = { resurrected: new Set(), pass: new Set() }

  private constructor(
    readonly core: Core,
    names: Names,
  ) {
    this.held = new HeldList(core, names)
    core.events.resurrected = (event) => this.emit('resurrected', event)
    core.events.held = () => void this.held.refresh()
  }

  static async start(world: World, store: SyncStore, how: Starting = {}): Promise<Engine> {
    const core = await Core.open(world, store)
    const engine = new Engine(core, how.names ?? ((device) => Promise.resolve(device ?? '')))
    engine.held.freshens = how.freshens ?? true
    await engine.held.refresh()
    return engine
  }

  get store(): Pick<SyncStore, 'read'> {
    return this.core.store
  }

  on<T extends keyof EngineEvents>(type: T, listener: (event: EngineEvents[T]) => void): () => void {
    const listening: Set<(event: EngineEvents[T]) => void> = this.listeners[type]
    listening.add(listener)
    return () => listening.delete(listener)
  }

  private emit<T extends keyof EngineEvents>(type: T, event: EngineEvents[T]) {
    const listening: Set<(event: EngineEvents[T]) => void> = this.listeners[type]
    for (const listener of [...listening]) listener(event)
  }

  // -------------------------------------------------------------------------
  // Passes

  /** One pass over one space. Written in the log when it moved anything or failed. */
  async pass(spaceId: string): Promise<Passed | null> {
    const space = this.core.spaces.get(spaceId)
    if (!space) return null
    const began = this.core.world.now()
    let passed: Passed | null = null
    let failed: string | null = null
    try {
      passed = await this.core.use(() => pass(this.core, space))
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (failed !== null || (passed && (passed.pulled || passed.pushed))) {
        const row: LogRow = {
          at: began,
          space: space.id,
          pulled: passed?.pulled ?? 0,
          pushed: passed?.pushed ?? 0,
          failed,
        }
        await this.core.commit([put('log', row)]).catch(() => undefined)
        this.emit('pass', row)
      }
      if (this.core.held.size || this.held.notes.length) await this.held.refresh()
    }
    return passed
  }

  /** Whether anything is waiting to go up in a space: what asks for another pass. */
  waiting(spaceId: string): boolean {
    const space = this.core.spaces.get(spaceId)
    if (!space) return false
    if (space.outbox.length) return true
    for (const entry of space.entries.values()) {
      if (this.core.hasPending(entry.id) && !this.core.isHeld(entry.id)) return true
    }
    return false
  }

  // -------------------------------------------------------------------------
  // Paths

  /** The space a path on this disk is in, and where in it, with `/` between folders. */
  placed(path: string): Placed | null {
    for (const space of this.core.spaces.values()) {
      const inside = relative(space.row.root, path)
      if (inside !== null) return { space, path: inside }
    }
    return null
  }

  /** The entry a file on this disk is. */
  entryAt(path: string) {
    const placed = this.placed(path)
    return placed ? placed.space.at(placed.path) : null
  }

  // -------------------------------------------------------------------------
  // This device's own changes

  /** A file or folder that came to be here: a new tab given its place, a file made in
   *  the list, one another program made. Answers its id. */
  created(path: string, folder: boolean, text?: string, mergeable?: string): Promise<string | null> {
    return this.core.use(() => this.make(path, folder, text, mergeable))
  }

  private async make(path: string, folder: boolean, text?: string, mergeable?: string): Promise<string | null> {
    const placed = this.placed(path)
    if (!placed || placed.space.at(placed.path)) return null
    const { id, changes } = await made(this.core, placed.space, {
      path: placed.path,
      folder,
      ...(text === undefined ? {} : { text }),
      ...(mergeable === undefined ? {} : { mergeable }),
    })
    await this.core.commit(changes)
    await this.settle(placed.space)
    return id
  }

  /** A file or folder that moved here. */
  moved(from: string, to: string): Promise<void> {
    return this.core.use(() => this.move(from, to))
  }

  private async move(from: string, to: string): Promise<void> {
    const was = this.placed(from)
    const now = this.placed(to)
    if (!was || !now) return
    if (was.space !== now.space) {
      // Out of one space and into another: gone from the one, made in the other.
      await this.remove(from)
      const text = await this.core.world.disk.read(to)
      await this.make(to, text === null, text ?? undefined)
      return
    }
    await this.core.commit(moved(this.core, was.space, was.path, now.path))
    await this.settle(was.space)
  }

  removed(path: string): Promise<void> {
    return this.core.use(() => this.remove(path))
  }

  private async remove(path: string): Promise<void> {
    const placed = this.placed(path)
    if (!placed) return
    await this.core.commit(removed(this.core, placed.space, placed.path))
    await this.settle(placed.space)
    await this.held.refresh()
  }

  /** The disk made to agree with what is shown, after this device changed the tree. */
  private async settle(space: SpaceState) {
    const forgets: Change[] = []
    const changed = await settle(space, {
      disk: this.core.world.disk,
      join: this.core.world.join,
      keeps: (id) => this.core.hasPending(id) || this.core.isHeld(id),
      forget: (id) => forgets.push(...this.core.forgetChanges(id)),
    })
    await this.core.commit([...this.core.entryChanges(changed), ...forgets])
  }

  /** Autosave wrote a document's file: what it wrote is recorded, and what was typed
   *  since the last pause becomes one more pending update, in one write. */
  saved(path: string, text: string): Promise<void> {
    return this.core.use(() => this.wroteDown(path, text))
  }

  private async wroteDown(path: string, text: string): Promise<void> {
    const placed = this.placed(path)
    const entry = placed?.space.at(placed.path)
    if (!placed || !entry) return
    const doc = this.core.docs.get(entry.id)
    // A document joined to the note it is: what was typed is in it already.
    if (doc?.live && this.core.pinned.has(entry.id)) {
      const changes: Change[] = []
      if (doc.flush()) changes.push(...this.core.docChanges(doc))
      changes.push(...(await wrote(this.core, entry, text)))
      await this.core.commit(changes)
      return
    }
    // One that is not - a canvas, a note before its document arrived - takes the file's
    // words the way it takes another program's, three ways against nib's last write.
    await this.core.commit(await foldIn(this.core, placed.space, entry))
  }

  /** A note whose words in a tab and in its document both moved past what nib last
   *  wrote, too far to merge quietly: held, like another program's edit (binding.ts). */
  holdFile(id: string, base: string, local: string): Promise<void> {
    const against = { t: 'file', base, local } as const
    return this.core.commit(
      this.core.holdChanges({
        row: { id, remote: againstBytes(against), remote_sv: new Uint8Array(), device: null, at: this.core.world.now() },
        against,
      }),
    )
  }

  /** Autosave's pause for the documents no editor holds - words the engine or the
   *  simulator's person put in: into the store, and onto the disk. */
  pause(): Promise<void> {
    return this.core.use(() => this.paused())
  }

  private async paused(): Promise<void> {
    const changes: Change[] = []
    for (const doc of [...this.core.docs.values()]) {
      if (this.core.pinned.has(doc.id) || !doc.flush()) continue
      changes.push(...this.core.docChanges(doc))
      const space = this.core.spaceOf(doc.id)
      const entry = space?.entries.get(doc.id)
      if (space && entry) changes.push(...(await project(this.core, space, entry, doc)))
    }
    await this.core.commit(changes)
  }

  /** A file that another program may have changed: folded in if it did. */
  foreign(path: string): Promise<void> {
    return this.core.use(async () => {
      const placed = this.placed(path)
      const entry = placed?.space.at(placed.path)
      if (!placed || !entry) return
      await this.core.commit(await foldIn(this.core, placed.space, entry))
    })
  }

  // -------------------------------------------------------------------------
  // Documents held open

  /** A document something is holding open - a tab, a room - live until it lets go. */
  hold(id: string): Promise<Doc | null> {
    return this.core.use(async () => {
      const doc = await this.core.doc(id)
      if (!doc) return null
      this.core.pinned.add(id)
      doc.open()
      return doc
    })
  }

  /** Lets go of a document: what was typed is written down, and it is closed. */
  letGo(id: string): Promise<void> {
    return this.core.use(async () => {
      this.core.pinned.delete(id)
      const doc = this.core.docs.get(id)
      if (!doc) return
      doc.flush()
      await this.core.commit(this.core.dirtyChanges())
    })
  }

  // -------------------------------------------------------------------------
  // Life

  /** Everything written down, and the session marked as ended cleanly. */
  async quit(): Promise<void> {
    for (const doc of this.core.docs.values()) doc.flush()
    await this.core.commit(this.core.dirtyChanges())
    await this.core.store.cleanExit(true)
  }

  /** Stops at once: anything still in the air finds it is too late. */
  stop() {
    this.core.life += 1
    for (const doc of this.core.docs.values()) doc.close()
  }
}

/** A path relative to a root, with `/` between folders, or null outside it. */
export function relative(root: string, path: string): string | null {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = norm(root)
  const full = norm(path)
  if (full.length <= base.length) return null
  const head = full.slice(0, base.length)
  if (head.toLowerCase() !== base.toLowerCase() || full.charAt(base.length) !== '/') return null
  return full.slice(base.length + 1)
}
