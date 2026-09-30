import { freePath } from '@nib/markdown/paths'
import { Hono } from 'hono'
import { chunks, places } from './bound'
import { now } from './crypto'
import { nextSeq, noteKey, presentNote } from './notes'
import { snapshotKey } from './rooms/epoch'
import { deviceOf } from './sync2/device'
import { deleteById } from './sync2/ops'
import { presentSpace } from './spaces/space'
import type { Env, Note, Space, Variables } from './types'
import { forgetWords } from './blog/words'
import { forgetVersions } from './versions'

/** How long Recently deleted holds on to something. */
const KEEP_FOR = 14 * 24 * 60 * 60 * 1000

/** How much of it is handled in one go.
 *
 *  Emptying something takes one write to R2 apiece, and a Worker has only so
 *  many of those in a single request; the daily job is under the same ceiling.
 *  So both work through a batch at a time. Purging is idempotent, so what is
 *  left over goes on the next tap of the button or the next night's run - the
 *  listing says `more` when there is any. */
export const AT_ONCE = 500

/** `wanted` if nobody has it, else the first free `wanted 2`, `wanted 3`... -
 *  the numbering the app gives a new space whose name is taken. */
export function freeName(taken: Set<string>, wanted: string): string {
  if (!taken.has(wanted)) return wanted
  for (let counter = 2; ; counter++) {
    const candidate = `${wanted} ${counter}`
    if (!taken.has(candidate)) return candidate
  }
}

type DeletedNote = Note & { space_name: string }

async function deletedSpaces(env: Env, userId: string): Promise<Space[]> {
  const { results } = await env.DB.prepare(
    `select * from spaces
      where user_id = ? and deleted = 1 and deleted_at is not null
      order by deleted_at desc limit ?`,
  )
    .bind(userId, AT_ONCE)
    .all<Space>()
  return results
}

/** Deleted notes of live spaces. A deleted space keeps its notes to itself:
 *  they come back with it, not one by one.
 *
 *  The account's own spaces and no others. Recently deleted gives back storage,
 *  and the storage a shared space uses is its owner's; a writer emptying their
 *  own would otherwise reach into somebody else's account and take away notes
 *  for good. What a writer deleted is still in their own machine's trash, and
 *  the owner still sees it here. */
async function deletedNotes(env: Env, userId: string): Promise<DeletedNote[]> {
  const { results } = await env.DB.prepare(
    `select n.*, s.name as space_name from notes n
       join spaces s on s.id = n.space_id
      where s.user_id = ? and s.deleted = 0 and n.deleted = 1 and n.deleted_at is not null
        and n.kind != 'file'
      order by n.deleted_at desc limit ?`,
  )
    .bind(userId, AT_ONCE)
    .all<DeletedNote>()
  return results
}

async function deletedSpace(env: Env, userId: string, id: string): Promise<Space | null> {
  return (
    (await env.DB.prepare(
      'select * from spaces where id = ? and user_id = ? and deleted = 1 and deleted_at is not null',
    )
      .bind(id, userId)
      .first<Space>()) ?? null
  )
}

async function deletedNote(
  env: Env,
  userId: string,
  id: string,
): Promise<(Note & { space_deleted: number }) | null> {
  return (
    (await env.DB.prepare(
      `select n.*, s.deleted as space_deleted from notes n
         join spaces s on s.id = n.space_id
        where n.id = ? and s.user_id = ? and n.deleted = 1 and n.deleted_at is not null`,
    )
      .bind(id, userId)
      .first<Note & { space_deleted: number }>()) ?? null
  )
}

/** Takes a note's content away for good. The row stays as the tombstone the
 *  change feed relies on, and stops being listed. */
async function purgeNote(env: Env, note: Pick<Note, 'id' | 'space_id'>) {
  await env.NOTES.delete([noteKey(note.space_id, note.id), snapshotKey(note.id)])
  // And what the account remembered it saying before. A version of a note whose
  // words have gone for good is a version of nothing; the bodies go with the
  // rows, each only once the last row naming it has gone. See versions.ts.
  await forgetVersions(env, note.id)
  await forgetWords(env, note.id).catch(() => undefined)
  await env.DB.prepare("update notes set size = 0, hash = '', deleted_at = null where id = ?")
    .bind(note.id)
    .run()

  // And whatever was shared about this one file. A share about a note whose
  // words have gone reaches nothing - every read of one joins the live note -
  // but a row nobody can ever use is a row nothing would take away, and it is
  // what a listing and a ceiling still count. See spaces/share.ts.
  await env.DB.batch([
    env.DB.prepare('delete from space_members where space_id = ? and item = ?').bind(
      note.space_id,
      note.id,
    ),
    env.DB.prepare('delete from space_links where space_id = ? and item = ?').bind(
      note.space_id,
      note.id,
    ),
    env.DB.prepare('delete from space_requests where space_id = ? and item = ?').bind(
      note.space_id,
      note.id,
    ),
    env.DB.prepare('delete from guest_members where space_id = ? and item = ?').bind(
      note.space_id,
      note.id,
    ),
  ])
}

/** Empties a space for good, a batch of notes at a time. The row stays as the
 *  marker a machine that was away reads, and stops being listed once the last
 *  note has gone.
 *
 *  Only the rows whose bytes went are taken away. Deleting every row after one
 *  batch of R2 deletes left the notes past the batch with nothing pointing at
 *  them: bytes in the bucket, no row to find them by, and the space no longer
 *  listed as having anything to purge. `deleted_at` stays set while there is more,
 *  which is what brings the next tap of the button, or the next night's run, back
 *  here to finish. */
async function purgeSpace(env: Env, space: Pick<Space, 'id'>, budget = AT_ONCE): Promise<number> {
  const take = Math.max(0, Math.min(budget, AT_ONCE))
  if (!take) return 0

  const { results } = await env.DB.prepare('select id from notes where space_id = ? limit ?')
    .bind(space.id, take)
    .all<{ id: string }>()

  // The note's words and the snapshot of its document, in one delete apiece.
  await Promise.all(
    results.map((note) => env.NOTES.delete([noteKey(space.id, note.id), snapshotKey(note.id)])),
  )

  // Exactly the rows whose bytes have gone, so nothing rejected above is left
  // recorded as purged. A chunk at a time, because a batch is five hundred notes
  // and D1 binds a hundred parameters; see src/bound.ts.
  for (const chunk of chunks(results.map((note) => note.id))) {
    await env.DB.prepare(`delete from notes where id in (${places(chunk.length)})`)
      .bind(...chunk)
      .run()
  }

  if (results.length < take) {
    // And sync v2's tree of it, which is nothing once the notes have gone.
    await env.DB.batch([
      env.DB.prepare('delete from folders where space_id = ?').bind(space.id),
      env.DB.prepare('delete from tree_ops where space_id = ?').bind(space.id),
      env.DB.prepare('delete from space_entries where space_id = ?').bind(space.id),
      env.DB.prepare('update spaces set deleted_at = null where id = ?').bind(space.id),
    ])
  }

  return results.length
}

/** What the daily job does: everything that has waited its 14 days goes, up to
 *  the batch. Spaces are worked through what is left of the batch after the notes,
 *  because a space holds notes of its own and the ceiling is on the writes rather
 *  than on the rows: five hundred deleted spaces of five hundred notes each is a
 *  quarter of a million writes, which is not something one invocation may do. What
 *  does not fit goes on the next run. */
export async function purgeExpired(
  env: Env,
  at: number,
): Promise<{ notes: number; spaces: number }> {
  const cutoff = at - KEEP_FOR

  const notes = await env.DB.prepare(
    `select id, space_id from notes
      where deleted = 1 and deleted_at is not null and deleted_at < ? limit ?`,
  )
    .bind(cutoff, AT_ONCE)
    .all<Pick<Note, 'id' | 'space_id'>>()
  for (const note of notes.results) await purgeNote(env, note)

  const spaces = await env.DB.prepare(
    `select id from spaces
      where deleted = 1 and deleted_at is not null and deleted_at < ? limit ?`,
  )
    .bind(cutoff, AT_ONCE)
    .all<Pick<Space, 'id'>>()

  let budget = AT_ONCE - notes.results.length
  let emptied = 0
  for (const space of spaces.results) {
    if (budget <= 0) break
    budget -= await purgeSpace(env, space, budget)
    emptied++
  }

  return { notes: notes.results.length, spaces: emptied }
}

export const trash = new Hono<{ Bindings: Env; Variables: Variables }>()

trash.get('/', async (context) => {
  const user = context.get('user')
  const env = context.env

  const spaces = await deletedSpaces(env, user.id)
  const counted = await Promise.all(
    spaces.map(async (space) => {
      const count = await env.DB.prepare(
        'select count(*) as notes from notes where space_id = ? and deleted = 0',
      )
        .bind(space.id)
        .first<{ notes: number }>()
      return {
        id: space.id,
        name: space.name,
        deletedAt: space.deleted_at,
        purgeAt: (space.deleted_at ?? 0) + KEEP_FOR,
        notes: count?.notes ?? 0,
      }
    }),
  )

  const notes = (await deletedNotes(env, user.id)).map((note) => ({
    id: note.id,
    spaceId: note.space_id,
    spaceName: note.space_name,
    path: note.path,
    deletedAt: note.deleted_at,
    purgeAt: (note.deleted_at ?? 0) + KEEP_FOR,
  }))

  // A listing this long is the batch, not the whole of it. Nobody has held so
  // much in Recently deleted, and saying so is better than pretending.
  const more = counted.length === AT_ONCE || notes.length === AT_ONCE
  if (more) return context.json({ spaces: counted, notes, more })

  return context.json({ spaces: counted, notes })
})

trash.post('/spaces/:id/restore', async (context) => {
  const user = context.get('user')
  const env = context.env
  const space = await deletedSpace(env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'nothing to restore' }, 404)

  const live = await env.DB.prepare(
    'select name, position from spaces where user_id = ? and deleted = 0',
  )
    .bind(user.id)
    .all<{ name: string; position: number }>()
  const name = freeName(new Set(live.results.map((one) => one.name)), space.name)
  const position = live.results.reduce((last, one) => Math.max(last, one.position), -1) + 1

  const at = now()
  await env.DB.prepare(
    'update spaces set deleted = 0, deleted_at = null, name = ?, position = ?, updated_at = ? where id = ?',
  )
    .bind(name, position, at, space.id)
    .run()

  return context.json({
    space: presentSpace(
      { ...space, deleted: 0, deleted_at: null, name, position, updated_at: at },
      env,
    ),
  })
})

trash.post('/notes/:id/restore', async (context) => {
  const user = context.get('user')
  const env = context.env
  const note = await deletedNote(env, user.id, context.req.param('id'))
  if (!note) return context.json({ error: 'nothing to restore' }, 404)
  if (note.space_deleted) return context.json({ error: 'restore its space first' }, 409)

  // In a space whose tree is rows, a restore the tree says: the note back where it
  // was, with the folders it was in, numbered if its name was taken meanwhile.
  if (note.name_key) {
    await deleteById(env, note.space_id, await deviceOf(context), note.id, true)
    const back = await env.DB.prepare('select * from notes where id = ?')
      .bind(note.id)
      .first<Note>()
    if (back) return context.json({ note: presentNote(back) })
  }

  const live = await env.DB.prepare('select path from notes where space_id = ? and deleted = 0')
    .bind(note.space_id)
    .all<{ path: string }>()
  const taken = new Set(live.results.map((one) => one.path))
  const path = freePath(note.path, (candidate) => taken.has(candidate))

  const at = now()
  const seq = await nextSeq(env, note.space_id)
  await env.DB.prepare(
    'update notes set deleted = 0, deleted_at = null, path = ?, seq = ?, version = version + 1, updated_at = ? where id = ?',
  )
    .bind(path, seq, at, note.id)
    .run()

  return context.json({
    note: presentNote({
      ...note,
      deleted: 0,
      deleted_at: null,
      path,
      seq,
      version: note.version + 1,
      updated_at: at,
    }),
  })
})

trash.delete('/notes/:id', async (context) => {
  const user = context.get('user')
  const note = await deletedNote(context.env, user.id, context.req.param('id'))
  if (!note) return context.json({ error: 'nothing to delete' }, 404)

  await purgeNote(context.env, note)
  return context.json({ ok: true })
})

trash.delete('/spaces/:id', async (context) => {
  const user = context.get('user')
  const space = await deletedSpace(context.env, user.id, context.req.param('id'))
  if (!space) return context.json({ error: 'nothing to delete' }, 404)

  await purgeSpace(context.env, space)
  return context.json({ ok: true })
})

/** Empties the account's Recently deleted now, a batch at a time. Purging is
 *  idempotent, so a second tap finishes what a first left - and the batch is
 *  counted in writes rather than in rows, for the reason `purgeExpired` gives. */
trash.delete('/', async (context) => {
  const user = context.get('user')
  const env = context.env

  const notes = await deletedNotes(env, user.id)
  for (const note of notes) await purgeNote(env, note)

  let budget = AT_ONCE - notes.length
  for (const space of await deletedSpaces(env, user.id)) {
    if (budget <= 0) break
    budget -= await purgeSpace(env, space, budget)
  }

  return context.json({ ok: true })
})
