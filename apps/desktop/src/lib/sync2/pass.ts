/** One pass over one space (docs/sync-v2.md sections 5.9, 5.12 and 7).
 *
 *  In order, each step writing down what it learned before the next request goes out:
 *
 *  1. the losing sides of answers and small overlaps, to the account's history;
 *  2. the outbox, folded (`coalesce`), through `ops`, 200 at a time - each answer puts
 *     the entry where the account put it, and a refused delete brings the note back;
 *  3. the feed since the cursor, applied in the account's order;
 *  4. the disk made to agree with the tree: moves, folders, what the account deleted;
 *  5. every document the feed said moved, pulled 200 at a time and written to its file;
 *  6. a day's note the account merged into one that was already there;
 *  7. every document with pending edits, pushed 50 at a time: `ok` confirms them,
 *     `moved` is classified (rejoin.ts).
 *
 *  A pass stops quietly the moment a request goes unanswered - offline, or lost - and
 *  the next one starts where the store says this one got to. A document a live room's
 *  socket carries is the socket's: a pass neither pulls nor pushes it. */

import { coalesce } from '@nib/sync-core/outbox'
import {
  feedPageOf,
  type FeedItem,
  OPS_BATCH,
  opsResponseOf,
  PULL_BATCH,
  pullResponseOf,
  PUSH_BATCH,
  pushResponseOf,
  type Op,
  type PullDoc,
  type PushDoc,
} from '@nib/sync-core/wire'
import * as Y from 'yjs'
import { Core, type Holding } from './core'
import type { Doc } from './docs'
import { MINE } from './docs'
import { foldIn } from './ingest'
import { fileOfUpdates, judge, shapeOf, turn } from './kinds'
import { settle, type SpaceState } from './places'
import { project } from './project'
import { againstBytes, type Merging, outgoingBytes } from './records'
import { keepLosers, rejoin } from './rejoin'
import { put, remove, type Change, type EntryRow } from './store'
import { Refused } from './transport'

/** What a pass did, for the log and the light. */
export interface Passed {
  pulled: number
  pushed: number
  /** Whether it got to the end: false when a request went unanswered. */
  finished: boolean
}

const EMPTY_SV = Y.encodeStateVector(new Y.Doc())

/** How many times a pass goes round its pulls: a document on a new epoch is pulled
 *  again from nothing, which is one more round. */
const ROUNDS = 4

export async function pass(core: Core, space: SpaceState): Promise<Passed> {
  const life = core.life
  const alive = () => core.life === life
  const passed: Passed = { pulled: 0, pushed: 0, finished: false }

  await core.commit(flushAll(core))
  if (!alive()) return passed
  if (!(await sendKeeps(core, space, alive))) return passed
  if (!(await sendOps(core, space, alive))) return passed
  if (!(await readFeed(core, space, alive))) return passed
  await settleDisk(core, space)
  if (!alive()) return passed
  for (let round = 0; round < ROUNDS; round += 1) {
    const pulled = await pullDocs(core, space, alive)
    if (pulled === null) return passed
    passed.pulled += pulled
    if (!pulled) break
  }
  await mergeDays(core, space)
  if (!alive()) return passed
  const pushed = await pushDocs(core, space, alive)
  if (pushed === null) return passed
  passed.pushed = pushed
  // Ops a merge or a refusal queued go up with the next pass, which a waiting outbox
  // asks for; see the engine.
  passed.finished = true
  return passed
}

/** Every pause's worth of typing, into the store. */
function flushAll(core: Core): Change[] {
  for (const doc of core.docs.values()) doc.flush()
  return core.dirtyChanges()
}

async function ask(
  core: Core,
  space: SpaceState,
  route: Parameters<Core['world']['account']['ask']>[0],
  body: object,
) {
  return await core.world.account.ask(route, body, space.id)
}

// ---------------------------------------------------------------------------
// 1. Versions

async function sendKeeps(core: Core, space: SpaceState, alive: () => boolean): Promise<boolean> {
  for (const one of [...space.outbox]) {
    if (one.record.t !== 'keep') continue
    try {
      const reply = await ask(core, space, 'keep', one.record.keep)
      if (!alive() || reply === null) return false
    } catch (error) {
      if (!(error instanceof Refused)) throw error
      // A note the account no longer has, or may not write: the words are in this
      // device's own history, which is where they were kept first.
      if (!alive()) return false
    }
    space.outbox = space.outbox.filter((other) => other !== one)
    await core.commit([remove('outbox', one.row.op_id)])
  }
  return true
}

// ---------------------------------------------------------------------------
// 2. The tree

async function sendOps(core: Core, space: SpaceState, alive: () => boolean): Promise<boolean> {
  for (let round = 0; round < 1000; round += 1) {
    const ops = space.outbox.filter((one) => one.record.t === 'op')
    if (!ops.length) return true

    // What has not gone yet is folded; what may have gone goes again as it was.
    const waiting = ops.filter((one) => one.record.t === 'op' && !one.record.sent)
    const folded = coalesce(
      waiting
        .map((one) => (one.record.t === 'op' ? one.record.op : null))
        .filter((op): op is Op => op !== null),
    )
    const changes: Change[] = []
    const kept = new Set(folded.map((op) => op.op))
    for (const one of waiting) {
      if (one.record.t !== 'op' || kept.has(one.record.op.op)) continue
      space.outbox = space.outbox.filter((other) => other !== one)
      changes.push(remove('outbox', one.row.op_id))
    }
    for (const op of folded) {
      const one = space.outbox.find(
        (other) => other.record.t === 'op' && other.record.op.op === op.op,
      )
      if (!one) continue
      one.record = { t: 'op', op }
      one.row = { ...one.row, op: outgoingBytes(one.record) }
      changes.push(put('outbox', one.row))
    }

    const batch = space.outbox.filter((one) => one.record.t === 'op').slice(0, OPS_BATCH)
    for (const one of batch) {
      if (one.record.t !== 'op') continue
      one.record = { t: 'op', op: one.record.op, sent: true }
      one.row = { ...one.row, op: outgoingBytes(one.record) }
      changes.push(put('outbox', one.row))
    }
    space.changed()
    await core.commit(changes)
    if (!alive()) return false

    const sent = batch.flatMap((one) => (one.record.t === 'op' ? [one.record.op] : []))
    const reply = await ask(core, space, 'ops', { ops: sent })
    if (!alive() || reply === null) return false
    const answer = opsResponseOf(reply)
    if (!answer) throw new Error('the account answered the ops with something else')

    const done: Change[] = []
    for (const result of answer.results) {
      const one = space.outbox.find(
        (other) => other.record.t === 'op' && other.record.op.op === result.op,
      )
      if (one?.record.t !== 'op') continue
      const op = one.record.op
      space.outbox = space.outbox.filter((other) => other !== one)
      done.push(remove('outbox', one.row.op_id))

      if ('merged' in result && op.t === 'create') {
        const merge: Merging = { mine: op.id, into: result.merged, create: op }
        const { one: queued, change } = core.outgoing(
          space,
          { t: 'merge', merge },
          space.row.cursor,
        )
        space.outbox.push(queued)
        done.push(change, core.counterRow())
        continue
      }
      if ('refused' in result) {
        done.push(...refused(core, space, op, result.refused))
        continue
      }
      done.push(...core.entryChanges(space.answered(op, result)))
    }
    space.changed()
    await core.commit(done)
    if (!alive()) return false
    // An op the account never answered (a batch cut short) goes again next round.
  }
  return true
}

/** An op the account would not apply. Nothing of this device's is lost by any of them:
 *  the op comes out of what is shown, and the tree reads as the account has it. */
function refused(core: Core, space: SpaceState, op: Op, why: string): Change[] {
  // A delete of something another device had written in since: the note stays, and
  // this device is told so once its words are back.
  if (op.t === 'delete' && why === 'edited') {
    const entry = space.entries.get(op.id)
    if (entry)
      core.events.resurrected?.({ id: op.id, name: entry.name, device: core.by.get(op.id) ?? '' })
    return []
  }
  // A note made here whose folder the account no longer has: made again at the top of
  // the space, rather than its words waiting on a folder that is not coming back.
  if (op.t === 'create' && why === 'gone' && op.parent !== null) {
    const again: Op = { ...op, op: core.nextId('o'), parent: null, seen: space.row.cursor }
    const { one, change } = core.outgoing(space, { t: 'op', op: again }, space.row.cursor)
    space.outbox.push(one)
    return [change, core.counterRow()]
  }
  return []
}

/** Reads the feed from the space's cursor to its end, each page written down with the
 *  cursor that moved past it. `heard` hears every item, for a first pass that needs
 *  more of them than the tree keeps. Answers whether it got to the end. */
export async function readFeed(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
  heard?: (item: FeedItem) => void,
): Promise<boolean> {
  for (let page = 0; page < 10_000; page += 1) {
    const reply = await ask(core, space, 'feed', { since: space.row.cursor })
    if (!alive() || reply === null) return false
    const read = feedPageOf(reply)
    if (!read) throw new Error('the account answered the feed with something else')

    const changes: Change[] = []
    const wanted = core.wanted(space.id)
    for (const item of read.items) {
      heard?.(item)
      core.by.set(item.id, item.by)
      const had = space.entries.get(item.id)
      if (had && had.seq !== null && had.seq >= item.seq) continue
      const entry: EntryRow = had ?? {
        id: item.id,
        space_id: space.id,
        kind: item.kind,
        parent: item.parent,
        name: item.name,
        local_path: '',
        file_key: null,
        written_hash: null,
        mtime: null,
        size: null,
        seq: item.seq,
        deleted: item.deleted,
      }
      entry.kind = item.kind
      entry.parent = item.parent
      entry.name = item.name
      entry.deleted = item.deleted
      entry.seq = item.seq
      space.entries.set(item.id, entry)
      changes.push(put('entries', { ...entry }))

      if (item.epoch !== undefined) core.epochs.set(item.id, item.epoch)
      if (shapeOf(item.kind) && item.docSeq !== undefined) {
        const pulled = core.numbers.get(item.id)?.pulled ?? -1
        if (item.docSeq > pulled || !core.hasDoc(item.id)) {
          wanted.set(item.id, { docSeq: item.docSeq, epoch: item.epoch ?? 1 })
        }
      }
    }

    const asked = space.row.cursor
    space.row.cursor = Math.max(space.row.cursor, read.cursor)
    changes.push(put('spaces', { ...space.row }), core.wantChange(space.id))
    space.changed()
    await core.commit(changes)
    if (!alive()) return false
    if (!read.more || space.row.cursor === asked) return true
  }
  return true
}

/** The disk, made to agree with the tree. */
async function settleDisk(core: Core, space: SpaceState) {
  const forgets: Change[] = []
  const moved = await settle(space, {
    disk: core.world.disk,
    join: (folder, path) => core.world.join(folder, path),
    keeps: (id) => core.hasPending(id) || core.isHeld(id),
    forget: (id) => forgets.push(...core.forgetChanges(id)),
  })
  await core.commit([...core.entryChanges(moved), ...forgets])
}

// ---------------------------------------------------------------------------
// 5. Pulls

/** Whether a document may be pulled now: shown, this device's to read into, and holding
 *  nothing of this device's that has not gone up. A pull never lands on pending edits
 *  made while apart: those go up first and meet the account's words as `moved`. */
function pullable(core: Core, space: SpaceState, entry: EntryRow): boolean {
  if (!Core.isDocument(entry) || entry.seq === null || !space.isLive(entry.id)) return false
  if (core.isHeld(entry.id) || core.carried.has(entry.id) || core.hasPending(entry.id)) return false
  return core.wanted(space.id).has(entry.id) || !core.hasDoc(entry.id)
}

/** Pulls one batch. Answers how many documents it brought, or null when the account did
 *  not answer. */
async function pullDocs(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
): Promise<number | null> {
  const due = [...space.entries.values()].filter((entry) => pullable(core, space, entry))
  if (!due.length) return 0
  const wanted = core.wanted(space.id)

  let brought = 0
  for (let at = 0; at < due.length; at += PULL_BATCH) {
    const batch = due.slice(at, at + PULL_BATCH)
    const asking: PullDoc[] = []
    /** What each document was when it was asked about: an answer is a diff against
     *  that, and lands on nothing else. */
    const asked = new Map<string, Doc | null>()
    for (const entry of batch) {
      const doc = await core.doc(entry.id)
      const epoch = doc?.epoch ?? wanted.get(entry.id)?.epoch ?? 1
      asked.set(entry.id, doc)
      asking.push({ id: entry.id, epoch, sv: doc ? doc.confirmedSv() : EMPTY_SV })
    }
    const reply = await ask(core, space, 'pull', { docs: asking })
    if (!alive() || reply === null) return null
    const answer = pullResponseOf(reply)
    if (!answer) throw new Error('the account answered the pull with something else')

    const changes: Change[] = []
    for (const one of answer.docs) {
      const entry = space.entries.get(one.id)
      if (!entry) continue
      // Typed into, or held, while the pull was in the air: the push brings the
      // account's words back through `moved`, where they are classified.
      if (core.hasPending(one.id) || core.isHeld(one.id) || core.carried.has(one.id)) continue

      if ('refused' in one) {
        wanted.delete(one.id)
        continue
      }
      const shape = shapeOf(entry.kind) ?? 'words'
      let doc = await core.doc(one.id)
      // Deleted, dropped or made again here while the pull was in the air: the answer
      // is a diff against a document this device no longer holds.
      if (doc !== (asked.get(one.id) ?? null) || !space.isLive(one.id)) continue

      if ('epoch' in one) {
        // A new epoch, with nothing here that is not the account's: this device starts
        // the new document from nothing, and the next round pulls it whole.
        if (doc) {
          doc.restart(Y.encodeStateAsUpdateV2(new Y.Doc()), 0, one.epoch, core.freshClient())
          doc.pulled = 0
          changes.push(...core.docChanges(doc))
        }
        wanted.set(one.id, { docSeq: wanted.get(one.id)?.docSeq ?? 0, epoch: one.epoch })
        brought += 1
        continue
      }

      doc ??= core.made(one.id, shape, wanted.get(one.id)?.epoch ?? 1)
      doc.took(one.update, one.seq)
      doc.pulled = Math.max(doc.pulled, wanted.get(one.id)?.docSeq ?? 0)
      wanted.delete(one.id)
      changes.push(...core.docChanges(doc))
      changes.push(...(await foldedThenProjected(core, space, entry, doc)))
      brought += 1
    }
    changes.push(core.wantChange(space.id))
    await core.commit(changes)
    if (!alive()) return null
  }
  return brought
}

/** A file written with a document's words - after any change another program made to it
 *  since nib last wrote it has been folded in, so nothing is written over. */
async function foldedThenProjected(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  doc: Doc,
): Promise<Change[]> {
  const changes = entry.local_path ? await foldIn(core, space, entry) : []
  if (core.isHeld(entry.id)) return changes
  return [...changes, ...(await project(core, space, entry, doc))]
}

// ---------------------------------------------------------------------------
// 6. A day's note, twice

async function mergeDays(core: Core, space: SpaceState) {
  for (const one of [...space.outbox]) {
    if (one.record.t !== 'merge') continue
    const { mine, into, create } = one.record.merge
    const changes: Change[] = []
    const ours = await core.doc(mine)
    const words = ours?.text() ?? null
    const done = () => {
      space.outbox = space.outbox.filter((other) => other !== one)
      changes.push(remove('outbox', one.row.op_id))
    }

    if (words === null) {
      done()
      await core.commit(changes)
      continue
    }

    // The note it was to go into was deleted meanwhile: it is made after all, as a
    // note of its own, rather than its words waiting for a note that will not come.
    const target = space.entries.get(into)
    if (target?.deleted) {
      const plain: Op = { ...create, op: core.nextId('o'), seen: space.row.cursor }
      delete (plain as { mergeable?: unknown }).mergeable
      const { one: queued, change } = core.outgoing(space, { t: 'op', op: plain }, space.row.cursor)
      space.outbox.push(queued)
      done()
      await core.commit([...changes, change, core.counterRow()])
      continue
    }

    const theirs = await core.doc(into)
    if (!theirs || !target || core.hasPending(into) || core.isHeld(into)) continue
    const base = create.mergeable?.text ?? ''
    const remote = theirs.text()
    const times = { local: ours?.pendingAt ?? 0, remote: theirs.pendingAt }
    const judged = judge(theirs.shape, base, words, remote, times)
    const held = judged.resolution === null
    core.classified.push({
      id: into,
      base,
      local: words,
      remote,
      times,
      held,
      ...(judged.merged === undefined ? {} : { merged: judged.merged }),
    })

    if (judged.resolution === null) {
      const against = { t: 'merge', base, local: words, from: mine } as const
      const holding: Holding = {
        row: {
          id: into,
          remote: againstBytes(against),
          remote_sv: new Uint8Array(),
          device: core.by.get(into) ?? null,
          at: core.world.now(),
        },
        against,
      }
      changes.push(...core.holdChanges(holding))
    } else {
      const resolution = judged.resolution
      changes.push(...keepLosers(core, space, into, judged.lost, words, remote))
      theirs.write((live) => turn(theirs.shape, live, remote, resolution, MINE))
      theirs.flush()
      changes.push(...core.docChanges(theirs))
      changes.push(...(await project(core, space, target, theirs)))
    }

    // This device's own day note goes: its words are in the one that was there.
    const own = space.entries.get(mine)
    if (own?.local_path && !core.pinned.has(mine)) {
      const full = core.world.join(space.row.root, own.local_path)
      if (await core.world.disk.exists(full)) await core.world.disk.remove(full, 'file')
    }
    space.entries.delete(mine)
    changes.push(remove('entries', mine), ...core.forgetChanges(mine))
    done()
    space.changed()
    await core.commit(changes)
  }
}

// ---------------------------------------------------------------------------
// 7. Pushes

function pushable(core: Core, entry: EntryRow): boolean {
  if (!Core.isDocument(entry) || entry.seq === null) return false
  if (core.isHeld(entry.id) || core.carried.has(entry.id)) return false
  return core.hasPending(entry.id)
}

/** Answers how many documents went up, or null when the account did not answer. */
async function pushDocs(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
): Promise<number | null> {
  const due = [...space.entries.values()].filter((entry) => pushable(core, entry))
  let pushed = 0

  for (let at = 0; at < due.length; at += PUSH_BATCH) {
    const going: PushDoc[] = []
    const docs = new Map<string, Doc>()
    const before: Change[] = []
    for (const entry of due.slice(at, at + PUSH_BATCH)) {
      const doc = await core.doc(entry.id)
      if (!doc) continue
      doc.flush()
      const out = doc.outgoing(() => core.nextId('p'))
      if (!out) continue
      docs.set(doc.id, doc)
      going.push({
        id: doc.id,
        push: out.push,
        epoch: doc.epoch,
        seq: doc.seq,
        base: doc.confirmedSv(),
        update: out.update,
        at: doc.pendingAt,
      })
      before.push(...core.docChanges(doc))
    }
    if (!going.length) continue
    // The push is written down before it goes, so a lost answer sends it again as it was.
    await core.commit([...before, core.counterRow()])
    if (!alive()) return null

    const reply = await ask(core, space, 'push', { docs: going })
    if (!alive() || reply === null) return null
    const answer = pushResponseOf(reply)
    if (!answer) throw new Error('the account answered the push with something else')

    const changes: Change[] = []
    for (const one of answer.docs) {
      const doc = docs.get(one.id)
      const entry = space.entries.get(one.id)
      // Deleted here while the push was in the air: nothing of it goes on.
      if (!doc || !entry || !core.current(doc)) continue
      if ('ok' in one) {
        doc.confirmFlight(one.seq)
        pushed += 1
      } else if ('moved' in one) {
        doc.land()
        if (!core.isHeld(one.id)) {
          changes.push(
            ...rejoin(core, space, doc, one.moved, one.seq, one.at, core.by.get(one.id) ?? null)
              .changes,
          )
          if (!core.isHeld(one.id)) changes.push(...(await project(core, space, entry, doc)))
        }
      } else if ('epoch' in one) {
        doc.land()
        changes.push(...(await newEpoch(core, space, entry, doc, one.epoch)))
      } else {
        // Refused: a note gone from the account, one this device may only read, or an
        // update past the ceiling. What it holds stays here, pending, and says so in
        // the log rather than being thrown away.
        doc.land()
      }
      changes.push(...core.docChanges(doc))
    }
    await core.commit(changes)
    if (!alive()) return null
  }
  return pushed
}

/** The account started the document again at a new epoch while this device held pending
 *  edits on the old one (section 5.3). The operations cannot be merged into the new
 *  document, so the fallback is three texts: the confirmed words as the ancestor, this
 *  device's, and the new document's. The document becomes the account's, and this
 *  device's edits go in as operations or, when they overlap too much, wait for the
 *  modal as another program's edit to the file would. */
async function newEpoch(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  doc: Doc,
  epoch: number,
): Promise<Change[]> {
  const reply = await ask(core, space, 'pull', { docs: [{ id: doc.id, epoch, sv: EMPTY_SV }] })
  const answer = reply === null ? null : pullResponseOf(reply)
  const whole = answer?.docs.find((one) => one.id === doc.id)
  if (!whole || !('update' in whole)) return []

  const base = doc.confirmedText()
  const local = doc.text()
  const remote = fileOfUpdates(doc.shape, whole.update)
  doc.restart(whole.update, whole.seq, epoch, core.freshClient())
  if (local === remote || local === base) return await project(core, space, entry, doc)

  const times = { local: doc.pendingAt, remote: core.world.now() }
  const judged = judge(doc.shape, base, local, remote, times)
  core.classified.push({
    id: doc.id,
    base,
    local,
    remote,
    times,
    held: judged.resolution === null,
    ...(judged.merged === undefined ? {} : { merged: judged.merged }),
  })
  if (judged.resolution === null) {
    const against = { t: 'file', base, local } as const
    return core.holdChanges({
      row: {
        id: doc.id,
        remote: againstBytes(against),
        remote_sv: new Uint8Array(),
        device: core.by.get(doc.id) ?? null,
        at: core.world.now(),
      },
      against,
    })
  }
  const resolution = judged.resolution
  const changes = keepLosers(core, space, doc.id, judged.lost, local, remote)
  doc.write((live) => turn(doc.shape, live, remote, resolution, MINE))
  doc.flush()
  changes.push(...core.docChanges(doc), ...(await project(core, space, entry, doc)))
  return changes
}
