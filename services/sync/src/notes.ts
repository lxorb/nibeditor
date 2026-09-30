import { type Context, Hono } from 'hono'
import { NOT_A_PATH, NO_SUCH_NOTE, OUT_OF_SPACE, ROOM_AWAY } from './refused'
import { mergeCanvasFiles } from '@nib/markdown/canvas-merge'
import { isCanvasTarget } from '@nib/markdown/links'
import { conflictPath, numbered } from '@nib/markdown/paths'
import { readBody } from './body'
import { readFront, titleFrom, writeFront } from './blog/front'
import { rememberOldPaths } from './blog/paths'
import { keepWords } from './blog/words'
import { fits } from './storage'
import { byteLength, newId, now, sha256 } from './crypto'
import {
  allows,
  atLeast,
  reachedItem,
  reachedSpace,
  refusal,
  spaceOf,
  type Reached,
} from './spaces/space'
import { laterOf, pokeSpace } from './hub/poke'
import { ingestInto } from './rooms'
import { deviceOf } from './sync2/device'
import { createByPath, deleteById, moveByPath } from './sync2/ops'
import { DOCUMENT_KINDS, kindOfName } from './sync2/tree'
import type { Env, Note, Variables, Whoever } from './types'
import {
  countVersionsAt,
  deviceIn,
  keepVersion,
  ROLLBACK_AT_ONCE,
  presentVersion,
  versionAt,
  versionsAt,
  versionsOf,
  versionKey,
} from './versions'

/** A note past what one note may be. Said at each of the three moments a body
 *  arrives: written, replaced, and rolled back to. */
const TOO_LARGE = 'that note is too large'

/** The largest note the API will take. R2 would hold more; a note this size
 *  is already a file that wants to be split, and the ceiling keeps one
 *  request from spending a tenth of an account on itself. */
export const MAX_NOTE_BYTES = 4 * 1024 * 1024
export const PATH_LIMIT = 400

/** What a note's path may end in.
 *
 *  A canvas is here beside the markdown extensions because it travels as a note
 *  rather than as a file. The two ways a space's contents reach an account are
 *  this one, which is versioned and comes back down, and the blob list beside it,
 *  which only goes up so that a published page can serve a PDF. A canvas is small
 *  text that is edited on more than one device, so it wants the first: the
 *  version, the hash and the conflict rule are exactly what a file two people
 *  draw on needs. See apps/desktop/src/lib/sync/pass.ts, which sends every file
 *  that is not a PDF through here.
 *
 *  A page note - `.pages` - is that same file under another name: JSON Canvas
 *  with pages among its nodes, merged by the very code a canvas is merged by
 *  (`roomKind` answers `plane` for one; see rooms/kind.ts). It was left out of
 *  this list, and since the mirror sends every file that is not a PDF here, that
 *  meant every page note anybody wrote was refused - on every pass, silently,
 *  for ever - and never reached a second device.
 *
 *  A website is here for the same reason and is smaller still: a shortcut file is
 *  three lines of text with an address in one of them, and it is a document of the
 *  space like any other - it goes up, comes back down, keeps its versions and can be
 *  put in the trash and taken out again. It is never in a room, which is the one way
 *  it differs from the two planes; see rooms/kind.ts. */
const NOTE_PATH = /\.(md|markdown|mdown|mkd|canvas|pages|url|webloc)$/i

/** Paths are relative, forward-slashed and named like a note. Nothing escapes
 *  the space.
 *
 *  A control character is not part of a name, for the same reason a space's name
 *  has none: the path travels into a published page, a mail, a listing and a file
 *  on somebody's disk, and a newline in one is not a folder. Refused rather than
 *  stripped, because a client that sent one did not mean the name that would be
 *  left and should be told so. */
export function cleanPath(input: string): string | null {
  const path = input.replace(/\\/g, '/').replace(/^\/+/, '').trim()

  if (!path || path.length > PATH_LIMIT) return null
  if (/\p{Cc}/u.test(path)) return null
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) return null
  if (!NOTE_PATH.test(path)) return null

  return path
}

export function noteKey(spaceId: string, noteId: string): string {
  return `spaces/${spaceId}/${noteId}`
}

/** The next cursor value for a space. Strictly increasing, so a client can ask
 *  for "everything after N" and never miss a write that shared a millisecond. */
export async function nextSeq(env: Env, spaceId: string): Promise<number> {
  const row = await env.DB.prepare(
    `insert into space_cursor (space_id, next) values (?, 2)
     on conflict(space_id) do update set next = next + 1
     returning next - 1 as seq`,
  )
    .bind(spaceId)
    .first<{ seq: number }>()

  return row?.seq ?? 1
}

/** Puts a note in a space that has nothing at that path yet: the bytes in R2,
 *  the row in D1, at the space's next cursor so every other device reads it as
 *  an ordinary arrival. Answers the note as it now stands.
 *
 *  The one place a note comes into being, so the columns a note starts life with
 *  are decided once. Neither the quota nor the path is checked here: what may be
 *  written, and by whom, is the caller's question, and the callers ask it
 *  differently - the route below, the connector, and the note every new account
 *  is given (see spaces/first.ts). */
export async function addNote(
  env: Env,
  spaceId: string,
  path: string,
  content: string,
  by = '',
  device?: string,
): Promise<Note> {
  // A space whose tree is rows makes a note the way a v2 device does, as a create in
  // the folders its path names; see sync2/ops.ts. A space nobody prepared makes it as
  // it always has.
  const space = await env.DB.prepare('select prepared_at from spaces where id = ?')
    .bind(spaceId)
    .first<{ prepared_at: number | null }>()
  if (space?.prepared_at) return await placeNote(env, spaceId, path, content, by, device)

  const note: Note = {
    id: newId(),
    space_id: spaceId,
    path,
    seq: await nextSeq(env, spaceId),
    version: 1,
    updated_at: now(),
    deleted: 0,
    deleted_at: null,
    size: byteLength(content),
    hash: await sha256(content),
    front: writeFront(content),
  }

  // The row first, then the bytes, for the reason `saveNote` gives: a space holds
  // one live note per path, so this is the write that can be refused, and bytes
  // written before it would be bytes under an id no row ever names.
  await env.DB.prepare(
    `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash, front)
     values (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      note.id,
      note.space_id,
      note.path,
      note.seq,
      note.version,
      note.updated_at,
      note.size,
      note.hash,
      note.front,
    )
    .run()

  await env.NOTES.put(noteKey(spaceId, note.id), content)

  // What the note said when it arrived is the first thing its history has to
  // say; see versions.ts.
  await keepVersion(env, note, content, by).catch(() => undefined)

  // And its words, so a site can be searched on the site. Best effort for the
  // same reason: the note is stored, and an index is rebuildable. See
  // blog/words.ts.
  await keepWords(env, note, content, titleFrom(note.path, content)).catch(() => undefined)

  return note
}

/** A note made in a space whose tree is rows: a create with a server id in the folders
 *  its path names, on the first epoch, seeded from the words it arrives with. Refused
 *  as a path that is taken - the answer a v1 app has always had - where a live note
 *  there already answers to its name as Windows and a Mac compare names. */
async function placeNote(
  env: Env,
  spaceId: string,
  path: string,
  content: string,
  by: string,
  device: string | undefined,
): Promise<Note> {
  const hash = await sha256(content)
  const document = DOCUMENT_KINDS.has(kindOfName(path))
  const placed = await createByPath(env, spaceId, device, path, {
    hash,
    size: byteLength(content),
    front: writeFront(content),
    epoch: document ? 1 : 0,
    epochBase: document ? hash : null,
  })
  if ('taken' in placed) throw new NoteTaken(placed.taken)

  const note = await env.DB.prepare('select * from notes where id = ?')
    .bind(placed.made)
    .first<Note>()
  if (!note) throw new Error('a note made in the tree is not there')

  // The row first, then the bytes, for the reason `addNote` gives.
  await env.NOTES.put(noteKey(spaceId, note.id), content)
  await keepVersion(env, note, content, by).catch(() => undefined)
  await keepWords(env, note, content, titleFrom(note.path, content)).catch(() => undefined)
  return note
}

/** A create at a path a live note already answers to. */
class NoteTaken extends Error {
  constructor(readonly id: string) {
    super('a note already lives there')
  }
}

/** The live note at a path, if there is one. */
function noteAt(env: Env, spaceId: string, path: string): Promise<Note | null> {
  return env.DB.prepare('select * from notes where space_id = ? and path = ? and deleted = 0')
    .bind(spaceId, path)
    .first<Note>()
}

/** A second copy of a note, kept beside it under the name every copy takes.
 *
 *  What it is for is the one write on this side that can drop somebody's words: a
 *  room settling its own document over a note that something which could not reach
 *  the room had written. The room cannot merge those two - it has no history for
 *  words it never saw - and the answer the app gives for exactly the same question is
 *  to keep the other copy beside the note. So does this, under the same name, so a
 *  reader who has seen one has seen both; see `conflictPath` in @nib/markdown/paths
 *  and `keptBeside` in rooms/room.ts.
 *
 *  Null when there is nowhere free to put it, which is twenty copies of one note in
 *  one day. Neither the quota nor the role is asked: the words are already in the
 *  account, this is where they are moved to rather than something new arriving, and
 *  refusing it is the loss it is there to prevent. */
export async function noteBeside(
  env: Env,
  note: Note,
  content: string,
  by = '',
): Promise<Note | null> {
  // Already kept. A device that cannot reach a note's room offers the same words
  // again on every pass until somebody looks at it, and a second copy of a copy
  // says nothing the first did not - so the words are looked for by their hash
  // before a name is found for them, and the note that holds them is the answer.
  //
  // Every note but this one. These are the words this note holds as the caller
  // reads it and is about to stop holding, which is the whole reason it is being
  // copied: finding them here would be finding the copy in the thing being
  // overwritten.
  const hash = await sha256(content)
  const kept = await env.DB.prepare(
    'select * from notes where space_id = ? and hash = ? and id != ? and deleted = 0',
  )
    .bind(note.space_id, hash, note.id)
    .first<Note>()

  if (kept) return kept

  const beside = conflictPath(note.path)

  for (let counter = 1; counter <= 20; counter += 1) {
    const path = numbered(beside, counter)
    if (await noteAt(env, note.space_id, path)) continue

    return await addNote(env, note.space_id, path, content, by)
  }

  return null
}

/** Puts a note's new contents in the store: the bytes in R2, the row in D1, with
 *  the version and the space's cursor moved on so that every other device reads
 *  it as an ordinary save. Answers the note as it now stands, and the note
 *  untouched when the bytes and the path are already what is held.
 *
 *  Null when the row has moved on since `note` was read. The write names the
 *  version it saw, so two saves that read the same row cannot both land: without
 *  that they both wrote `version + 1`, the second overwrote the first's bytes, and
 *  every device that had already seen that version number never learned there was
 *  anything newer. Which is not a race between two clients - one PUT names the
 *  version it edited and is answered 409 - but between a client and a room
 *  settling the same note a moment later, and nothing was watching for it.
 *
 *  Shared by the route below and by a room settling what several devices wrote
 *  together (see rooms/room.ts), so a note that arrives either way lands in one
 *  shape and everything that reads notes - the file sync, publishing, the
 *  connector, the glasses, search - carries on unaware there was a difference. */
/** Who a save is for and which document it is: the device that wrote the words, and
 *  the epoch the writer holds the note at. */
export interface Saving {
  docBy?: string
  epoch?: number
}

export async function saveNote(
  env: Env,
  note: Note,
  content: string,
  path: string,
  by = '',
  saving: Saving = {},
): Promise<Note | null> {
  const size = byteLength(content)
  const hash = await sha256(content)
  if (hash === note.hash && path === note.path) return note

  const seq = await nextSeq(env, note.space_id)
  const words = hash !== note.hash
  const updated: Note = {
    ...note,
    path,
    seq,
    version: note.version + 1,
    updated_at: now(),
    deleted: 0,
    size,
    hash,
    front: writeFront(content),
    // What sync v2's feed says about the words moving, and who moved them; see
    // sync2/tree.ts.
    doc_seq: words ? seq : (note.doc_seq ?? null),
    doc_by: words ? (saving.docBy ?? null) : (note.doc_by ?? null),
    updated_by: saving.docBy ?? null,
  }

  // The row first, because naming the version in it is what claims the write.
  // The bytes follow only once that has landed: a save that lost the claim must
  // not have replaced the bucket's copy, which the winner's row now describes.
  //
  // And the epoch: once a note has a document its room is the only thing that writes
  // it (docs/sync-v2.md section 5.3), so a writer that read the note before it had one
  // loses the claim as surely as one that read an older version.
  const written = await env.DB.prepare(
    `update notes set path = ?, seq = ?, version = ?, updated_at = ?, deleted = 0, size = ?,
                      hash = ?, front = ?, doc_seq = ?, doc_by = ?, updated_by = ?
      where id = ? and version = ? and epoch = ?`,
  )
    .bind(
      updated.path,
      updated.seq,
      updated.version,
      updated.updated_at,
      updated.size,
      updated.hash,
      updated.front,
      updated.doc_seq ?? null,
      updated.doc_by ?? null,
      updated.updated_by ?? null,
      note.id,
      note.version,
      saving.epoch ?? note.epoch ?? 0,
    )
    .run()

  if (!written.meta.changes) return null

  await env.NOTES.put(noteKey(note.space_id, note.id), content)

  // The account's own history of the note, kept from the one place every body
  // arrives through - a push, or a room settling what four devices wrote. Best
  // effort: the note is already stored, and a version that could not be written
  // is not a reason to answer the save with a failure. See versions.ts.
  await keepVersion(env, updated, content, by).catch(() => undefined)

  // And the paths this note has just stopped answering on - it was renamed, or
  // its permalink or its aliases changed - so that a link somebody else wrote
  // still lands on it. Best effort for the same reason. See blog/paths.ts.
  await rememberOldPaths(env, note, path, readFront(updated.front)).catch(() => undefined)
  await keepWords(env, updated, content, titleFrom(path, content)).catch(() => undefined)

  return updated
}

export function presentNote(note: Note) {
  return {
    id: note.id,
    path: note.path,
    seq: note.seq,
    version: note.version,
    updatedAt: note.updated_at,
    deleted: !!note.deleted,
    size: note.size,
    hash: note.hash,
  }
}

export const notes = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Everything that changed since a cursor, tombstones included, so a client
 *  that has been offline can catch up in one round trip. */
notes.get('/spaces/:spaceId/changes', atLeast('read', 'spaceId'), async (context) => {
  const space = spaceOf(context)

  // A cursor is a whole number this space handed out. Anything else - words, a
  // fraction, `1e999`, a negative - is read as the beginning, which is what a
  // client that has never asked before sends. Bound rather than passed on: a
  // value that is not finite is not something to put in front of a query.
  const asked = Math.floor(Number(context.req.query('since') ?? 0))
  const since = Number.isFinite(asked) && asked > 0 ? asked : 0

  // Never a file of sync v2's tree: a v1 app reads every row here as a note whose words
  // it fetches, and a file's bytes are a blob.
  const { results } = await context.env.DB.prepare(
    `select * from notes where space_id = ? and seq > ? and kind != 'file'
      order by seq limit 1000`,
  )
    .bind(space.id, since)
    .all<Note>()

  const cursor = results.at(-1)?.seq ?? since
  return context.json({ notes: results.map(presentNote), cursor, more: results.length === 1000 })
})

notes.post('/spaces/:spaceId/notes', atLeast('write', 'spaceId'), async (context) => {
  const space = spaceOf(context)

  const body = await readBody(context)
  const given = body.text('path', PATH_LIMIT)
  const sent = body.text('content', MAX_NOTE_BYTES)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const path = cleanPath(given ?? '')
  const content = sent ?? ''
  const size = byteLength(content)

  if (!path) return context.json({ error: NOT_A_PATH }, 400)
  if (size > MAX_NOTE_BYTES) return context.json({ error: TOO_LARGE }, 413)

  const taken = await noteAt(context.env, space.id, path)
  if (taken)
    return context.json({ error: 'a note already lives there', note: presentNote(taken) }, 409)

  // A limit nobody enforces is a number on a settings page. Counted against
  // whoever owns the space rather than whoever is writing: the bytes land in
  // their storage, so it is their quota the note has to fit inside.
  if (!(await fits(context.env, space.user_id, size))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  // The check above is not the guarantee; the space's unique index is. Two
  // devices creating one path at the same moment both got past it, and the one
  // that lost used to come back as a 500 rather than as the same 409 it would
  // have been given a moment earlier. Read again rather than told apart by the
  // error's words, which are the database's to change.
  const device = await deviceOf(context)
  let note: Note
  try {
    note = await addNote(
      context.env,
      space.id,
      path,
      content,
      deviceIn(context.req.header('x-nib-device')),
      device,
    )
  } catch (error) {
    const won =
      error instanceof NoteTaken
        ? await noteById(context.env, error.id)
        : await noteAt(context.env, space.id, path)
    if (!won) throw error

    return context.json({ error: 'a note already lives there', note: presentNote(won) }, 409)
  }

  await pokeSpace(context.env, laterOf(context), space.id, note.seq, device)
  return context.json({ note: presentNote(note) }, 201)
})

/** A note this person can reach, together with the space it sits in and the
 *  role held there. Null when the note is not there or is in a space they have
 *  nothing to do with, which are the same answer on purpose.
 *
 *  Two ways to reach one. The space, which is how almost everybody reaches
 *  almost every note; or this one file, for somebody the owner handed it to on
 *  its own. `only` says which, because the second is narrower than a role: the
 *  words are theirs to write, and the note itself - where it sits, whether it
 *  exists - is not. See docs/sharing.md.
 *
 *  The space is asked first and answers in one query, so nobody who holds the
 *  space pays for the second question. A file shared on its own has to be a live
 *  file: a note in Recently deleted is not something a share reaches into, which
 *  is also what the room's door says. */
async function reachedNote(
  env: Env,
  who: Whoever,
  noteId: string,
): Promise<{ note: Note; space: Reached; only: boolean } | null> {
  const note = await noteById(env, noteId)

  // A file of sync v2's tree is a blob by hash, never words to read or write here.
  if (!note || note.kind === 'file') return null

  const space = await reachedSpace(env, who, note.space_id)
  if (space) return { note, space, only: false }
  if (note.deleted) return null

  const item = await reachedItem(env, who, note)
  return item ? { note, space: item, only: true } : null
}

notes.get('/notes/:id', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)
  const { note } = found

  const object = await context.env.NOTES.get(noteKey(note.space_id, note.id))
  return context.json({ note: presentNote(note), content: object ? await object.text() : '' })
})

/** Every version the account holds of this note, newest first, and what one of
 *  them said.
 *
 *  Hung off the note rather than off the space, because a note is what the reader
 *  is looking at when they ask; and read through the same reachability as the
 *  note itself, so somebody who was handed one file can read its history and
 *  nothing else. See versions.ts for what is kept and for how long. */
notes.get('/notes/:id/versions', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)

  const held = await versionsOf(context.env, found.note.id)
  return context.json({ versions: held.map(presentVersion) })
})

notes.get('/notes/:id/versions/:at', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)

  const asked = Math.floor(Number(context.req.param('at')))
  const content = Number.isFinite(asked) ? await versionAt(context.env, found.note.id, asked) : null

  if (content === null) return context.json({ error: 'no such version' }, 404)
  return context.json({ at: asked, content })
})

/** Putting a space, or one folder of it, back to how it read at a moment.
 *
 *  What it writes is a new version of every note that has changed since, which is
 *  what makes it undoable: a rollback is an edit like any other, and nothing
 *  about it is special except how many notes it touches at once. A note that was
 *  written after that moment and has no version at or before it is left alone -
 *  there is nothing to put back - and so is one the account never held.
 *
 *  `dry` answers what would change without changing anything, which is what the
 *  sheet shows before the reader presses the one button that matters.
 *
 *  Bounded in writes, because a Worker is: four hundred notes at a time. A space
 *  with more than that says so - `partial`, and how many there are in all - and
 *  the sheet asks again until there is nothing left rather than reading four
 *  hundred as finished, which is what it used to do. See the client's `roll`. */
notes.post('/spaces/:spaceId/rollback', atLeast('write', 'spaceId'), async (context) => {
  const space = spaceOf(context)

  const body = await readBody(context)
  const under = body.text('under', PATH_LIMIT) ?? ''
  const at = body.count('at')
  const dry = body.flag('dry') === true
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (at === undefined || at <= 0) return context.json({ error: 'when to go back to' }, 400)

  const folder = under.replace(/^\/+/, '')
  const found = await versionsAt(context.env, space.id, folder, at)
  const changed = found.filter((one) => one.hash !== one.live)

  // The listing above stops at its ceiling, so a full page of rows may be a
  // whole answer or the first of several. Counted only then, and the count is
  // what lets the sheet say "four hundred of twelve hundred".
  const cut = found.length >= ROLLBACK_AT_ONCE
  const held = cut ? await countVersionsAt(context.env, space.id, folder, at) : changed.length

  if (dry) {
    return context.json({
      notes: changed.length,
      paths: changed.slice(0, SHOWN_PATHS).map((one) => one.path),
      more: changed.length > SHOWN_PATHS,
      partial: cut && held > changed.length,
      left: Math.max(held - changed.length, 0),
    })
  }

  const asking = deviceIn(context.req.header('x-nib-device'))
  const device = await deviceOf(context)

  let written = 0
  for (const one of changed) {
    const note = await noteById(context.env, one.note_id)
    if (!note) continue

    const object = await context.env.NOTES.get(versionKey(one.hash))
    if (!object) continue

    // The device that asked, like any other write: a rollback is an edit, and the
    // history saying which machine made it is the same answer to the same
    // question. A word of our own here ("rolled back") would be one English
    // phrase in a column of device names, shown untranslated to everybody.
    const saved = await writeWords(context.env, note, await object.text(), note.path, {
      name: asking,
      device,
    })
    if (saved !== null && saved !== MOVED) written += 1
  }

  // What is left is what was not reached this time: the rows beyond the ceiling,
  // plus anything this pass could not write (a note somebody took away while it
  // ran). A client that asks again gets the next four hundred.
  const left = Math.max(held - written, 0)

  return context.json({ notes: written, partial: left > 0, left })
})

/** How many of the paths a rollback would touch it names. Enough to recognise
 *  the space, few enough to read. */
const SHOWN_PATHS = 40

/** Optimistic concurrency: send the version you edited.
 *
 *  A mismatch on a note comes back as 409 with the server's copy, so the client
 *  can keep both: two people typing in one paragraph is not something a machine
 *  can settle.
 *
 *  A mismatch on a canvas is settled here instead. Everything on a canvas has an
 *  id and a time of its own, so the union of the two copies keeps every card and
 *  every stroke either device drew, and the same merge runs on the client; see
 *  packages/markdown/src/canvas-merge.ts. Two tablets drawing on one plane at the
 *  same time therefore both keep what they drew, and neither ends up with a
 *  second file to go and find. */
notes.put('/notes/:id', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)
  if (!allows(found.space.role, 'write')) return context.json({ error: refusal('write') }, 403)
  const { note, space } = found

  const body = await readBody(context)
  const given = body.text('path', PATH_LIMIT)
  const sent = body.text('content', MAX_NOTE_BYTES)
  const baseVersion = body.count('baseVersion')
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (byteLength(sent ?? '') > MAX_NOTE_BYTES) {
    return context.json({ error: TOO_LARGE }, 413)
  }

  const path = given === undefined ? note.path : cleanPath(given)
  if (!path) return context.json({ error: NOT_A_PATH }, 400)

  // Somebody who was handed this one file may write in it and may not move it.
  // Where a note sits belongs to the space, and the space is not what they were
  // given: a rename here would reorganise somebody else's tree from inside a tab
  // that cannot see it.
  if (found.only && path !== note.path) {
    return context.json({ error: 'this note was shared with you, not its folder' }, 403)
  }

  // Reassigned when a canvas has to be put back together with the copy the
  // server already holds; see the note above.
  let content = sent ?? ''
  // The version the words were written on, for a note whose room judges it. A canvas
  // put back together here is written on the version it was put together with.
  let base = baseVersion

  if (baseVersion !== undefined && baseVersion !== note.version) {
    if (!isCanvasTarget(path)) return await conflict(context, note.id)

    const object = await context.env.NOTES.get(noteKey(note.space_id, note.id))
    content = mergeCanvasFiles(content, object ? await object.text() : '')
    if (byteLength(content) > MAX_NOTE_BYTES) {
      return context.json({ error: TOO_LARGE }, 413)
    }
    base = note.version
  }

  // The note's current bytes come back as it is replaced, so editing a large
  // note that stays the same size is never refused. Against the space's owner,
  // for the same reason as above.
  if (!(await fits(context.env, space.user_id, byteLength(content), note.size))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  // In a space whose tree is rows, the words are one write and the place another: the
  // words go to whoever writes the note, and a new path is a rename or a move the
  // tree makes; see sync2/ops.ts.
  const placed = !!note.name_key
  const device = await deviceOf(context)
  const written = await writeWords(context.env, note, content, placed ? note.path : path, {
    name: deviceIn(context.req.header('x-nib-device')),
    device,
    ...(base === undefined ? {} : { base }),
  })

  // The room the note is in could not be reached; the client asks again.
  if (written === null) return context.json({ error: ROOM_AWAY }, 503, { 'retry-after': '1' })

  // Somebody else - another device, or the room this note is open in - saved
  // between the row being read above and the write. The same answer a version
  // that did not match gets, because it is the same thing to the client: what
  // it edited is not what is held, and here is what is.
  if (written === MOVED) return await conflict(context, note.id)

  let saved = written
  if (placed && path !== note.path) {
    await moveByPath(context.env, note.space_id, device, note.id, path)
    saved = (await noteById(context.env, note.id)) ?? saved
  }

  await pokeSpace(context.env, laterOf(context), note.space_id, saved.seq, device)
  return context.json({ note: presentNote(saved) })
})

/** The 409 a save that lost gets: the note as it now stands, with its bytes, so
 *  the client can keep both copies without a second round trip. */
async function conflict(
  context: Context<{ Bindings: Env; Variables: Variables }>,
  noteId: string,
): Promise<Response> {
  const held = await context.env.DB.prepare('select * from notes where id = ?')
    .bind(noteId)
    .first<Note>()

  const object = held ? await context.env.NOTES.get(noteKey(held.space_id, held.id)) : null

  return context.json(
    {
      error: 'this note changed elsewhere',
      ...(held ? { note: presentNote(held) } : {}),
      content: object ? await object.text() : '',
    },
    409,
  )
}

/** Soft delete: the tombstone is what tells other devices to remove it. The
 *  content stays, with its size and hash, so the note can be put back from
 *  Recently deleted; the purge in trash.ts takes it away after 14 days. */
notes.delete('/notes/:id', async (context) => {
  const found = await reachedNote(context.env, context.get('who'), context.req.param('id'))
  if (!found) return context.json({ error: NO_SUCH_NOTE }, 404)
  if (!allows(found.space.role, 'write')) return context.json({ error: refusal('write') }, 403)
  // A file shared on its own is not the reader's to take away. Deleting it takes
  // something out of somebody else's space, which is what being given the space
  // is for; what they can do instead is hand it back - see DELETE /v1/shared/:id.
  if (found.only) {
    return context.json({ error: 'this note was shared with you, not its folder' }, 403)
  }
  const { note } = found
  const device = await deviceOf(context)

  // In a space whose tree is rows, a delete the tree says: a v1 delete names no version
  // to judge an edit against, so it asks nothing and goes to Recently deleted exactly
  // as it always has, and the tree keeps what it took with it. See sync2/ops.ts.
  if (note.name_key) {
    await deleteById(context.env, note.space_id, device, note.id)
    await pokeSpace(context.env, laterOf(context), note.space_id, note.seq, device)
    return context.json({ ok: true })
  }

  const at = now()
  const seq = await nextSeq(context.env, note.space_id)
  await context.env.DB.prepare(
    'update notes set deleted = 1, deleted_at = ?, seq = ?, version = version + 1, updated_at = ? where id = ?',
  )
    .bind(at, seq, at, note.id)
    .run()

  return context.json({ ok: true })
})

/** The note by id, whatever it is and wherever. */
function noteById(env: Env, id: string): Promise<Note | null> {
  return env.DB.prepare('select * from notes where id = ?').bind(id).first<Note>()
}

/** What `writeWords` answers for a note that moved past the version the writer named. */
export const MOVED = 'moved'

/** Who is writing a whole text, and the version they read, where they read one. */
export interface Writer {
  name: string
  device?: string
  base?: number
}

/** A whole text written into a note by whichever writer the note has.
 *
 *  Once a note has an epoch its room is the only thing that writes it (docs/sync-v2.md
 *  section 5.3), so the text goes to the room, which takes it in as the operations it
 *  differs by and settles at once; see `ingest` in rooms/room.ts. Before, it is a save
 *  like it always was. Answers the note as it now stands, `MOVED` where the note moved
 *  past the version the writer read, and null where its room could not be reached.
 *
 *  `path` is where a note without a tree goes; a note with one is moved by the tree,
 *  and its words never move it. */
export async function writeWords(
  env: Env,
  note: Note,
  text: string,
  path: string,
  writer: Writer,
): Promise<Note | typeof MOVED | null> {
  if ((note.epoch ?? 0) >= 1) {
    const answer = await ingestInto(env, note, text, writer)
    if (!answer || 'refused' in answer) return null
    return 'conflict' in answer ? MOVED : answer.note
  }

  const saved = await saveNote(env, note, text, path, writer.name, {
    ...(writer.device === undefined ? {} : { docBy: writer.device }),
  })
  if (saved) return saved

  // Lost the claim. Somebody saved in between, or the note was given a document since
  // it was read - and then its room is the writer, and nothing else has moved.
  const now = await noteById(env, note.id)
  if (now && (now.epoch ?? 0) >= 1 && now.version === note.version) {
    return await writeWords(env, now, text, path, writer)
  }
  return MOVED
}
