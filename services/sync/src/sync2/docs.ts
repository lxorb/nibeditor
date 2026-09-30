/** Documents, in batches: what a device is missing, what it wrote while apart, and the
 *  words that lost a modal answer (docs/sync-v2.md sections 5.2 to 5.4 and 7).
 *
 *  A pull never wakes a room. Every room writes its document to the bucket at every
 *  settle, and a note whose room has not woken since it was given an epoch is exactly
 *  the seed of the words it has, which this computes as any device would; the room is
 *  asked only for a note in neither state, which is a note somebody wrote between its
 *  epoch being marked and its room waking.
 *
 *  A push goes to each document's room, which applies it and writes it down before it
 *  answers, or answers `moved`. The rooms are asked a few at a time: every one is a
 *  request of its own, and a Worker keeps only so many open at once.
 *
 *  Who may do what is asked per document, since one batch can span every space a
 *  device reaches: the space at its role, or one file shared on its own. */

import { diffUpdateV2 } from 'yjs'
import {
  type DocRefusal,
  frame,
  type KeepRequest,
  MOST_UPDATE_BYTES,
  type PullAnswer,
  type PullDoc,
  type PushAnswer,
  type PushDoc,
  type SnapshotDoc,
  unframe,
} from '@nib/sync-core'
import { sha256 } from '../crypto'
import { noteKey } from '../notes'
import { askRoom } from '../rooms'
import { seedOf, seedsAnything, snapshotKey } from '../rooms/epoch'
import { roomKind } from '../rooms/kind'
import { allows, reachedItem, reachedSpace, type Role } from '../spaces/space'
import type { Env, Note, Whoever } from '../types'
import { keepVersionNow } from '../versions'
import { prepareSpace } from './prepare'
import { DOCUMENT_KINDS, DOCUMENTS_SQL } from './tree'

/** A note a batch names, and what the asker may do with it. */
interface Reached {
  note: Note
  role: Role
}

/** Every note a batch names that the asker can reach, by id. One query for the notes
 *  and one per space they are in; a note in a space the asker cannot reach is asked
 *  about on its own, as a file somebody was handed. */
async function reachedNotes(
  env: Env,
  who: Whoever,
  ids: readonly string[],
): Promise<Map<string, Reached>> {
  const { results } = await env.DB.prepare(
    'select * from notes where id in (select value from json_each(?))',
  )
    .bind(JSON.stringify([...new Set(ids)]))
    .all<Note>()

  const spaces = new Map<string, Role | null>()
  const out = new Map<string, Reached>()
  for (const note of results) {
    if (!spaces.has(note.space_id)) {
      spaces.set(note.space_id, (await reachedSpace(env, who, note.space_id))?.role ?? null)
    }
    const role = spaces.get(note.space_id) ?? null
    if (role) {
      out.set(note.id, { note, role })
      continue
    }
    if (note.deleted) continue
    const item = await reachedItem(env, who, note)
    if (item) out.set(note.id, { note, role: item.role })
  }
  return out
}

/** The notes of these that are on no epoch yet, with their spaces prepared and the
 *  rows read again: a device that asks for a document of a space nobody prepared is a
 *  device that has just been moved to v2. */
async function onEpochs(env: Env, found: Map<string, Reached>): Promise<void> {
  const spaces = new Set<string>()
  for (const { note } of found.values()) {
    if ((note.epoch ?? 0) === 0 && DOCUMENT_KINDS.has(note.kind ?? 'note')) spaces.add(note.space_id)
  }
  if (!spaces.size) return

  for (const space of spaces) await prepareSpace(env, space)
  const ids = [...found.values()].filter(({ note }) => spaces.has(note.space_id))
  for (const { note } of ids) {
    const fresh = await env.DB.prepare('select * from notes where id = ?')
      .bind(note.id)
      .first<Note>()
    const held = found.get(note.id)
    if (fresh && held) held.note = fresh
  }
}

/** What a document is as a snapshot, and its version: the bucket's copy when the room
 *  has written one at this epoch, the seed of its words when the room has not woken
 *  since; null when neither holds, and only the room can say. */
export async function documentOf(
  env: Env,
  note: Note,
): Promise<{ update: Uint8Array; seq: number } | null> {
  const epoch = note.epoch ?? 0
  const kept = await env.NOTES.get(snapshotKey(note.id))
  if (kept && kept.customMetadata?.epoch === String(epoch)) {
    return {
      update: new Uint8Array(await kept.arrayBuffer()),
      seq: Number(kept.customMetadata.seq ?? 0) || 0,
    }
  }

  const object = await env.NOTES.get(noteKey(note.space_id, note.id))
  const body = object ? await object.text() : ''
  if ((await sha256(body)) !== note.epoch_base) return null

  const update = seedOf(roomKind(note.path), note.id, epoch, body)
  return { update, seq: seedsAnything(update) ? 1 : 0 }
}

/** `POST /v2/docs/pull`. */
export async function pullDocs(
  env: Env,
  who: Whoever,
  docs: readonly PullDoc[],
): Promise<PullAnswer[]> {
  const found = await reachedNotes(
    env,
    who,
    docs.map((doc) => doc.id),
  )
  await onEpochs(env, found)

  const answers: PullAnswer[] = []
  for (const doc of docs) answers.push(await pulled(env, found.get(doc.id), doc))
  return answers
}

async function pulled(env: Env, found: Reached | undefined, doc: PullDoc): Promise<PullAnswer> {
  const note = found?.note
  if (!note || !DOCUMENT_KINDS.has(note.kind ?? 'note')) return { id: doc.id, refused: 'gone' }

  const epoch = note.epoch ?? 0
  if (epoch !== doc.epoch) return { id: doc.id, epoch, epochBase: note.epoch_base ?? '' }

  try {
    const held = await documentOf(env, note)
    if (held) return { id: doc.id, update: diffUpdateV2(held.update, doc.sv), seq: held.seq }

    const answer = await askRoom(env, note, 'pull', frame({ sv: doc.sv }))
    if (!answer?.ok) return { id: doc.id, refused: 'gone' }
    const said = roomAnswer(new Uint8Array(await answer.arrayBuffer()))
    const { update, seq } = said
    if (update instanceof Uint8Array && typeof seq === 'number') return { id: doc.id, update, seq }
  } catch {
    // A state vector that does not read as one names nothing to diff against.
  }
  return { id: doc.id, refused: 'gone' }
}

function roomAnswer(bytes: Uint8Array): Record<string, unknown> {
  const value = unframe(bytes)
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** How many rooms one push asks at once: a Worker keeps six connections open at a
 *  time, and a request to an object is one of them. */
const AT_ONCE = 6

/** `POST /v2/docs/push`. */
export async function pushDocs(
  env: Env,
  who: Whoever,
  device: string,
  name: string,
  docs: readonly PushDoc[],
): Promise<PushAnswer[]> {
  const found = await reachedNotes(
    env,
    who,
    docs.map((doc) => doc.id),
  )
  await onEpochs(env, found)

  const answers: PushAnswer[] = new Array<PushAnswer>(docs.length)
  let next = 0
  const worker = async () => {
    for (let at = next++; at < docs.length; at = next++) {
      const doc = docs[at]
      if (doc) answers[at] = await pushed(env, found.get(doc.id), doc, device, name)
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, docs.length) }, worker))
  return answers
}

function refused(id: string, why: DocRefusal): PushAnswer {
  return { id, refused: why }
}

async function pushed(
  env: Env,
  found: Reached | undefined,
  doc: PushDoc,
  device: string,
  name: string,
): Promise<PushAnswer> {
  const note = found?.note
  if (!note || !DOCUMENT_KINDS.has(note.kind ?? 'note')) return refused(doc.id, 'gone')
  if (!found || !allows(found.role, 'write')) return refused(doc.id, 'role')
  if (doc.update.length > MOST_UPDATE_BYTES) return refused(doc.id, 'large')

  const epoch = note.epoch ?? 0
  if (epoch !== doc.epoch) return { id: doc.id, epoch }

  const answer = await askRoom(
    env,
    note,
    'push',
    frame({
      push: doc.push,
      epoch: doc.epoch,
      seq: doc.seq,
      base: doc.base,
      update: doc.update,
      at: doc.at,
      device,
      name,
    }),
  )
  if (!answer?.ok) return refused(doc.id, 'gone')

  const said = roomAnswer(new Uint8Array(await answer.arrayBuffer()))
  const { ok, seq, sv, moved, at, epoch: newer } = said
  if (ok === true && typeof seq === 'number' && sv instanceof Uint8Array) {
    return { id: doc.id, ok: true, seq, sv }
  }
  if (moved instanceof Uint8Array && typeof seq === 'number' && sv instanceof Uint8Array) {
    return { id: doc.id, moved, seq, sv, at: typeof at === 'number' ? at : 0 }
  }
  if (typeof newer === 'number') return { id: doc.id, epoch: newer }
  const why = said.refused
  return refused(doc.id, why === 'large' || why === 'role' ? why : 'gone')
}

/** `POST /v2/docs/keep`: the losing side of a modal answer, kept as a version of the
 *  note and named after the device it came from. Answers whether it was the asker's
 *  to keep. */
export async function keepDoc(
  env: Env,
  who: Whoever,
  request: KeepRequest,
): Promise<'kept' | 'gone' | 'role'> {
  const found = (await reachedNotes(env, who, [request.id])).get(request.id)
  if (!found || !DOCUMENT_KINDS.has(found.note.kind ?? 'note')) return 'gone'
  if (!allows(found.role, 'write')) return 'role'

  await keepVersionNow(env, found.note.id, request.text, request.device)
  return 'kept'
}

/** How much one page of a first sync's bulk read carries, and at most how many
 *  documents, so a page is one answer of a few megabytes and a bounded number of reads
 *  of the bucket. */
const PAGE_BYTES = 4 * 1024 * 1024
const PAGE_DOCS = 200

/** `GET /v2/spaces/:space/snapshot?after=<id>`: the documents of a space in id order,
 *  about four megabytes a page. */
export async function snapshotPage(
  env: Env,
  spaceId: string,
  after: string,
): Promise<{ docs: SnapshotDoc[]; next: string | null }> {
  const { results } = await env.DB.prepare(
    `select * from notes where space_id = ? and deleted = 0 and kind in ${DOCUMENTS_SQL}
        and id > ? order by id limit ?`,
  )
    .bind(spaceId, after, PAGE_DOCS)
    .all<Note>()

  const docs: SnapshotDoc[] = []
  let bytes = 0
  for (const note of results) {
    if (docs.length && bytes >= PAGE_BYTES) return { docs, next: docs.at(-1)?.id ?? null }

    const held = await documentOf(env, note)
    const epoch = note.epoch ?? 0
    if (!held) {
      // Only the room holds this one; the device pulls it on its own.
      continue
    }
    const doc: SnapshotDoc = { id: note.id, epoch, seq: held.seq, update: held.update }
    if (note.epoch_base) doc.epochBase = note.epoch_base
    docs.push(doc)
    bytes += held.update.length
  }

  const last = results.at(-1)
  return { docs, next: results.length === PAGE_DOCS && last ? last.id : null }
}
