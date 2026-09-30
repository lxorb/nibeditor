/** What the bucket and the rooms still hold for rows that have gone.
 *
 *  An account's rows go in one transaction and its bytes cannot go in the same
 *  one: they are in R2 and in the rooms' own storage, which no transaction of the
 *  database's reaches. So the transaction writes down what it is leaving behind -
 *  see 0038 and erase.ts - and this empties it, a batch at a time, from the route
 *  that deleted the account and again every night until the list is empty.
 *
 *  Every step is safe to repeat. Deleting an object that is not there is nothing,
 *  and so is emptying a room nobody kept anything in; a row goes from the list only
 *  once what it names has gone, so a sweep that stops half way leaves the rest for
 *  the next one. */

import { askInChunks, chunks, places } from './bound'
import { eraseHubs } from './hub/reach'
import type { Env } from './types'
import { eraseRooms } from './rooms'

/** How many names one R2 delete takes: the most the bucket accepts in one call. */
const PER_DELETE = 1000

/** How much one sweep takes on. The bucket's names are cheap - two deletes and a
 *  few dozen questions for this many - and they go first, because a picture is
 *  served to anybody holding its address until its bytes are gone. A room is a
 *  request of its own, so far fewer of those. */
const OBJECTS_AT_ONCE = 2 * PER_DELETE
const ROOMS_AT_ONCE = 200

const ROOM = 'rooms/'
/** An account's hub, or a guest's, which keeps leases and requests of its own; see
 *  hub/hub.ts. Emptied the way a room is, and counted with the rooms. */
const HUB = 'hubs/'

/** Whether a name is an object's storage rather than the bucket's. */
const isObject = (name: string) => name.startsWith(ROOM) || name.startsWith(HUB)

/** Empties the oldest of what the list names, as much as one sweep takes on, and
 *  answers how many it crossed off. */
export async function sweepLeftovers(env: Env): Promise<number> {
  const taken = async (sql: string, most: number) =>
    (await env.DB.prepare(sql).bind(`${ROOM}%`, `${HUB}%`, most).all<{ what: string }>()).results

  const results = [
    ...(await taken(
      `select what from leftovers where what not like ?1 and what not like ?2
        order by since, what limit ?3`,
      OBJECTS_AT_ONCE,
    )),
    ...(await taken(
      `select what from leftovers where what like ?1 or what like ?2
        order by since, what limit ?3`,
      ROOMS_AT_ONCE,
    )),
  ]

  const names = results.map((one) => one.what)
  if (!names.length) return 0

  // A version or a picture another note or another account still names is not
  // this account's to take away, and neither is anything a row has come back for.
  // Asked now rather than when the name was written, because now is when it has to
  // be true.
  const named = await stillNamed(env, names)
  const loose = names.filter((one) => !named.has(one))

  const objects = loose.filter((one) => !isObject(one))
  for (const piece of chunks(objects, PER_DELETE)) await env.NOTES.delete(piece)

  const rooms = loose.filter((one) => one.startsWith(ROOM)).map((one) => one.slice(ROOM.length))
  const hubs = loose.filter((one) => one.startsWith(HUB)).map((one) => one.slice(HUB.length))
  const emptied = new Set([
    ...(await eraseRooms(env, rooms)).map((id) => ROOM + id),
    ...(await eraseHubs(env, hubs)).map((id) => HUB + id),
  ])

  // Everything the bucket took, every room and hub that answered, and every name
  // that turned out to be somebody else's. One that did not answer stays for the
  // next sweep.
  const done = names.filter((one) => !isObject(one) || named.has(one) || emptied.has(one))

  for (const chunk of chunks(done)) {
    await env.DB.prepare(`delete from leftovers where what in (${places(chunk.length)})`)
      .bind(...chunk)
      .run()
  }

  return done.length
}

/** Which of these names a row still answers for.
 *
 *  A note's body, its room and its document's snapshot are the note's, so the note's
 *  row is the question. A version's body and a picture are addressed by their contents
 *  and shared by whoever holds the same bytes, so the question there is whether any
 *  row at all still names the hash. A web login's bytes and a hub are named by the account
 *  itself, which never comes back: nothing else can name them. */
async function stillNamed(env: Env, names: readonly string[]): Promise<Set<string>> {
  const byNote = new Map<string, string>()
  const versions = new Map<string, string>()
  const blobs = new Map<string, string>()

  for (const name of names) {
    const [kind, ...rest] = name.split('/')
    const last = rest[rest.length - 1] ?? ''

    if (kind === 'spaces' || kind === 'rooms' || kind === 'crdt') byNote.set(name, last)
    else if (kind === 'versions') versions.set(name, last)
    else if (kind === 'blobs') blobs.set(name, last)
  }

  const notes = await askIn(env, 'select id as one from notes where id in', byNote)
  const heldVersions = await askIn(
    env,
    'select distinct hash as one from note_versions where hash in',
    versions,
  )
  const heldBlobs = await askIn(env, 'select distinct hash as one from blobs where hash in', blobs)

  return new Set([...notes, ...heldVersions, ...heldBlobs])
}

/** The names whose key one question still finds a row for. */
async function askIn(
  env: Env,
  question: string,
  keys: ReadonlyMap<string, string>,
): Promise<string[]> {
  const found = await askInChunks([...new Set(keys.values())], async (chunk) => {
    const { results } = await env.DB.prepare(`${question} (${places(chunk.length)})`)
      .bind(...chunk)
      .all<{ one: string }>()

    return results.map((row) => row.one)
  })

  const there = new Set(found)
  return [...keys].filter(([, key]) => there.has(key)).map(([name]) => name)
}
