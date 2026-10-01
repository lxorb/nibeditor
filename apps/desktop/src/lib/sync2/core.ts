/** Everything the engine holds, in memory and in the store, and the one way it is
 *  written down.
 *
 *  What is read at start is small: every space's tree, the outbox, the held notes and
 *  every document's numbers (records.ts). A document's bytes are read when something
 *  needs them - a note opened, a pass settling it - and let go again once written, so
 *  memory holds the open notes and whatever one step of a pass is working on.
 *
 *  Every write goes through `commit`, one after another in the order they were asked
 *  for, each all or nothing. The steps of a pass commit what they learned before the
 *  next request goes out, so a crash at any await loses nothing a step had finished:
 *  the simulator crashes devices at exactly those moments. */

import type { Times } from '@nib/sync-core/diverge'
import { Doc } from './docs'
import { holdsDocument, shapeOf, type Shape } from './kinds'
import { SpaceState, type Outboxed } from './places'
import {
  againstOf,
  numbersKey,
  numbersOf,
  numbersRow,
  outgoingBytes,
  outgoingOf,
  wantKey,
  wantedOf,
  wantedRow,
  type Against,
  type DocNumbers,
  type Outgoing,
  type Wanted,
} from './records'
import {
  clear,
  get,
  put,
  remove,
  scan,
  type Change,
  type EntryRow,
  type HeldRow,
  type SyncStore,
} from './store'
import type { World } from './world'

/** Which run of the clients this is: bumped by every launch after an unclean exit, and
 *  kept beside each document's numbers, so a document first touched after a crash takes
 *  a new client id before anything is typed under the old one (section 5.2). */
const CLIENTS = 'clients'

/** Classified merges, for the simulator's check that the modal was asked exactly when
 *  `diverge` says so. */
export interface Classification {
  id: string
  base: string
  local: string
  remote: string
  times: Times
  merged?: string
  held: boolean
}

/** A held note, with the texts the modal draws and the answers act on. */
export interface Holding {
  row: HeldRow
  against: Against
}

/** Events the engine says out loud. */
export interface CoreEvents {
  resurrected: (event: { id: string; name: string; device: string }) => void
  held: () => void
}

export class Core {
  readonly spaces = new Map<string, SpaceState>()
  /** Every document's numbers, by id: which have something pending, where each is. */
  readonly numbers = new Map<string, DocNumbers>()
  /** Which run of the clients each document's id was chosen in. */
  private readonly generations = new Map<string, number>()
  private generation = 0
  /** Documents whose bytes are in memory. */
  readonly docs = new Map<string, Doc>()
  /** Documents something outside is holding open: a tab, a room. They stay live. */
  readonly pinned = new Set<string>()
  readonly held = new Map<string, Holding>()
  /** Per space, the documents the feed says have words this device has not pulled. */
  readonly wants = new Map<string, Map<string, Wanted>>()
  /** The device that last changed each entry, as the feed said: the other side of a
   *  held note, and who brought back a note this device deleted. Memory only. */
  readonly by = new Map<string, string>()
  /** Documents a live room's socket carries: a pass leaves them to it. */
  readonly carried = new Set<string>()
  /** The newest epoch the account has said each document is on: a room is joined only by
   *  a document on it, since operations of two epochs cannot be merged. */
  readonly epochs = new Map<string, number>()
  readonly classified: Classification[] = []
  readonly events: Partial<CoreEvents> = {}
  /** Bumped when the engine stops, so work still in the air can tell it is too late. */
  life = 0
  private writing: Promise<unknown> = Promise.resolve()
  private counter = 0

  private constructor(
    readonly world: World,
    readonly store: SyncStore,
  ) {}

  get device(): string {
    return this.store.opened.device
  }

  /** Everything small, read from the store. */
  static async open(world: World, store: SyncStore): Promise<Core> {
    const core = new Core(world, store)
    const [spaces, entries, outbox, meta, held] = await store.read([
      scan('spaces'),
      scan('entries'),
      scan('outbox'),
      scan('meta'),
      scan('held'),
    ])

    for (const row of meta) {
      const read = numbersOf(row)
      if (read) core.numbers.set(read.id, read.numbers)
      if (row.key.startsWith(GEN)) {
        core.generations.set(row.key.slice(GEN.length), Number(row.value) || 0)
      }
      if (row.key === CLIENTS) core.generation = Number(row.value) || 0
      if (row.key === COUNTER) core.counter = Number(row.value) || 0
      const wanted = wantedOf(row)
      if (wanted) core.wants.set(wanted.space, wanted.wanted)
    }
    if (!store.opened.wasClean) {
      core.generation += 1
      await core.commit([put('meta', { key: CLIENTS, value: core.generation })])
    }

    for (const space of spaces) {
      const mine = entries.filter((entry) => entry.space_id === space.space_id)
      const waiting: Outboxed[] = []
      for (const row of outbox) {
        if (row.space_id !== space.space_id) continue
        const record = outgoingOf(row.op)
        if (record) waiting.push({ row, record })
      }
      core.spaces.set(space.space_id, new SpaceState(space, mine, waiting, core.device, world))
    }

    for (const row of held) {
      const against = againstOf(row.remote)
      if (against) core.held.set(row.id, { row, against })
    }
    return core
  }

  /** Writes changes down, in order, all or nothing each. */
  commit(changes: readonly Change[]): Promise<void> {
    if (!changes.length) return this.writing.then(() => undefined)
    const next = this.writing.then(() => this.store.write(changes))
    this.writing = next.catch(() => undefined)
    return next.then(() => undefined)
  }

  /** A number that has never been handed out on this device: op and push ids. Kept in
   *  the store with the next write that carries one. */
  nextId(prefix: string): string {
    this.counter += 1
    const random = Math.floor(this.world.random() * 2 ** 32).toString(36)
    return `${this.device}.${prefix}${this.counter.toString(36)}.${random}`
  }

  /** The counter's row, for a write that carries a new id. */
  counterRow(): Change {
    return put('meta', { key: COUNTER, value: this.counter })
  }

  /** A client id for a document: a random 32-bit number that is not nought. */
  freshClient(): number {
    return (Math.floor(this.world.random() * 0xffffffff) >>> 0) + 1
  }

  // -------------------------------------------------------------------------
  // Spaces and entries

  /** A space this device starts keeping, from the top of its feed. */
  addSpace(spaceId: string, root: string, role: string | null): Change[] {
    const row = { space_id: spaceId, root, cursor: 0, role, store: null }
    this.spaces.set(spaceId, new SpaceState(row, [], [], this.device, this.world))
    return [put('spaces', row)]
  }

  /** A space let go of: its tree, its outbox, its documents and what was held of it. */
  forgetSpace(spaceId: string): Change[] {
    const space = this.spaces.get(spaceId)
    if (!space) return []
    const changes: Change[] = []
    for (const entry of space.entries.values()) {
      changes.push(...this.letGoChanges(entry.id))
      if (this.hasDoc(entry.id)) changes.push(...this.forgetChanges(entry.id))
    }
    this.spaces.delete(spaceId)
    this.wants.delete(spaceId)
    changes.push(
      clear('entries', spaceId),
      clear('outbox', spaceId),
      remove('spaces', spaceId),
      remove('meta', wantKey(spaceId)),
    )
    return changes
  }

  /** A space whose folder moved: the same space, under its new root. */
  rootMoved(spaceId: string, root: string): Change[] {
    const space = this.spaces.get(spaceId)
    if (!space) return []
    space.row = { ...space.row, root }
    return [put('spaces', { ...space.row })]
  }

  /** The space an entry is in. */
  spaceOf(id: string): SpaceState | null {
    for (const space of this.spaces.values()) if (space.entries.has(id)) return space
    return null
  }

  entry(id: string): EntryRow | null {
    return this.spaceOf(id)?.entries.get(id) ?? null
  }

  shapeOfEntry(id: string): Shape | null {
    const entry = this.entry(id)
    return entry ? shapeOf(entry.kind) : null
  }

  /** The row changes for entries. */
  entryChanges(rows: Iterable<EntryRow>): Change[] {
    return [...rows].map((row) => put('entries', { ...row }))
  }

  /** The documents of a space still to pull. */
  wanted(space: string): Map<string, Wanted> {
    let wanted = this.wants.get(space)
    if (!wanted) {
      wanted = new Map()
      this.wants.set(space, wanted)
    }
    return wanted
  }

  wantChange(space: string): Change {
    return put('meta', wantedRow(space, this.wanted(space)))
  }

  // -------------------------------------------------------------------------
  // Documents

  /** Whether this device holds words for a document. */
  hasDoc(id: string): boolean {
    return this.docs.has(id) || this.numbers.has(id)
  }

  /** A document's bytes, read from the store the first time. Null when this device has
   *  none. */
  async doc(id: string): Promise<Doc | null> {
    const held = this.docs.get(id)
    if (held) return held
    const numbers = this.numbers.get(id)
    const shape = this.shapeOfEntry(id) ?? 'words'
    if (!numbers) return null
    const [row] = await this.store.read([get('docs', id)])
    // Read while another step made or dropped it.
    const again = this.docs.get(id)
    if (again) return again
    if (!row) return null
    const doc = Doc.fromRow(row, numbers, shape, () => this.world.now())
    this.adopt(doc)
    return doc
  }

  /** A document this device has just made, or taken from the account. */
  made(id: string, shape: Shape, epoch: number, confirmed?: Uint8Array, seq = 0): Doc {
    const doc = Doc.fresh(id, shape, epoch, this.freshClient(), () => this.world.now(), confirmed, seq)
    this.generations.set(id, this.generation)
    this.adopt(doc)
    return doc
  }

  private adopt(doc: Doc) {
    this.docs.set(doc.id, doc)
    this.numbers.set(doc.id, doc.numbers())
    // A document first touched since an unclean exit takes a new id before anything
    // is made under the old one.
    if ((this.generations.get(doc.id) ?? 0) < this.generation) {
      doc.rotate(this.freshClient())
      this.generations.set(doc.id, this.generation)
    }
  }

  /** What writing a document down changes: its row, its numbers, its generation. */
  docChanges(doc: Doc): Change[] {
    doc.dirty = false
    this.numbers.set(doc.id, doc.numbers())
    return [
      put('docs', doc.row()),
      put('meta', numbersRow(doc.id, doc.numbers())),
      put('meta', { key: `${GEN}${doc.id}`, value: this.generations.get(doc.id) ?? 0 }),
    ]
  }

  /** Every document that changed since it was last written, as changes. */
  dirtyChanges(): Change[] {
    const out: Change[] = []
    for (const doc of this.docs.values()) if (doc.dirty) out.push(...this.docChanges(doc))
    return out
  }

  /** A document this device will not hear of again, gone from memory and the store. */
  forgetChanges(id: string): Change[] {
    this.docs.get(id)?.close()
    this.docs.delete(id)
    this.numbers.delete(id)
    this.generations.delete(id)
    this.pinned.delete(id)
    return [
      remove('docs', id),
      remove('written', id),
      remove('meta', numbersKey(id)),
      remove('meta', `${GEN}${id}`),
    ]
  }

  /** Whether a document holds words the account has not acknowledged. */
  hasPending(id: string): boolean {
    const doc = this.docs.get(id)
    if (doc) return doc.hasPending
    return this.numbers.get(id)?.pending ?? false
  }

  /** How many operations are under way. A document's bytes are let go only when none
   *  is, so no step ever holds a document another step has read again from the store:
   *  two copies of one document are two sets of pending edits, and the later write
   *  would drop the earlier's. */
  private busy = 0

  /** Runs one operation, and lets go of what it read once nothing else is running. */
  async use<T>(work: () => Promise<T>): Promise<T> {
    this.busy += 1
    try {
      return await work()
    } finally {
      this.busy -= 1
      if (!this.busy) this.release()
    }
  }

  /** Whether a document read before an await is still the one this device holds. */
  current(doc: Doc): boolean {
    return this.docs.get(doc.id) === doc
  }

  /** Lets go of every document nothing is holding open, once it is written down. */
  private release() {
    for (const [id, doc] of this.docs) {
      if (this.pinned.has(id) || doc.dirty || doc.unsaved.length) continue
      doc.close()
      this.docs.delete(id)
    }
  }

  // -------------------------------------------------------------------------
  // The outbox

  /** One thing waiting to go up, as a row and a place in its space's queue. */
  outgoing(space: SpaceState, record: Outgoing, seen: number): { one: Outboxed; change: Change } {
    const row = {
      op_id: record.t === 'op' ? record.op.op : this.nextId(record.t),
      space_id: space.id,
      op: outgoingBytes(record),
      seen,
      made_at: this.world.now(),
    }
    const one: Outboxed = { row, record }
    return { one, change: put('outbox', row) }
  }

  // -------------------------------------------------------------------------
  // Held notes

  holdChanges(holding: Holding): Change[] {
    this.held.set(holding.row.id, holding)
    this.events.held?.()
    return [put('held', holding.row)]
  }

  letGoChanges(id: string): Change[] {
    if (!this.held.delete(id)) return []
    this.events.held?.()
    return [remove('held', id)]
  }

  isHeld(id: string): boolean {
    return this.held.has(id)
  }

  /** Whether an entry is a document: what a pass pulls and pushes. */
  static isDocument(entry: EntryRow): boolean {
    return holdsDocument(entry.kind)
  }
}

const GEN = 'gen:'
const COUNTER = 'counter'
