/** A device built from nothing but this package's rules, for the simulator.
 *
 *  The HTTP path of the engine sections 5.2 to 5.5 of docs/sync-v2.md describe, as
 *  small as it can be said. Per note: the confirmed document, its version, and the
 *  pending updates; a push that names the version and a `moved` answered by
 *  classifying (`diverge`), settling quietly or holding the note for its person; tree
 *  ops applied at once and queued, folded by `coalesce` before they go; the feed
 *  applied in the account's order; foreign edits to a file folded in three ways.
 *
 *  What survives a crash is `store`; what a crash loses is the typing since the last
 *  save, as with any autosave. After an unclean exit every document's client id is
 *  rotated, and it is rotated too whenever pending edits are thrown away, so one id
 *  never names two different operations. */

import { TEXT } from '@nib/rooms'
import * as Y from 'yjs'
import { type Divergence, diverge, type Times } from '../../src/diverge'
import { coalesce } from '../../src/outbox'
import { seedUpdate } from '../../src/seed'
import { textops } from '../../src/textops'
import { applyOp, nameKey, type TreeEntry, type TreeState, treeState } from '../../src/tree'
import {
  feedPageOf,
  frame,
  type CreateOp,
  type KeepRequest,
  type Op,
  OPS_BATCH,
  opsResponseOf,
  PULL_BATCH,
  pullResponseOf,
  PUSH_BATCH,
  pushResponseOf,
  unframe,
} from '../../src/wire'
import type { Seeded } from './account'
import type {
  Action,
  Answer,
  Classification,
  DeviceAdapter,
  Held,
  Link,
  Pick,
  View,
} from './adapters'
import type { Clock } from './network'
import { Random } from './random'

/** Transaction origins: what this device's person did, and what came from elsewhere. */
const LOCAL = 'local'
const REMOTE = 'remote'

const DOCUMENTS = new Set(['note', 'canvas', 'pages'])

interface StoredDoc {
  confirmed: Uint8Array
  /** The version `confirmed` is at on the account. */
  seq: number
  pending: Uint8Array[]
  /** When the newest pending edit was made, on this device's clock. */
  at: number
  /** The feed's `docSeq` the confirmed state is known to cover. */
  pulledTo: number
  client: number
  /** For a mergeable create: the text it started from. */
  started?: string
  /** A push sent and not yet answered: its id, and how many pending updates it held. */
  flight?: { push: string; count: number }
}

/** A note waiting for its person. With `update`, a push answered `moved`; without, a
 *  file another program changed, or a day's note merged into one that was there. */
interface HeldNote extends Held {
  update: Uint8Array | null
  seq: number
}

interface Store {
  cursor: number
  entries: Map<string, TreeEntry>
  outbox: { op: Op; sent: boolean }[]
  docs: Map<string, StoredDoc>
  known: Set<string>
  written: Map<string, string>
  held: Map<string, HeldNote>
  keeps: KeepRequest[]
  /** Mergeable creates the account answered `merged`: whose words go into which note,
   *  and the create itself, for when that note is gone before they get there. */
  merging: Map<string, { into: string; create: CreateOp }>
  made: number
  pushes: number
  clean: boolean
}

function textOf(...updates: Uint8Array[]): string {
  const doc = new Y.Doc()
  for (const update of updates) Y.applyUpdateV2(doc, update)
  const text = doc.getText(TEXT).toJSON()
  doc.destroy()
  return text
}

function vectorOf(update: Uint8Array): Uint8Array {
  return Y.encodeStateVectorFromUpdateV2(update)
}

/** The place `fraction` of the way into a text that falls on whitespace or the end, so
 *  words put there never join a word already there. */
function spot(text: string, fraction: number): number {
  let at = Math.max(0, Math.min(text.length, Math.floor(fraction * text.length)))
  while (at < text.length && !/\s/.test(text.charAt(at))) at++
  return at
}

/** A text with words put in at a place on whitespace. */
function withWords(text: string, fraction: number, words: string): string {
  if (!text) return words
  const at = spot(text, fraction)
  return `${text.slice(0, at)} ${words}${text.slice(at)}`
}

/** A text with whole words taken out, from a place on whitespace. */
function withoutWords(text: string, fraction: number, length: number): string {
  const from = spot(text, fraction)
  const to = spot(text, Math.min(1, (from + length) / Math.max(1, text.length)))
  return text.slice(0, from) + text.slice(Math.max(from, to))
}

export class ReferenceDevice implements DeviceAdapter {
  private store: Store
  private live = new Map<string, Y.Doc>()
  private unsaved = new Map<string, Uint8Array[]>()
  private log: Classification[] = []
  private life = 0
  private passing = false
  running = true

  constructor(
    readonly id: string,
    private readonly clock: Clock,
    private readonly random: Random,
    seeded: readonly Seeded[],
    private readonly skew = 0,
  ) {
    this.store = {
      cursor: seeded.length,
      entries: new Map(
        seeded.map((note, index): [string, TreeEntry] => [
          note.id,
          {
            id: note.id,
            kind: 'note',
            parent: null,
            name: note.name,
            deleted: false,
            seq: index + 1,
            docSeq: index + 1,
          },
        ]),
      ),
      outbox: [],
      docs: new Map(
        seeded.map((note, index): [string, StoredDoc] => [
          note.id,
          {
            confirmed: seedUpdate(note.id, 1, note.text),
            seq: 1,
            pending: [],
            at: 0,
            pulledTo: index + 1,
            client: this.freshClient(),
          },
        ]),
      ),
      known: new Set(seeded.map((note) => note.id)),
      written: new Map(seeded.map((note) => [note.id, note.text])),
      held: new Map(),
      keeps: [],
      merging: new Map(),
      made: 0,
      pushes: 0,
      clean: true,
    }
    this.build()
  }

  private now(): number {
    return this.clock.now + this.skew
  }

  private freshClient(): number {
    return this.random.int(2 ** 31) + 1
  }

  // -------------------------------------------------------------------------
  // Documents in memory

  /** A live document from what the store holds, capturing this person's edits. */
  private open(id: string, stored: StoredDoc): Y.Doc {
    const doc = new Y.Doc()
    doc.clientID = stored.client
    Y.applyUpdateV2(doc, stored.confirmed, REMOTE)
    for (const update of stored.pending) Y.applyUpdateV2(doc, update, REMOTE)
    doc.on('updateV2', (update: Uint8Array, origin: unknown) => {
      if (origin !== LOCAL) return
      const list = this.unsaved.get(id) ?? []
      list.push(update)
      this.unsaved.set(id, list)
    })
    this.live.set(id, doc)
    return doc
  }

  private build() {
    for (const doc of this.live.values()) doc.destroy()
    this.live = new Map()
    this.unsaved = new Map()
    for (const [id, stored] of this.store.docs) this.open(id, stored)
  }

  private textNow(id: string): string | null {
    const doc = this.live.get(id)
    return doc ? doc.getText(TEXT).toJSON() : null
  }

  private edit(id: string, to: string): boolean {
    const doc = this.live.get(id)
    const stored = this.store.docs.get(id)
    if (!doc || !stored) return false
    const from = doc.getText(TEXT).toJSON()
    if (from === to) return false
    textops(doc.getText(TEXT), from, to, LOCAL)
    stored.at = this.now()
    return true
  }

  /** Autosave's pause: everything typed goes into the store, and the files are written. */
  private save() {
    for (const [id, updates] of this.unsaved) {
      const stored = this.store.docs.get(id)
      if (stored && updates.length) stored.pending.push(Y.mergeUpdatesV2(updates))
      const text = this.textNow(id)
      if (text !== null) this.store.written.set(id, text)
    }
    this.unsaved = new Map()
  }

  private hasPending(id: string): boolean {
    return (
      (this.store.docs.get(id)?.pending.length ?? 0) > 0 || (this.unsaved.get(id)?.length ?? 0) > 0
    )
  }

  private drop(id: string) {
    this.live.get(id)?.destroy()
    this.live.delete(id)
    this.unsaved.delete(id)
    this.store.docs.delete(id)
    this.store.written.delete(id)
  }

  /** A new note of this device's own: its document, and the create in the outbox. */
  private made(parent: string | null, name: string, text: string, started?: string): string {
    this.store.made += 1
    const id = `${this.id}-${String(this.store.made)}`
    const stored: StoredDoc = {
      confirmed: Y.encodeStateAsUpdateV2(new Y.Doc()),
      seq: 0,
      pending: [],
      at: this.now(),
      pulledTo: 0,
      client: this.freshClient(),
    }
    if (started !== undefined) stored.started = started
    this.store.docs.set(id, stored)
    const doc = this.open(id, stored)
    doc.transact(() => doc.getText(TEXT).insert(0, text), LOCAL)

    const op: Op = {
      op: `${id}.c`,
      t: 'create',
      id,
      kind: 'note',
      parent,
      name,
      seen: this.store.cursor,
    }
    if (started !== undefined) op.mergeable = { text: started }
    this.queue(op)
    return id
  }

  // -------------------------------------------------------------------------
  // The tree as this device shows it

  private opCount = 0

  private queue(op: Op) {
    this.store.outbox.push({ op, sent: false })
  }

  private nextOp(): string {
    this.opCount += 1
    return `${this.id}.${String(this.life)}.${String(this.opCount)}.${String(this.store.made)}`
  }

  /** The confirmed tree with every op still in the outbox applied, as the person sees it. */
  private shown(): TreeState {
    const state = treeState(structuredClone([...this.store.entries.values()]), this.store.cursor)
    for (const { op } of this.store.outbox) applyOp(state, op, { role: 'owner', device: this.id })
    return state
  }

  private liveEntries(kind: 'note' | 'folder' | 'any'): TreeEntry[] {
    return [...this.shown().entries.values()]
      .filter((entry) => !entry.deleted)
      .filter(
        (entry) =>
          kind === 'any' ||
          (kind === 'folder' ? entry.kind === 'folder' : DOCUMENTS.has(entry.kind)),
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  }

  private chosen(list: readonly TreeEntry[], pick: Pick): TreeEntry | undefined {
    return list[Math.min(list.length - 1, Math.floor(pick * list.length))]
  }

  /** A note the person can type into: shown, with its words here, and not held. */
  private writable(pick: Pick): string | null {
    const notes = this.liveEntries('note').filter(
      (entry) => this.live.has(entry.id) && !this.store.held.has(entry.id),
    )
    return this.chosen(notes, pick)?.id ?? null
  }

  private folderFor(pick: Pick | null): string | null {
    if (pick === null) return null
    return this.chosen(this.liveEntries('folder'), pick)?.id ?? null
  }

  // -------------------------------------------------------------------------
  // What the person does

  async act(action: Action): Promise<void> {
    if (!this.running) return
    this.perform(action)
    return Promise.resolve()
  }

  private perform(action: Action) {
    switch (action.t) {
      case 'type': {
        const id = this.writable(action.note)
        const text = id ? this.textNow(id) : null
        if (id && text !== null) this.edit(id, withWords(text, action.at, action.words))
        return
      }
      case 'cut': {
        const id = this.writable(action.note)
        const text = id ? this.textNow(id) : null
        if (id && text !== null) this.edit(id, withoutWords(text, action.at, action.length))
        return
      }
      case 'drop-paragraph': {
        const id = this.writable(action.note)
        const text = id ? this.textNow(id) : null
        if (!id || text === null) return
        const blocks = text.split('\n\n')
        const at = Math.min(blocks.length - 1, Math.floor(action.at * blocks.length))
        this.edit(id, blocks.filter((_, index) => index !== at).join('\n\n'))
        return
      }
      case 'create':
        this.made(this.folderFor(action.folder), action.name, action.words)
        return
      case 'mkdir':
        this.store.made += 1
        this.queue({
          op: this.nextOp(),
          t: 'mkdir',
          id: `${this.id}-${String(this.store.made)}`,
          parent: this.folderFor(action.folder),
          name: action.name,
          seen: this.store.cursor,
        })
        return
      case 'rename': {
        const target = this.chosen(this.liveEntries('any'), action.target)
        if (target) {
          this.queue({
            op: this.nextOp(),
            t: 'rename',
            id: target.id,
            name: action.name,
            seen: this.store.cursor,
          })
        }
        return
      }
      case 'move': {
        const target = this.chosen(this.liveEntries('any'), action.target)
        const parent = this.folderFor(action.folder)
        if (!target || parent === target.id) return
        const op: Op = {
          op: this.nextOp(),
          t: 'move',
          id: target.id,
          parent,
          seen: this.store.cursor,
        }
        // The person cannot drop a folder into itself; the file list refuses the drag.
        if ('refused' in applyOp(this.shown(), op, { role: 'owner', device: this.id })) return
        this.queue(op)
        return
      }
      case 'delete': {
        const target = this.chosen(this.liveEntries('any'), action.target)
        if (!target) return
        const shown = this.shown()
        const inside = (id: string | null): boolean =>
          id !== null && (id === target.id || inside(shown.entries.get(id)?.parent ?? null))
        const gone = [...shown.entries.values()].filter(
          (entry) => !entry.deleted && inside(entry.id),
        )

        // What this device has seen of the words it deletes: a note whose newest words
        // it has not pulled yet was not seen, so the account must not take them.
        let seen = this.store.cursor
        for (const entry of gone) {
          const pulled = this.store.docs.get(entry.id)?.pulledTo ?? 0
          const newest = this.store.entries.get(entry.id)?.docSeq ?? 0
          if (pulled < newest) seen = Math.min(seen, pulled)
        }
        this.queue({ op: this.nextOp(), t: 'delete', id: target.id, seen })

        // The person threw these words away: nothing of them goes up any more.
        for (const entry of gone) {
          this.store.held.delete(entry.id)
          this.drop(entry.id)
        }
        return
      }
      case 'append-day': {
        const day = this.liveEntries('note').find(
          (entry) => entry.parent === null && nameKey(entry.name) === nameKey(action.name),
        )
        const text = day ? this.textNow(day.id) : null
        if (day && text !== null && !this.store.held.has(day.id)) {
          this.edit(day.id, text ? `${text}\n${action.words}` : action.words)
          return
        }
        if (!day) this.made(null, action.name, action.words, '')
        return
      }
      case 'edit-file':
        this.foreign(action)
        return
      case 'save':
        this.save()
        return
    }
  }

  /** Another program changed a note's file: folded in three ways against what nib last
   *  wrote (section 5.5). */
  private foreign(action: Extract<Action, { t: 'edit-file' }>) {
    const id = this.writable(action.note)
    if (!id) return
    const ours = this.textNow(id) ?? ''
    const ancestor = this.store.written.get(id) ?? ours
    const file = withoutWords(
      withWords(ancestor, action.at, action.words),
      1 - action.at,
      action.cut,
    )

    if (ours === ancestor) {
      this.edit(id, file)
      this.save()
      return
    }

    const times = { local: this.now(), remote: this.store.docs.get(id)?.at ?? 0 }
    const verdict = diverge(ancestor, file, ours, times)
    this.log.push({
      id,
      base: ancestor,
      local: file,
      remote: ours,
      times,
      held: verdict.verdict === 'diverged',
    })
    if (verdict.resolution === null) {
      this.hold({ id, base: ancestor, local: file, remote: ours, times, update: null, seq: 0 })
      return
    }
    this.keepLosers(id, verdict, file, ours)
    this.edit(id, verdict.resolution)
    this.save()
  }

  private hold(note: HeldNote) {
    this.store.held.set(note.id, note)
  }

  /** The losing side of every minor overlap, kept as a version: the words are in the
   *  history, never gone. Where the overlaps were settled with both sides' edits, both
   *  sides lost something. */
  private keepLosers(
    id: string,
    verdict: { overlaps: Divergence['overlaps']; settled: Divergence['settled'] },
    local: string,
    remote: string,
  ) {
    const both = verdict.settled === 'both'
    if (both || verdict.overlaps.some((overlap) => overlap.newer === 'remote')) {
      this.store.keeps.push({ id, text: local, device: this.id })
    }
    if (both || verdict.overlaps.some((overlap) => overlap.newer === 'local')) {
      this.store.keeps.push({ id, text: remote, device: this.id })
    }
  }

  // -------------------------------------------------------------------------
  // A pass

  async pass(link: Link): Promise<void> {
    if (!this.running || this.passing) return
    this.passing = true
    const life = this.life
    const alive = () => this.life === life && this.running
    try {
      this.save()
      if (!(await this.sendKeeps(link, alive))) return
      if (!(await this.sendOps(link, alive))) return
      if (!(await this.readFeed(link, alive))) return
      if (!(await this.pullDocs(link, alive))) return
      this.mergeDays()
      await this.pushDocs(link, alive)
    } finally {
      if (this.life === life) this.passing = false
    }
  }

  private async sendKeeps(link: Link, alive: () => boolean): Promise<boolean> {
    while (this.store.keeps.length) {
      const keep = this.store.keeps[0]
      if (!keep) break
      const reply = await link('keep', frame({ ...keep }))
      if (!alive() || reply === null) return false
      this.store.keeps.shift()
    }
    return true
  }

  private async sendOps(link: Link, alive: () => boolean): Promise<boolean> {
    if (!this.store.outbox.length) return true

    // What has not gone yet is folded; what may have gone goes again as it was.
    const sent = this.store.outbox.filter((one) => one.sent)
    const waiting = coalesce(this.store.outbox.filter((one) => !one.sent).map((one) => one.op))
    this.store.outbox = [...sent, ...waiting.map((op) => ({ op, sent: false }))]

    const batch = this.store.outbox.slice(0, OPS_BATCH)
    for (const one of batch) one.sent = true
    const reply = await link('ops', frame({ ops: batch.map((one) => ({ ...one.op })) }))
    if (!alive() || reply === null) return false
    const answer = opsResponseOf(unframe(reply))
    if (!answer) throw new Error(`${this.id}: ops answer unreadable`)

    for (const result of answer.results) {
      const index = this.store.outbox.findIndex((one) => one.op.op === result.op)
      const one = this.store.outbox[index]
      if (!one) continue
      this.store.outbox.splice(index, 1)

      if ('merged' in result && one.op.t === 'create') {
        this.store.merging.set(one.op.id, { into: result.merged, create: one.op })
      } else if ('ok' in result && (one.op.t === 'create' || one.op.t === 'mkdir')) {
        this.store.known.add(one.op.id)
      }
    }
    return true
  }

  private async readFeed(link: Link, alive: () => boolean): Promise<boolean> {
    for (;;) {
      const reply = await link('feed', frame({ since: this.store.cursor }))
      if (!alive() || reply === null) return false
      const page = feedPageOf(unframe(reply))
      if (!page) throw new Error(`${this.id}: feed unreadable`)

      for (const item of page.items) {
        const had = this.store.entries.get(item.id)
        if (had && had.seq >= item.seq) continue
        this.store.entries.set(item.id, {
          id: item.id,
          kind: item.kind,
          parent: item.parent,
          name: item.name,
          deleted: item.deleted,
          seq: item.seq,
          docSeq: item.docSeq ?? 0,
        })
        this.store.known.add(item.id)

        // Gone elsewhere: the file goes, unless this device wrote in it since, and then
        // the push brings it back (an edit beats a delete).
        if (item.deleted && !this.hasPending(item.id) && !this.store.held.has(item.id)) {
          this.drop(item.id)
        }
      }

      this.store.cursor = Math.max(this.store.cursor, page.cursor)
      if (!page.more) return true
    }
  }

  private async pullDocs(link: Link, alive: () => boolean): Promise<boolean> {
    const wanted = [...this.store.entries.values()].filter((entry) => {
      if (entry.deleted || !DOCUMENTS.has(entry.kind) || this.store.held.has(entry.id)) return false
      if (this.hasPending(entry.id)) return false
      const stored = this.store.docs.get(entry.id)
      return !stored || entry.docSeq > stored.pulledTo
    })
    if (!wanted.length) return true

    const batch = wanted.slice(0, PULL_BATCH)
    const asked = new Map(batch.map((entry) => [entry.id, entry.docSeq]))
    const reply = await link(
      'pull',
      frame({
        docs: batch.map((entry) => {
          const stored = this.store.docs.get(entry.id)
          return {
            id: entry.id,
            epoch: 1,
            sv: stored ? vectorOf(stored.confirmed) : Y.encodeStateVector(new Y.Doc()),
          }
        }),
      }),
    )
    if (!alive() || reply === null) return false
    const answer = pullResponseOf(unframe(reply))
    if (!answer) throw new Error(`${this.id}: pull answer unreadable`)

    for (const doc of answer.docs) {
      if (!('update' in doc)) continue
      // Typed into, or held, while the pull was in the air: the push brings the
      // account's words back through `moved`, where they are classified.
      if (this.hasPending(doc.id) || this.store.held.has(doc.id)) continue

      let stored = this.store.docs.get(doc.id)
      if (!stored) {
        stored = {
          confirmed: Y.encodeStateAsUpdateV2(new Y.Doc()),
          seq: 0,
          pending: [],
          at: 0,
          pulledTo: 0,
          client: this.freshClient(),
        }
        this.store.docs.set(doc.id, stored)
        this.open(doc.id, stored)
      }
      stored.confirmed = Y.mergeUpdatesV2([stored.confirmed, doc.update])
      stored.seq = doc.seq
      stored.pulledTo = Math.max(stored.pulledTo, asked.get(doc.id) ?? 0)
      const live = this.live.get(doc.id)
      if (live) Y.applyUpdateV2(live, doc.update, REMOTE)
      const text = this.textNow(doc.id)
      if (text !== null) this.store.written.set(doc.id, text)
    }
    return true
  }

  /** Day's notes the account merged into one that was already there: this device's
   *  words go into that note, merged against the text both started from. */
  private mergeDays() {
    for (const [mine, { into, create }] of [...this.store.merging]) {
      const stored = this.store.docs.get(mine)
      const words = this.textNow(mine)
      if (!stored || words === null) {
        this.store.merging.delete(mine)
        continue
      }
      // The note it was to go into was deleted meanwhile: it is made after all, as a
      // note of its own, rather than its words waiting for a note that will not come.
      if (this.store.entries.get(into)?.deleted) {
        const plain: CreateOp = { ...create, op: this.nextOp(), seen: this.store.cursor }
        delete plain.mergeable
        this.queue(plain)
        this.store.merging.delete(mine)
        continue
      }
      const theirs = this.textNow(into)
      if (theirs === null || this.hasPending(into) || this.store.held.has(into)) continue

      const base = stored.started ?? ''
      const times: Times = { local: stored.at, remote: this.store.docs.get(into)?.at ?? 0 }
      const verdict = diverge(base, words, theirs, times)
      this.log.push({
        id: into,
        base,
        local: words,
        remote: theirs,
        times,
        held: verdict.verdict === 'diverged',
      })
      if (verdict.resolution === null) {
        this.hold({ id: into, base, local: words, remote: theirs, times, update: null, seq: 0 })
      } else {
        this.keepLosers(into, verdict, words, theirs)
        this.edit(into, verdict.resolution)
        this.save()
      }
      this.store.merging.delete(mine)
      this.drop(mine)
    }
  }

  private async pushDocs(link: Link, alive: () => boolean): Promise<boolean> {
    const ready = [...this.store.docs.entries()].filter(
      ([id, stored]) =>
        stored.pending.length && this.store.known.has(id) && !this.store.held.has(id),
    )
    if (!ready.length) return true

    // A push whose answer never came goes again as it was, same id and same update;
    // anything typed since waits for the next one.
    const batch = ready.slice(0, PUSH_BATCH).map(([id, stored]) => {
      if (!stored.flight) {
        this.store.pushes += 1
        stored.flight = {
          push: `${this.id}.${String(this.store.pushes)}`,
          count: stored.pending.length,
        }
      }
      return { id, stored, flight: stored.flight }
    })
    const reply = await link(
      'push',
      frame({
        docs: batch.map(({ id, stored, flight }) => ({
          id,
          push: flight.push,
          epoch: 1,
          seq: stored.seq,
          base: vectorOf(stored.confirmed),
          update: Y.mergeUpdatesV2(stored.pending.slice(0, flight.count)),
          at: stored.at,
        })),
      }),
    )
    if (!alive() || reply === null) return false
    const answer = pushResponseOf(unframe(reply))
    if (!answer) throw new Error(`${this.id}: push answer unreadable`)

    for (const doc of answer.docs) {
      const sent = batch.find((one) => one.id === doc.id)
      const stored = this.store.docs.get(doc.id)
      // Answered after the pending edits it was about were thrown away: nothing to do.
      if (!sent || !stored || stored.flight?.push !== sent.flight.push) continue

      if ('ok' in doc) {
        const count = sent.flight.count
        stored.confirmed = Y.mergeUpdatesV2([stored.confirmed, ...stored.pending.slice(0, count)])
        stored.pending = stored.pending.slice(count)
        stored.seq = doc.seq
        delete stored.flight
      } else if ('moved' in doc) {
        // Not applied: the account had moved on. Classified with everything pending.
        delete stored.flight
        if (!this.store.held.has(doc.id)) this.moved(doc.id, stored, doc.moved, doc.seq, doc.at)
      }
    }
    return true
  }

  /** The account moved on under this device's pending edits: classify, then settle
   *  quietly or hold the note (section 5.4). */
  private moved(id: string, stored: StoredDoc, update: Uint8Array, seq: number, at: number) {
    const live = this.live.get(id)
    if (!live) return

    const base = textOf(stored.confirmed)
    const local = live.getText(TEXT).toJSON()
    const remote = textOf(stored.confirmed, update)
    const merged = textOf(Y.encodeStateAsUpdateV2(live), update)
    const times: Times = { local: stored.at, remote: at }
    const verdict = diverge(base, local, remote, times, merged)
    this.log.push({ id, base, local, remote, times, merged, held: verdict.verdict === 'diverged' })
    if (verdict.resolution === null) {
      this.hold({ id, base, local, remote, times, update, seq })
      return
    }

    Y.applyUpdateV2(live, update, REMOTE)
    stored.confirmed = Y.mergeUpdatesV2([stored.confirmed, update])
    stored.seq = seq
    this.keepLosers(id, verdict, local, remote)
    this.edit(id, verdict.resolution)
    this.save()
  }

  // -------------------------------------------------------------------------
  // The modal

  held(): readonly Held[] {
    return [...this.store.held.values()].map(({ id, base, local, remote, times }) => ({
      id,
      base,
      local,
      remote,
      times,
    }))
  }

  async answer(id: string, choice: Answer): Promise<void> {
    const note = this.store.held.get(id)
    const stored = this.store.docs.get(id)
    if (!note || !stored || !this.running) return
    this.store.held.delete(id)

    if (note.update) {
      if (choice === 'mine') {
        const live = this.live.get(id)
        if (live) Y.applyUpdateV2(live, note.update, REMOTE)
        stored.confirmed = Y.mergeUpdatesV2([stored.confirmed, note.update])
        stored.seq = note.seq
        this.edit(id, note.local)
        this.store.keeps.push({ id, text: note.remote, device: this.id })
      } else {
        // The account's text everywhere: this device's pending edits were never sent,
        // so they are dropped, and the client id they were made under goes with them.
        this.store.keeps.push({ id, text: note.local, device: this.id })
        this.save()
        stored.pending = []
        delete stored.flight
        stored.confirmed = Y.mergeUpdatesV2([stored.confirmed, note.update])
        stored.seq = note.seq
        stored.client = this.freshClient()
        this.live.get(id)?.destroy()
        this.unsaved.delete(id)
        this.open(id, stored)
      }
    } else if (choice === 'mine') {
      this.edit(id, note.local)
      this.store.keeps.push({ id, text: note.remote, device: this.id })
    } else if (choice === 'theirs') {
      this.store.keeps.push({ id, text: note.local, device: this.id })
    }

    if (choice === 'both') {
      const entry = this.shown().entries.get(id)
      const name = entry?.name ?? 'Note.md'
      const dot = name.lastIndexOf('.')
      const copy =
        dot > 0 ? `${name.slice(0, dot)} (${this.id})${name.slice(dot)}` : `${name} (${this.id})`
      this.made(entry?.parent ?? null, copy, note.local)
    }
    this.save()
    return Promise.resolve()
  }

  // -------------------------------------------------------------------------
  // Life

  async quit(): Promise<void> {
    this.save()
    this.store.clean = true
    this.running = false
    this.life += 1
    this.passing = false
    return Promise.resolve()
  }

  async crash(): Promise<void> {
    this.store.clean = false
    this.running = false
    this.life += 1
    this.passing = false
    for (const doc of this.live.values()) doc.destroy()
    this.live = new Map()
    this.unsaved = new Map()
    return Promise.resolve()
  }

  async launch(): Promise<void> {
    if (this.running) return
    // The account may hold operations under the old ids that the store never had.
    if (!this.store.clean)
      for (const stored of this.store.docs.values()) stored.client = this.freshClient()
    // Op ids go on from where they were, but in a new life, so none is ever reused.
    this.store.clean = false
    this.running = true
    this.build()
    return Promise.resolve()
  }

  // -------------------------------------------------------------------------
  // What it holds

  async view(): Promise<View> {
    const entries = this.liveEntries('any').map(({ id, kind, parent, name }) => ({
      id,
      kind,
      parent,
      name,
    }))
    const texts: Record<string, string> = {}
    for (const entry of entries) {
      if (DOCUMENTS.has(entry.kind)) texts[entry.id] = this.textNow(entry.id) ?? ''
    }
    // A note deleted elsewhere while this device still has words for it to send: not
    // in the tree, but its words are here until the push brings it back.
    for (const id of this.live.keys()) {
      if (!(id in texts) && this.hasPending(id)) texts[id] = this.textNow(id) ?? ''
    }
    return Promise.resolve({ entries, texts })
  }

  classified(): Classification[] {
    const out = this.log
    this.log = []
    return out
  }

  /** Whether it has nothing left to send or to answer. */
  settled(): boolean {
    return (
      !this.store.outbox.length &&
      !this.store.keeps.length &&
      !this.store.held.size &&
      !this.store.merging.size &&
      [...this.store.docs.keys()].every((id) => !this.hasPending(id))
    )
  }

  /** How far the feed has been read. */
  get cursor(): number {
    return this.store.cursor
  }
}
