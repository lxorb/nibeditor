/** One document as this device keeps it: what the account has confirmed, and what this
 *  device has made that the account has not (docs/sync-v2.md section 5.2).
 *
 *  The live document is confirmed plus pending, and exists only while something is
 *  looking at it: a note open in a tab, a pass settling it, a scratch copy classifying
 *  it. Everything else is bytes in the store, read when a pass needs them.
 *
 *  **Write order, which is the crash story.** A keystroke goes into the live document
 *  (and into a room's socket if one is up) and into `unsaved`, in memory: nothing is
 *  written per keystroke. At autosave's pause the file is written and `unsaved` becomes
 *  one more pending update in the store, in one write. An acknowledgement - a push
 *  answered `ok`, or a room's ACK at its settle - moves what it covers into confirmed. A
 *  crash therefore loses at most the typing since the last pause, as any autosave does.
 *
 *  **One client id per note per device**, so a state vector stays one entry per device
 *  rather than one per sitting for years. It is given to the live document after the
 *  stored updates are read in, never before: Yjs takes a new id for any document that
 *  meets its own operations arriving from elsewhere, and reading the store back is
 *  exactly that. After an unclean exit it is rotated (`rotate`), because the account may
 *  hold operations under the old id that the store never got; and whenever pending
 *  edits are thrown away, for the same reason. */

import * as Y from 'yjs'
import { fileOf, fileOfUpdates, type Shape } from './kinds'
import { type DocNumbers, type Flight, pendingBytes, pendingOf } from './records'
import type { DocRow } from './store'

/** Transaction origins. `HERE` is the editor's own keystrokes, arriving through the
 *  binding (rooms/bind.ts marks its transactions with the same word); `MINE` is what the
 *  engine writes for this device - another program's edit folded in, an overlap
 *  settled, an answer carried out. Both are pending. `ROOM` is what a live socket
 *  brought (rooms/door.ts applies with the same word) and `PULLED` what a pull or a
 *  push's answer brought: both are confirmed. */
export const HERE = 'here'
export const MINE = 'mine'
const ROOM = 'room'
const PULLED = 'pulled'
const LOADED = 'loaded'

/** How many pending updates a document keeps apart before the ones no push is carrying
 *  are merged into one. */
const MOST_CHUNKS = 32

function merged(updates: readonly Uint8Array[]): Uint8Array {
  if (updates.length === 1 && updates[0]) return updates[0]
  return Y.mergeUpdatesV2([...updates])
}

const EMPTY = Y.encodeStateAsUpdateV2(new Y.Doc())

/** Whether an update adds anything to a state that has `sv`: any insertion it holds that
 *  `sv` does not already cover. Deletions are not counted, because a deletion has no
 *  clock to be covered by, and sending one again is harmless. */
function reachesPast(update: Uint8Array, sv: Uint8Array): boolean {
  const rest = Y.diffUpdateV2(update, sv)
  return Y.decodeUpdateV2(rest).structs.length > 0
}

export class Doc {
  /** What typing made since the last pause: memory only, and never a write. */
  unsaved: Uint8Array[] = []
  /** What a live socket brought since the confirmed bytes were last merged. */
  private roomed: Uint8Array[] = []
  /** The live document, while something is looking at it. */
  live: Y.Doc | null = null
  /** Something changed that the store has not been told. */
  dirty = false
  /** Told whenever the live document is replaced by another: the account's words taken
   *  over pending ones, or a new epoch. Whatever was bound to the old one binds again. */
  replaced: ((doc: Y.Doc) => void) | null = null
  /** Told whenever a keystroke or the engine made something pending, so a store can hear
   *  there is something to send. */
  touched: (() => void) | null = null

  private constructor(
    readonly id: string,
    readonly shape: Shape,
    public epoch: number,
    public client: number,
    public confirmed: Uint8Array,
    public pending: Uint8Array[],
    public pendingAt: number,
    public seq: number,
    public pulled: number,
    public flight: Flight | null,
    private readonly now: () => number,
  ) {}

  /** A document with nothing in it yet. */
  static fresh(
    id: string,
    shape: Shape,
    epoch: number,
    client: number,
    now: () => number,
    confirmed: Uint8Array = EMPTY,
    seq = 0,
  ): Doc {
    const doc = new Doc(id, shape, epoch, client, confirmed, [], 0, seq, 0, null, now)
    doc.dirty = true
    return doc
  }

  static fromRow(row: DocRow, numbers: DocNumbers, shape: Shape, now: () => number): Doc {
    return new Doc(
      row.id,
      shape,
      row.epoch,
      row.client_id,
      row.confirmed,
      pendingOf(row.pending),
      row.pending_at ?? 0,
      numbers.seq,
      numbers.pulled,
      numbers.flight,
      now,
    )
  }

  /** The row the store keeps, with every update merged that can be. */
  row(): DocRow {
    this.foldRoomed()
    return {
      id: this.id,
      epoch: this.epoch,
      client_id: this.client,
      confirmed: this.confirmed,
      confirmed_sv: Y.encodeStateVectorFromUpdateV2(this.confirmed),
      pending: pendingBytes(this.pending),
      pending_at: this.pending.length ? this.pendingAt : null,
    }
  }

  numbers(): DocNumbers {
    return {
      seq: this.seq,
      pulled: this.pulled,
      pending: this.pending.length > 0,
      flight: this.flight,
    }
  }

  get hasPending(): boolean {
    return this.pending.length > 0 || this.unsaved.length > 0
  }

  /** The live document, made from the store the first time it is asked for. */
  open(): Y.Doc {
    if (this.live) return this.live
    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, this.confirmedNow(), LOADED)
    for (const update of this.pending) Y.applyUpdateV2(doc, update, LOADED)
    for (const update of this.unsaved) Y.applyUpdateV2(doc, update, LOADED)
    // Named after reading, never before; see the header.
    doc.clientID = this.client
    doc.on('updateV2', (update: Uint8Array, origin: unknown) => this.heard(update, origin))
    this.live = doc
    return doc
  }

  private heard(update: Uint8Array, origin: unknown) {
    if (origin === HERE || origin === MINE) {
      this.unsaved.push(update)
      this.pendingAt = Math.max(this.pendingAt, this.now())
      this.touched?.()
    } else if (origin === ROOM) {
      this.roomed.push(update)
      this.dirty = true
    }
  }

  /** Lets the live document go. What it made is kept in `unsaved` until a pause writes
   *  it; closing is not a pause. */
  close() {
    this.live?.destroy()
    this.live = null
  }

  /** The words the document reads now. */
  text(): string {
    if (this.live) return fileOf(this.shape, this.live)
    return fileOfUpdates(this.shape, this.confirmedNow(), ...this.pending, ...this.unsaved)
  }

  /** The words the account has confirmed: the ancestor of every classification. */
  confirmedText(): string {
    return fileOfUpdates(this.shape, this.confirmedNow())
  }

  /** The confirmed state vector, which a pull and a push name. */
  confirmedSv(): Uint8Array {
    return Y.encodeStateVectorFromUpdateV2(this.confirmedNow())
  }

  /** Everything this device holds of the document, as one update. */
  whole(): Uint8Array {
    return merged([this.confirmedNow(), ...this.pending, ...this.unsaved])
  }

  private confirmedNow(): Uint8Array {
    this.foldRoomed()
    return this.confirmed
  }

  private foldRoomed() {
    if (!this.roomed.length) return
    this.confirmed = merged([this.confirmed, ...this.roomed])
    this.roomed = []
  }

  /** The pause: what was typed becomes one more pending update. Answers whether there
   *  was anything. */
  flush(): boolean {
    if (!this.unsaved.length) return false
    this.pending.push(merged(this.unsaved))
    this.unsaved = []
    this.dirty = true

    // A long offline week is a long list; the updates no push carries are merged.
    const carried = this.flight?.count ?? 0
    if (this.pending.length > MOST_CHUNKS) {
      this.pending = [...this.pending.slice(0, carried), merged(this.pending.slice(carried))]
    }
    return true
  }

  /** The pending updates a push carries: the ones already in the air, as they were, or
   *  every one there is, under a new push id. */
  outgoing(newId: () => string): { push: string; update: Uint8Array } | null {
    if (!this.flight) {
      if (!this.pending.length) return null
      this.flight = { push: newId(), count: this.pending.length }
      this.dirty = true
    }
    return { push: this.flight.push, update: merged(this.pending.slice(0, this.flight.count)) }
  }

  /** A push was answered `ok`: what it carried is the account's now, at version `seq`. */
  confirmFlight(seq: number) {
    const count = this.flight?.count ?? 0
    this.confirmed = merged([this.confirmedNow(), ...this.pending.slice(0, count)])
    this.pending = this.pending.slice(count)
    this.flight = null
    this.seq = seq
    this.dirty = true
  }

  /** A push answered with anything but `ok`: nothing it carried was applied, so the next
   *  one carries whatever is pending then, under a new id. */
  land() {
    if (!this.flight) return
    this.flight = null
    this.dirty = true
  }

  /** A room's acknowledgement at its settle: every pending update whose insertions the
   *  room's state vector covers is confirmed, oldest first, stopping at the first that
   *  reaches past it. The live socket carried each in order, and a deletion that raced
   *  the settle is in every sync exchange after it, which sends the whole delete set. */
  acked(seq: number, sv: Uint8Array) {
    let covered = 0
    while (covered < this.pending.length) {
      const chunk = this.pending[covered]
      if (!chunk || reachesPast(chunk, sv)) break
      covered += 1
    }
    if (this.flight && covered < this.flight.count) covered = 0
    if (covered) {
      this.confirmed = merged([this.confirmedNow(), ...this.pending.slice(0, covered)])
      this.pending = this.pending.slice(covered)
      if (this.flight) this.flight = null
    }
    this.seq = Math.max(this.seq, seq)
    this.dirty = true
  }

  /** Words the account holds that this device did not: into confirmed, and into the live
   *  document where there is one, as the edit they are. */
  took(update: Uint8Array, seq: number) {
    this.confirmed = merged([this.confirmedNow(), update])
    this.seq = seq
    this.dirty = true
    if (this.live) Y.applyUpdateV2(this.live, update, PULLED)
  }

  /** Something this device writes into the document: made in the live one, which is
   *  opened for it if it was not, so it is pending like a keystroke. */
  write(change: (doc: Y.Doc) => void) {
    const doc = this.open()
    change(doc)
  }

  /** The account's words stand and this device's pending ones go: `confirmed` becomes
   *  what is given, at version `seq`, and the id pending was made under goes with it. A
   *  live document is made again from the new state and handed to whoever was bound. */
  restart(confirmed: Uint8Array, seq: number, epoch: number, client: number) {
    this.roomed = []
    this.confirmed = confirmed
    this.pending = []
    this.unsaved = []
    this.flight = null
    this.seq = seq
    this.epoch = epoch
    this.client = client
    this.dirty = true
    if (!this.live) return

    this.live.destroy()
    this.live = null
    const fresh = this.open()
    this.replaced?.(fresh)
  }

  /** A new client id, for a device that exited uncleanly. */
  rotate(client: number) {
    this.client = client
    if (this.live) this.live.clientID = client
    this.dirty = true
  }
}
