/** An account built from nothing but this package's rules, for the simulator.
 *
 *  What the Worker will do, as small as it can be said: tree ops through `applyOp`, a
 *  Yjs document per note with a version that moves on with every change, pushes
 *  applied only onto the version they name and answered `moved` otherwise, pulls
 *  answered with a diff, and versions kept when a device says so. One space; no rooms,
 *  sockets or settles, which are the HTTP path's business to stand in for.
 *
 *  `plant` breaks one rule on purpose, so a test can prove the simulator catches it. */

import { TEXT } from '@nib/rooms'
import * as Y from 'yjs'
import { seedUpdate } from '../../src/seed'
import { applyOp, contentChanged, type TreeState, treeState } from '../../src/tree'
import {
  FEED_PAGE,
  type FeedItem,
  frame,
  keepRequestOf,
  type OpResult,
  opsRequestOf,
  type PullAnswer,
  pullRequestOf,
  type PushAnswer,
  pushRequestOf,
  unframe,
} from '../../src/wire'
import type { AccountAdapter, AccountView, Route } from './adapters'
import type { Clock } from './network'

/** A rule the account can be told to break. */
export type Plant = 'delete-without-seen'

/** A note the run starts with, already on the account and on every device. */
export interface Seeded {
  id: string
  name: string
  text: string
}

interface Document {
  doc: Y.Doc
  seq: number
  at: number
}

const DOCUMENTS = new Set(['note', 'canvas', 'pages'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class ReferenceAccount implements AccountAdapter {
  readonly tree: TreeState
  private readonly docs = new Map<string, Document>()
  private readonly changedAt = new Map<string, number>()
  private readonly changedBy = new Map<string, string>()
  private readonly versions: string[] = []
  /** What each push was answered, by its id: a retry is answered the same way. */
  private readonly answered = new Map<string, PushAnswer>()

  constructor(
    private readonly clock: Clock,
    seeded: readonly Seeded[],
    private readonly plant: Plant | null = null,
  ) {
    this.tree = treeState(
      seeded.map((note, index) => ({
        id: note.id,
        kind: 'note' as const,
        parent: null,
        name: note.name,
        deleted: false,
        seq: index + 1,
        docSeq: index + 1,
      })),
    )
    for (const note of seeded) {
      const doc = new Y.Doc()
      Y.applyUpdateV2(doc, seedUpdate(note.id, 1, note.text))
      this.docs.set(note.id, { doc, seq: 1, at: 0 })
    }
  }

  /** Remembers when and by whom every entry changed since `cursor`, for the feed. */
  private stamp(since: number, device: string) {
    for (const entry of this.tree.entries.values()) {
      if (entry.seq <= since) continue
      this.changedAt.set(entry.id, this.clock.now)
      this.changedBy.set(entry.id, device)
    }
  }

  async handle(device: string, route: Route, body: Uint8Array): Promise<Uint8Array> {
    const value = unframe(body)
    const before = this.tree.cursor
    const answer = this.answer(device, route, value)
    this.stamp(before, device)
    return Promise.resolve(frame(answer))
  }

  private answer(device: string, route: Route, value: unknown) {
    switch (route) {
      case 'ops':
        return this.ops(device, value)
      case 'feed':
        return this.feed(value)
      case 'pull':
        return this.pull(value)
      case 'push':
        return this.push(device, value)
      case 'keep': {
        const request = keepRequestOf(value)
        if (!request) throw new Error('keep: not a request')
        this.versions.push(request.text)
        return { ok: true }
      }
    }
  }

  private ops(device: string, value: unknown) {
    const request = opsRequestOf(value)
    if (!request) throw new Error('ops: not a request')

    const results: OpResult[] = request.ops.map((op) => {
      // The planted bug: a delete that never asks whether anybody wrote since.
      const judged =
        this.plant === 'delete-without-seen' && op.t === 'delete'
          ? { ...op, seen: Number.MAX_SAFE_INTEGER }
          : op
      const result = applyOp(this.tree, judged, { role: 'owner', device })
      if (op.t === 'create' && 'id' in result && DOCUMENTS.has(op.kind) && !this.docs.has(op.id)) {
        this.docs.set(op.id, { doc: new Y.Doc(), seq: 0, at: this.clock.now })
      }
      return result
    })
    return { results, cursor: this.tree.cursor }
  }

  private feed(value: unknown) {
    if (!isRecord(value) || typeof value.since !== 'number') throw new Error('feed: no since')
    const since = value.since
    const changed = [...this.tree.entries.values()]
      .filter((entry) => entry.seq > since)
      .sort((a, b) => a.seq - b.seq)
    const page = changed.slice(0, FEED_PAGE)

    const items: FeedItem[] = page.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      parent: entry.parent,
      name: entry.name,
      deleted: entry.deleted,
      seq: entry.seq,
      docSeq: entry.docSeq,
      epoch: 1,
      hash: '',
      size: 0,
      by: this.changedBy.get(entry.id) ?? '',
      at: this.changedAt.get(entry.id) ?? 0,
    }))
    const last = page.at(-1)
    const more = changed.length > page.length
    return { items, cursor: more && last ? last.seq : this.tree.cursor, more }
  }

  private pull(value: unknown) {
    const request = pullRequestOf(value)
    if (!request) throw new Error('pull: not a request')

    const docs: PullAnswer[] = request.docs.map(({ id, sv }) => {
      const held = this.docs.get(id)
      if (!held) return { id, refused: 'gone' }
      return { id, update: Y.encodeStateAsUpdateV2(held.doc, sv), seq: held.seq }
    })
    return { docs }
  }

  private push(device: string, value: unknown) {
    const request = pushRequestOf(value)
    if (!request) throw new Error('push: not a request')

    const docs: PushAnswer[] = request.docs.map((pushed) => {
      const held = this.docs.get(pushed.id)
      if (!held) return { id: pushed.id, refused: 'gone' }
      const before = this.answered.get(pushed.push)
      if (before) return before

      if (pushed.seq !== held.seq) {
        return {
          id: pushed.id,
          moved: Y.encodeStateAsUpdateV2(held.doc, pushed.base),
          seq: held.seq,
          sv: Y.encodeStateVector(held.doc),
          at: held.at,
        }
      }

      Y.applyUpdateV2(held.doc, pushed.update)
      held.seq += 1
      held.at = this.clock.now
      contentChanged(this.tree, pushed.id, device)
      const answer: PushAnswer = {
        id: pushed.id,
        ok: true,
        seq: held.seq,
        sv: Y.encodeStateVector(held.doc),
      }
      this.answered.set(pushed.push, answer)
      return answer
    })
    return { docs }
  }

  async view(): Promise<AccountView> {
    const entries = [...this.tree.entries.values()]
      .filter((entry) => !entry.deleted)
      .map(({ id, kind, parent, name }) => ({ id, kind, parent, name }))
    const texts: Record<string, string> = {}
    for (const entry of entries) {
      const held = this.docs.get(entry.id)
      if (held) texts[entry.id] = held.doc.getText(TEXT).toJSON()
    }
    return Promise.resolve({ entries, texts, versions: [...this.versions] })
  }
}
