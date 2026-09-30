/** The door to a room: who may open a file's socket, what they may do once they
 *  are in, which object it leads to, and what shape the document in it has.
 *
 *  Everything about who is allowed in is decided here rather than in the room,
 *  because this is where the database is. That is the file's space being one the
 *  person whose session the socket carries can reach: their own space, one
 *  somebody shared with them, or one a link let them into as a guest. The room
 *  learns one thing from the answer, which is whether this socket may write; it
 *  never learns who anybody is.
 *
 *  The token rides in the socket's subprotocol rather than in a header or the
 *  address. A browser cannot put a header on a WebSocket, and a token in the
 *  address ends up in logs and referrers; a subprotocol is a header the browser
 *  will set, and the server names it back so the handshake completes. Which is
 *  also why this route sits outside the session guard - the guard reads
 *  `Authorization`, and a socket has none. */

import { Hono } from 'hono'
import { NO_SUCH_NOTE, ROOM_AWAY, SIGN_IN } from '../refused'
import { subprotocol, tokenOf } from '@nib/rooms'
import { DEVICE_PROTOCOL, ROOM_V2 } from '@nib/sync-core'
import { chunks } from '../bound'
import { now, sha256 } from '../crypto'
import { note } from '../failed'
import type { Env, Note } from '../types'
import { roomKind } from './kind'
import type { Ingested } from './room'

/** All three halves of the question in one round trip: whether the session is
 *  live, whether the note belongs to a space the person behind it can reach, and
 *  what they may do there.
 *
 *  One query rather than four, because this runs in front of every socket a note
 *  opens and a reader is waiting on it. Each answer comes back on its own so the
 *  cases can still be told apart: without a live session a client has to sign in
 *  again, while a note nobody shared is a note that does not exist.
 *
 *  There are two kinds of session and `me` is either of them. An account's
 *  membership is joined on the address rather than on the account id, which is
 *  what lets somebody invited before they had an account walk straight in on the
 *  day they prove it; a guest's is joined on the guest, which is what a link
 *  handed out. Neither kind can be both, so the union is at most one row.
 *
 *  And there are two sizes of membership, which is why there are four joins
 *  rather than two: one for the whole space, one for this file alone. The door
 *  is the one place where a share about one note means anything - a person given
 *  one file gets its room and no other, and asks the rest of the service about
 *  the space to be told there is no such space. Each join matches at most one
 *  row, because the item is part of the key, so the whole of this is still one
 *  row and one round trip. Where somebody holds both - a reader of the space who
 *  was given this note to write in - the stronger of the two is what the room is
 *  told: what they may do to this file is the most any of it allows. */
const ALLOWED = `with me as (
  select u.id as user_id, u.email as email, null as guest_id
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = ?1 and s.expires_at > ?2
  union all
  select null as user_id, null as email, s.guest_id as guest_id
    from guest_sessions s
   where s.token_hash = ?1 and s.expires_at > ?2
),
reached as (
  select n.space_id as space_id,
         n.path as path,
         n.epoch as epoch,
         case when sp.user_id = me.user_id then 'owner'
              when 'write' in (coalesce(ms.role, ''), coalesce(mi.role, ''),
                               coalesce(gs.role, ''), coalesce(gi.role, '')) then 'write'
              else 'read' end as role
    from me
    join notes n on n.id = ?3 and n.deleted = 0
    join spaces sp on sp.id = n.space_id and sp.deleted = 0
    left join space_members ms on ms.space_id = sp.id and ms.email = me.email and ms.item = ''
    left join space_members mi on mi.space_id = sp.id and mi.email = me.email and mi.item = n.id
    left join guest_members gs on gs.space_id = sp.id and gs.guest_id = me.guest_id
                              and gs.item = '' and gs.joined_at is not null
    left join guest_members gi on gi.space_id = sp.id and gi.guest_id = me.guest_id
                              and gi.item = n.id and gi.joined_at is not null
   where sp.user_id = me.user_id or ms.role is not null or mi.role is not null
      or gs.role is not null or gi.role is not null
)
select (select coalesce(user_id, guest_id) from me) as who,
       (select space_id from reached) as space_id,
       (select path from reached) as path,
       (select epoch from reached) as epoch,
       (select role from reached) as role`

/** How long a client is told to wait before asking for the room again. A second:
 *  about what replacing an object takes, and less than the app's own backoff waits
 *  on its first try anyway. A browser cannot read this off a handshake that did
 *  not become a socket - `new WebSocket` gives a page no headers - so what it is
 *  for is every other client, and being the right answer. */
const TRY_AGAIN_IN = '1'

/** The room's half of the socket, asked of the object.
 *
 *  An object can be unavailable for a moment without anything being wrong, and
 *  the commonest reason by far is a deploy: every object whose code changed is
 *  reset, and a `fetch` in flight throws `Durable Object reset because its code
 *  was updated`. This service deploys on every push, so that is every note anybody
 *  had open at the time. It used to leave the route as a bare throw, which came
 *  back as a 500 - the wrong thing to say twice over. A 500 reads as a bug in what
 *  was asked rather than a moment to wait through, and there is nothing in it that
 *  tells a client trying again is the whole of the fix.
 *
 *  So it is asked for twice, and the second ask lands on the object that replaced
 *  the one that went - which is why one more is enough and a third would only be
 *  slower to give up. Nothing was said to the client in between, so there is
 *  nothing to take back.
 *
 *  Answered with nothing when both asks fail, and the failure is written down
 *  first: a room that fails every time is a bug in the room rather than a deploy,
 *  and the log line is where the two can be told apart. Nothing is written down
 *  for an ask that worked the second time, which is what a deploy looks like and
 *  is not a failure anybody saw. */
async function reach(
  namespace: DurableObjectNamespace,
  noteId: string,
  address: string,
  headers: Record<string, string>,
  ray: string | null,
): Promise<Response | null> {
  let last: unknown = null

  for (let asked = 0; asked < 2; asked++) {
    // A fresh stub each time: the point of asking again is not to ask the object
    // that has already gone.
    const room = namespace.get(namespace.idFromName(noteId))

    try {
      const answer = await room.fetch(new Request(address, { headers }))
      // A handshake with nothing on it is the one answer that cannot be passed
      // on: a Response may not be built with that status unless a socket comes
      // with it, so handing it to the route below would be the throw again in a
      // different place.
      if (answer.status !== 101 || answer.webSocket) return answer

      last = new Error('the room answered a handshake with no socket on it')
    } catch (error) {
      last = error
    }
  }

  // Named by the room rather than by the route, so that one query finds every
  // room that failed and the id says which file it was about.
  note(`room ${noteId}`, last, ray)
  return null
}

export const rooms = new Hono<{ Bindings: Env }>()

rooms.get('/:noteId', async (context) => {
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'a room is a websocket' }, 426)
  }

  const offered = context.req.header('sec-websocket-protocol')
  const token = tokenOf(offered)
  const noteId = context.req.param('noteId')

  const allowed = await context.env.DB.prepare(ALLOWED)
    .bind(await sha256(token ?? ''), now(), noteId)
    .first<{
      who: string | null
      space_id: string | null
      path: string | null
      epoch: number | null
      role: string | null
    }>()

  if (!allowed?.who) return context.json({ error: SIGN_IN }, 401)
  // A note in a space nobody shared is indistinguishable from one that is not
  // there, exactly as it is over the rest of the API.
  if (!allowed.space_id) return context.json({ error: NO_SUCH_NOTE }, 404)

  const namespace = context.env.ROOMS
  if (!namespace) return context.json({ error: 'rooms are not running here' }, 503)

  const answer = await reach(
    namespace,
    noteId,
    context.req.url,
    {
      upgrade: 'websocket',
      'x-nib-note': noteId,
      'x-nib-space': allowed.space_id,
      // Which shape the room's document is in, which is the file's name and
      // nothing else. Said here because this is where the row was read.
      'x-nib-kind': roomKind(allowed.path ?? ''),
      // The one thing the room is told about the person on the other end.
      // A reader is in the room and sees every keystroke; what the room does
      // with this is refuse the messages that would change the text.
      //
      // Said the other way round until now - anything but `read` meant yes - so
      // a role the query could not name was a socket that writes. It is the one
      // flag between a reader and the words, so the two roles that may write are
      // named and everything else reads, the way the room reads the header it
      // arrives on; see `writesOf`.
      'x-nib-write': allowed.role === 'write' || allowed.role === 'owner' ? 'yes' : 'no',
      // And who they are, as an id and nothing else. The room cannot look it
      // up and never learns what it names; what it is for is being told that
      // this one is not in the space any more. See `roomsRevoked`.
      'x-nib-who': allowed.who,
      // Sync v2: which epoch the note's document is on, whether the socket speaks
      // `nib.v2` (and so hears acknowledgements and new epochs), and which device it
      // said it is. See `NoteRoom` and docs/sync-v2.md section 7.
      'x-nib-epoch': String(allowed.epoch ?? 0),
      'x-nib-v2': offers(offered, ROOM_V2) ? 'yes' : 'no',
      ...deviceIn(offered),
    },
    context.req.header('cf-ray') ?? null,
  )

  // Not a refusal and not a bug: the room is a place that can be a moment away
  // from answering, and this is the shape of saying so. The app's socket treats
  // a handshake that did not open like any other close and comes back on its own
  // backoff; see rooms/socket.ts.
  if (!answer) {
    return context.json({ error: ROOM_AWAY }, 503, {
      'retry-after': TRY_AGAIN_IN,
    })
  }

  // The browser refuses the socket unless the server names the subprotocol back.
  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', subprotocol(token ?? ''))

  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
    // What carries the reader's end of the pair the room made.
    webSocket: answer.webSocket,
  })
})

/** What a route asks a note's room over HTTP, for sync v2: a device's pending edits
 *  (`push`), what a device is missing (`pull`), or a whole text from a writer with no
 *  document of its own (`ingest`). See `push`, `pull` and `ingest` in room.ts. */
export type RoomAsk = 'push' | 'pull' | 'ingest'

/** Asks a note's room one thing, answering its response or null when the room could
 *  not be reached. Asked twice, for the reason `reach` gives: the commonest reason for
 *  an object not to answer is a deploy, and the second ask lands on its successor. */
export async function askRoom(
  env: Env,
  target: { id: string; space_id: string; path: string; epoch?: number },
  ask: RoomAsk,
  body: Uint8Array,
): Promise<Response | null> {
  const namespace = env.ROOMS
  if (!namespace) return null

  for (let asked = 0; asked < 2; asked++) {
    try {
      const room = namespace.get(namespace.idFromName(target.id))
      return await room.fetch(
        new Request(`https://rooms.invalid/${target.id}`, {
          method: 'POST',
          headers: {
            'x-nib-doc': ask,
            'x-nib-note': target.id,
            'x-nib-space': target.space_id,
            'x-nib-kind': roomKind(target.path),
            'x-nib-epoch': String(target.epoch ?? 0),
          },
          body,
        }),
      )
    } catch {
      // A reset object: the loop asks the one that replaced it.
    }
  }
  return null
}

/** A whole text handed to a note's room to take in; see `ingest` in room.ts. Null when
 *  the room could not be reached, or answered with something that is not an answer. */
export async function ingestInto(
  env: Env,
  target: Note,
  text: string,
  writer: { name: string; device?: string; base?: number },
): Promise<Ingested | null> {
  const body = new TextEncoder().encode(JSON.stringify({ text, ...writer }))
  const answer = await askRoom(env, target, 'ingest', body)
  if (!answer?.ok) return null

  // The room's own answer, written by `ingest` and nothing else.
  return (await answer.json()) as Ingested
}

/** The subprotocols a socket offered, one by one. */
function protocolsIn(header: string | undefined): string[] {
  return (header ?? '').split(',').map((one) => one.trim())
}

function offers(header: string | undefined, protocol: string): boolean {
  return protocolsIn(header).includes(protocol)
}

/** The device a v2 socket said it is, as the header the room reads; nothing for one that
 *  said nothing, or something that is not a device id. */
function deviceIn(header: string | undefined): Record<string, string> {
  const said = protocolsIn(header).find((one) => one.startsWith(DEVICE_PROTOCOL))
  const device = said?.slice(DEVICE_PROTOCOL.length) ?? ''
  return /^[A-Za-z0-9_-]{1,64}$/.test(device) ? { 'x-nib-device-id': device } : {}
}

/** How many of somebody's open files one revocation wakes at a time. A bound on
 *  the fan-out of a single request rather than on the revocation itself; see
 *  `MOST_ROUNDS`. */
const MOST_OPEN = 50

/** How many of those rounds it will do. Twenty of them is a thousand rooms, which
 *  is far past what anybody has open - and past what somebody could open on purpose
 *  to keep a socket the space has taken back.
 *
 *  The rounds are what this used to be missing. One query of fifty, and a member who
 *  had fifty-one rooms of the space open kept a live socket on the rest: the checks
 *  a socket was let in on are made at the handshake and never again, so those
 *  sockets went on writing into the owner's notes until something else closed them.
 *  A number was the right idea - the runtime cannot be asked which objects are
 *  awake, and a revocation must not wake a whole space - but it belongs on the
 *  request's width rather than on how much of the person's access ends. */
const MOST_ROUNDS = 20

/** Somebody's access to a space has ended, or narrowed to reading, and they may
 *  have its files open right now. The rooms are told inside the same request.
 *
 *  The checks a socket was let in on are made at the handshake and never again,
 *  because a socket is not a request; so this is the other half of them. Which
 *  rooms to tell comes from `room_sockets`, which the rooms themselves keep - the
 *  runtime cannot be asked which objects are awake, and telling every note of the
 *  space would wake thousands for the sake of the two somebody has open.
 *
 *  `role` is what they have left: `read` downgrades the sockets, `none` closes
 *  them. `who` may be null, because a membership can name an address nobody has
 *  proved yet and there is nothing of theirs to close.
 *
 *  `item` narrows it to one file, for a share that was about one file: the rest
 *  of what that person holds has not changed, and closing their other rooms
 *  because one note was taken back would be an app that flickered for reasons
 *  nobody could see. Empty means the space, which is every room of it. */
export async function roomsRevoked(
  env: Env,
  spaceId: string,
  who: string | null,
  role: 'none' | 'read',
  item = '',
): Promise<void> {
  const namespace = env.ROOMS
  if (!namespace || !who) return

  // One round at a time, ordered by the id so the next one starts where this ended:
  // a page of rows rather than a page of a person's access. A round that came back
  // short is the last one.
  let after = ''
  for (let round = 0; round < MOST_ROUNDS; round++) {
    const { results } = item
      ? await env.DB.prepare(
          `select note_id from room_sockets
            where space_id = ? and who = ? and note_id = ? and note_id > ?
            order by note_id limit ?`,
        )
          .bind(spaceId, who, item, after, MOST_OPEN)
          .all<{ note_id: string }>()
      : await env.DB.prepare(
          `select note_id from room_sockets
            where space_id = ? and who = ? and note_id > ?
            order by note_id limit ?`,
        )
          .bind(spaceId, who, after, MOST_OPEN)
          .all<{ note_id: string }>()

    if (!results.length) return

    // A room that cannot be reached right now leaves a socket open on something
    // that is no longer true, which the next handshake corrects. The membership is
    // already gone either way, and an owner taking somebody out must not fail
    // because an object is unwell.
    await Promise.all(
      results.map(({ note_id: noteId }) =>
        tell(namespace, noteId, { 'x-nib-revoked': who, 'x-nib-role': role }),
      ),
    )

    if (results.length < MOST_OPEN) return
    after = results[results.length - 1]?.note_id ?? ''
  }
}

/** One room told one thing, answering whether it heard. Never a throw: every
 *  caller has already changed the rows the message is about, and an object being
 *  unwell for a moment is not a reason for that change to fail. */
async function tell(
  namespace: DurableObjectNamespace,
  noteId: string,
  headers: Record<string, string>,
): Promise<boolean> {
  try {
    const room = namespace.get(namespace.idFromName(noteId))
    const answer = await room.fetch(new Request(`https://rooms.invalid/${noteId}`, { headers }))
    return answer.ok
  } catch {
    return false
  }
}

/** Sockets whose way in went with an account: its own on any file, and everybody's
 *  on its files. Read before the rows went, because afterwards nothing says which
 *  rooms they are in; see erase.ts. The account's own files are emptied as well,
 *  which closes everything in them - this is the half that cannot wait for that. */
export async function closeRooms(
  env: Env,
  open: readonly { note_id: string; who: string }[],
): Promise<void> {
  const namespace = env.ROOMS
  if (!namespace) return

  for (const round of chunks(open, MOST_OPEN)) {
    await Promise.all(
      round.map((one) =>
        tell(namespace, one.note_id, { 'x-nib-revoked': one.who, 'x-nib-role': 'none' }),
      ),
    )
  }
}

/** The rooms of files that have gone for good, emptied: every socket closed and
 *  the document the object kept of its own taken away. A room keeps its document
 *  for as long as the file does, and the file has stopped.
 *
 *  Answers the ids whose rooms are empty now, so the list they came from keeps the
 *  rest for another go. Without the namespace there are no rooms, and every one of
 *  them is as empty as it will ever be. */
export async function eraseRooms(env: Env, noteIds: readonly string[]): Promise<string[]> {
  const namespace = env.ROOMS
  if (!namespace) return [...noteIds]

  const emptied: string[] = []
  for (const round of chunks(noteIds, MOST_OPEN)) {
    const heard = await Promise.all(
      round.map((noteId) => tell(namespace, noteId, { 'x-nib-erase': 'yes' })),
    )
    emptied.push(...round.filter((_, at) => heard[at]))
  }

  return emptied
}

/** How many of somebody's spaces one sign-out reaches. Well past how many spaces
 *  anybody has a file open in at once, and a bound on the queries one request
 *  makes. */
const MOST_SPACES = 100

/** A session has ended, and whatever it had open is still open.
 *
 *  A socket is not a request: the checks it was let in on were made at the
 *  handshake, so a laptop that has gone missing goes on typing into a note through
 *  its room long after the session it opened with was ended from another device.
 *  Ending a session has to reach the sockets the way taking somebody out of a space
 *  does; this is the other doorway to `roomsRevoked`.
 *
 *  Every room of that person rather than of that session, because `room_sockets` is
 *  keyed by who and not by which session: one account's devices are one row per
 *  file. So the account's other devices have their sockets closed as well and rejoin
 *  at once - their sessions are still good and the door lets them back in - which is
 *  a reconnect nobody sees, against a socket that would otherwise stay open for as
 *  long as the note stayed open. */
export async function roomsSignedOut(env: Env, who: string): Promise<void> {
  if (!env.ROOMS || !who) return

  const { results } = await env.DB.prepare(
    'select distinct space_id from room_sockets where who = ? limit ?',
  )
    .bind(who, MOST_SPACES)
    .all<{ space_id: string }>()

  for (const { space_id: spaceId } of results) {
    await roomsRevoked(env, spaceId, who, 'none')
  }
}
