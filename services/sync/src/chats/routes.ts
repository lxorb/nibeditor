/** A chat's routes, behind the session guard under `/v2/chats` (docs/chats.md 4.2, 4.4).
 *
 *  A chat is made in a space by somebody who may write there, and is named by an id the
 *  account makes, `c_` and 32 hex digits: that id is the chat, whichever sync the
 *  devices run. The app writes it into a `.chat` pointer in the space, which gives the
 *  chat a name and a place and nothing else; access is the chat's space (reach.ts).
 *  These routes answer every account alike, on sync v1 or v2, and none asks which.
 *
 *  Everything a chat holds is its `ChatLog`'s; these routes decide who may ask, and ask
 *  it. The listing reads D1 alone, which the object keeps current within a second, so
 *  the Chats panel wakes no object. Every shape here is `@nib/chats/wire`'s. */

import { type Event, type Message, matches, parseSearch, type Who } from '@nib/chats'
import { EVENTS_A_MINUTE } from '@nib/chats/limits'
import { newChatOf, postEventsOf } from '@nib/chats/wire'
import { Hono } from 'hono'
import { newId, now } from '../crypto'
import { within } from '../limits'
import { NO_SUCH_SPACE } from '../refused'
import { roomForAnItem, TOO_MANY_ITEMS } from '../spaces/share'
import { allows, reachedSpace, refusal } from '../spaces/space'
import { blobKey, BYTES, NO_SUCH_FILE } from '../sync2/files'
import { deviceOf } from '../sync2/device'
import type { Env, Variables, Whoever } from '../types'
import { askChat, CHAT_AWAY, chatsMoved } from './ask'
import { INVALID, RATE } from './placing'
import { askingOf, reachChat, type Reached } from './reach'

interface App {
  Bindings: Env
  Variables: Variables
}

/** A chat nobody here can reach, which is the same answer as one that is not there. */
export const NO_SUCH_CHAT = 'no such chat'

/** A body that is not what the route reads. A correct client never sends one, so it
 *  stays English. */
const NOT_THAT = 'that is not what this route reads'

/** How many chats one search across them asks. */
const MOST_SEARCHED = 50

/** The most hits a search answers. */
const MOST_HITS = 100

const HASH = /^[a-f0-9]{64}$/

export const chats = new Hono<App>()

/** What the object is told about whoever a route is asking for. */
export function asking(reached: Reached, device?: string): Record<string, string> {
  return {
    'x-nib-space': reached.space,
    'x-nib-who': reached.id,
    'x-nib-guest': reached.guest ? 'yes' : 'no',
    'x-nib-role': reached.role,
    ...(device ? { 'x-nib-device': device.slice(0, 200) } : {}),
  }
}

/** An object's answer passed on, or the moment to wait through. */
function passed(answer: Response | null): Response {
  return (
    answer ?? Response.json({ error: CHAT_AWAY }, { status: 503, headers: { 'retry-after': '1' } })
  )
}

/* ── Listing ───────────────────────────────────────────────────────────── */

/** Every chat this person reaches, with what the Chats panel draws before any chat is
 *  opened (`ChatRow`): the head, its settings, how many people it has, this person's
 *  read place, mentions and notification setting. `?4` narrows it to one space. */
const LISTED = `with me as (select ?1 as user_id, ?2 as email, ?3 as guest_id),
held as (
  select sp.id as space_id, '' as item, 'owner' as role
    from me join spaces sp on sp.user_id = me.user_id and sp.deleted = 0
  union all
  select m.space_id, m.item, m.role
    from me join space_members m on m.email = me.email
    join spaces sp on sp.id = m.space_id and sp.deleted = 0
  union all
  select g.space_id, g.item, g.role
    from me join guest_members g on g.guest_id = me.guest_id and g.joined_at is not null
    join spaces sp on sp.id = g.space_id and sp.deleted = 0
),
found as (
  select ch.id as id, h.role as role from held h join chats ch on ch.space_id = h.space_id
   where h.item = ''
  union all
  select ch.id, h.role from held h
    join chats ch on ch.file_id = h.item and ch.space_id = h.space_id
    join notes f on f.id = ch.file_id and f.deleted = 0
   where h.item <> ''
)
select ch.id as id, ch.space_id as space,
       max(case f.role when 'owner' then 3 when 'write' then 2 else 1 end) as rank,
       (select count(*) from (
          select sp.user_id from spaces sp where sp.id = ch.space_id
          union select u.id from space_members m join users u on u.email = m.email
           where m.space_id = ch.space_id and (m.item = '' or m.item = ch.file_id)
          union select g.guest_id from guest_members g
           where g.space_id = ch.space_id and (g.item = '' or g.item = ch.file_id)
             and g.joined_at is not null)) as members,
       ch.last_seq as last_seq, ch.last_at as last_at, ch.last_by as last_by,
       ch.topic as topic, ch.posting as posting, ch.slowmode as slowmode,
       coalesce(r.read_seq, 0) as read_seq, coalesce(r.mentions, 0) as mentions,
       r.notify as notify, r.muted_until as muted_until
  from found f join chats ch on ch.id = f.id
  left join chat_reads r on r.chat_id = ch.id
                        and r.who = (select coalesce(user_id, guest_id) from me)
 where ch.ended_at is null and (?4 is null or ch.space_id = ?4)
 group by ch.id
 order by coalesce(ch.last_at, ch.created_at) desc
 limit 2000`

interface ListedRow {
  id: string
  space: string
  rank: number
  members: number
  last_seq: number
  last_at: number | null
  last_by: string | null
  topic: string
  posting: string
  slowmode: number
  read_seq: number
  mentions: number
  notify: string | null
  muted_until: number | null
}

const ROLES = ['read', 'read', 'write', 'owner'] as const

/** A row as `ChatRow` says it, with the asker's role beside it. */
function rowOf(row: ListedRow) {
  return {
    id: row.id,
    space: row.space,
    role: ROLES[row.rank] ?? 'read',
    members: row.members,
    lastSeq: row.last_seq,
    lastAt: row.last_at,
    lastBy: row.last_by,
    readSeq: row.read_seq,
    mentions: row.mentions,
    notify: row.notify,
    mutedUntil: row.muted_until,
    meta: {
      topic: row.topic,
      posting: row.posting === 'owner' ? 'owner' : 'writers',
      slowmode: row.slowmode,
    },
  }
}

export async function listed(env: Env, who: Whoever, space: string | null) {
  const { results } = await env.DB.prepare(LISTED)
    .bind(...askingOf(who), space)
    .all<ListedRow>()
  return results.map(rowOf)
}

chats.get('/', async (context) => {
  const space = context.req.query('space') ?? null
  return context.json({ chats: await listed(context.env, context.get('who'), space) })
})

/* ── Making and moving ─────────────────────────────────────────────────── */

/** A new chat in a space, by somebody who may write there, answered with the pointer
 *  its `.chat` file holds (4.2). */
chats.post('/', async (context) => {
  const env = context.env
  const asked = newChatOf(await context.req.json().catch(() => null))
  if (!asked) return context.json({ error: NOT_THAT }, 400)

  const space = await reachedSpace(env, context.get('who'), asked.space)
  if (!space) return context.json({ error: NO_SUCH_SPACE }, 404)
  if (!allows(space.role, 'write')) return context.json({ error: refusal('write') }, 403)

  const chat = `c_${newId().replaceAll('-', '')}`
  await env.DB.prepare('insert into chats (id, space_id, created_at) values (?, ?, ?)')
    .bind(chat, space.id, now())
    .run()
  return context.json({ v: 1, chat }, 201)
})

/** A chat's settings, or its space (Move to space): `{space}` by a writer of both
 *  spaces, which takes its history along and changes its audience; `{topic}`,
 *  `{posting}` and `{slowmode}` as a `meta` event the object places for the asker, by
 *  the same table every event is held to. */
chats.patch('/:chat', async (context) => {
  const env = context.env
  const reached = await reachChat(env, context.get('who'), context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const sent = (await context.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!sent) return context.json({ error: NOT_THAT }, 400)

  if (typeof sent.space === 'string') {
    if (reached.role === 'read') return context.json({ error: refusal('write') }, 403)
    const target = await reachedSpace(env, context.get('who'), sent.space)
    if (!target) return context.json({ error: NO_SUCH_SPACE }, 404)
    if (!allows(target.role, 'write')) return context.json({ error: refusal('write') }, 403)
    await chatsMoved(env, reached.chat, target.id)
    return context.json({ space: target.id })
  }

  const meta: Event = { kind: 'meta', id: `m_${newId().replaceAll('-', '')}` }
  for (const key of ['topic', 'posting', 'slowmode'] as const) {
    if (sent[key] !== undefined) Object.assign(meta, { [key]: sent[key] })
  }
  const checked = postEventsOf({ events: [meta] })
  if (!checked) return context.json({ error: NOT_THAT }, 400)
  const answer = await askChat(
    env,
    reached.chat,
    'send',
    asking(reached, await deviceOf(context)),
    {
      body: JSON.stringify(checked),
    },
  )
  if (!answer) return passed(null)
  const { results } = await answer.json<{ results: { refused?: string }[] }>()
  const refused = results[0]?.refused
  return refused ? context.json({ error: refused }, 403) : context.json({ ok: true })
})

/* ── The log ───────────────────────────────────────────────────────────── */

/** The chat a route names, as the person asking reaches it. */
function reachedOf(context: { env: Env; get: (key: 'who') => Variables['who'] }, chat: string) {
  return reachChat(context.env, context.get('who'), chat)
}

/** Events by seq: `after`, `before` or `around` one, at most 500 (4.4). */
chats.get('/:chat/events', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  return passed(
    await askChat(context.env, reached.chat, 'events', asking(reached), { url: context.req.url }),
  )
})

/** Messages as they stand, newest first, for a first copy (4.5). */
chats.get('/:chat/state', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  return passed(
    await askChat(context.env, reached.chat, 'state', asking(reached), { url: context.req.url }),
  )
})

/** Up to fifty events from a device's outbox, each answered with its place or why not;
 *  idempotent by each event's id, so a resend is answered as before. A body with any
 *  event that does not check is refused whole. */
chats.post('/:chat/events', async (context) => {
  const env = context.env
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)

  const sent = postEventsOf(await context.req.json().catch(() => null))
  if (!sent) return context.json({ error: INVALID }, 400)
  // The account's ceiling, a request at a time; the object counts each event per person.
  if (!(await within(env, 'chat-events', reached.id, EVENTS_A_MINUTE, 60_000))) {
    return context.json({ error: RATE }, 429)
  }
  return passed(
    await askChat(env, reached.chat, 'send', asking(reached, await deviceOf(context)), {
      body: JSON.stringify(sent),
    }),
  )
})

/** This person's read place, from a device with no socket open: forward, or back with
 *  `back` (Mark unread). */
chats.post('/:chat/read', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const sent = (await context.req.json().catch(() => null)) as {
    seq?: unknown
    back?: unknown
  } | null
  const seq = sent?.seq
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    return context.json({ error: NOT_THAT }, 400)
  }
  return passed(
    await askChat(context.env, reached.chat, 'read', asking(reached), {
      body: JSON.stringify({ seq, back: sent?.back === true }),
    }),
  )
})

/** This person's own posts waiting for their time. */
chats.get('/:chat/scheduled', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  return passed(await askChat(context.env, reached.chat, 'scheduled', asking(reached)))
})

const NOTIFY = new Set(['all', 'mentions', 'nothing'])

/** What pings this person about this chat, kept by the account so every device agrees
 *  (4.11): `notify` all, mentions or nothing (null for the chat's default), and
 *  `mutedUntil` a moment or null. */
chats.put('/:chat/me', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const sent = (await context.req.json().catch(() => null)) as Record<string, unknown> | null
  const notify = sent?.notify
  const until = sent?.mutedUntil
  const notifyOk =
    notify === undefined || notify === null || (typeof notify === 'string' && NOTIFY.has(notify))
  const untilOk =
    until === undefined ||
    until === null ||
    (typeof until === 'number' && Number.isSafeInteger(until))
  if (!sent || !notifyOk || !untilOk) return context.json({ error: NOT_THAT }, 400)

  const row = await context.env.DB.prepare(
    `insert into chat_reads (chat_id, who, notify, muted_until) values (?1, ?2, ?3, ?4)
     on conflict(chat_id, who) do update set
       notify = case when ?5 then excluded.notify else chat_reads.notify end,
       muted_until = case when ?6 then excluded.muted_until else chat_reads.muted_until end
     returning notify, muted_until`,
  )
    .bind(
      reached.chat,
      reached.id,
      typeof notify === 'string' ? notify : null,
      typeof until === 'number' ? until : null,
      notify === undefined ? 0 : 1,
      until === undefined ? 0 : 1,
    )
    .first<{ notify: string | null; muted_until: number | null }>()
  return context.json({ notify: row?.notify ?? null, mutedUntil: row?.muted_until ?? null })
})

/* ── People ────────────────────────────────────────────────────────────── */

/** Who is in the chat: everybody its space reaches, and those holding its pointer on
 *  its own, each once at their strongest role, by name. */
const MEMBERS = `with c as (
  select sp.id as space_id, sp.user_id as owner, f.id as file_id
    from chats ch join spaces sp on sp.id = ch.space_id
    left join notes f on f.id = ch.file_id and f.space_id = ch.space_id and f.deleted = 0
   where ch.id = ?1
),
people as (
  select owner as id, 0 as guest, 3 as rank from c
  union all
  select u.id, 0, case m.role when 'write' then 2 else 1 end
    from c join space_members m on m.space_id = c.space_id and (m.item = '' or m.item = c.file_id)
    join users u on u.email = m.email
  union all
  select g.guest_id, 1, case g.role when 'write' then 2 else 1 end
    from c join guest_members g on g.space_id = c.space_id
                               and (g.item = '' or g.item = c.file_id) and g.joined_at is not null
)
select p.id as id, p.guest as guest, max(p.rank) as rank,
       case when p.guest = 1 then (select name from guests where id = p.id)
            else (select name from users where id = p.id) end as name
  from people p group by p.id, p.guest order by rank desc, name
  limit 500`

interface Member {
  who: Who
  name: string | null
  role: (typeof ROLES)[number]
}

export async function membersOf(env: Env, chat: string): Promise<Member[]> {
  const { results } = await env.DB.prepare(MEMBERS)
    .bind(chat)
    .all<{ id: string; guest: number; rank: number; name: string | null }>()
  return results.map((one) => ({
    who: one.guest === 1 ? `guest:${one.id}` : `user:${one.id}`,
    name: one.name,
    role: ROLES[one.rank] ?? 'read',
  }))
}

/** Names only: addresses are the owner's to see, in the share sheet. */
chats.get('/:chat/members', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  return context.json({ members: await membersOf(context.env, reached.chat) })
})

/* ── A note dropped in ─────────────────────────────────────────────────── */

/** The people of a chat, with an account, who cannot open one note: not its space's
 *  owner, and no membership of its space or of the note alone (`?2` the space, `?3` the
 *  note, `?1` the chat). A guest is not among them: nothing can be shared with a guest
 *  but by a link. */
const MISSING = `with c as (
  select sp.id as space_id, sp.user_id as owner, f.id as file_id
    from chats ch join spaces sp on sp.id = ch.space_id
    left join notes f on f.id = ch.file_id and f.space_id = ch.space_id and f.deleted = 0
   where ch.id = ?1 and ch.ended_at is null
),
people as (
  select owner as id from c
  union select u.id from c
    join space_members m on m.space_id = c.space_id and (m.item = '' or m.item = c.file_id)
    join users u on u.email = m.email
)
select u.id as id, u.email as email, u.name as name
  from people p join users u on u.id = p.id
 where u.id <> (select user_id from spaces where id = ?2)
   and not exists (select 1 from space_members m where m.space_id = ?2 and m.email = u.email
                     and (m.item = '' or m.item = ?3))
 order by u.name limit 200`

/** The note a request names, in the space it names, as the asker reaches that space. */
async function droppedNote(
  env: Env,
  who: Whoever,
  space: unknown,
  note: unknown,
): Promise<{ space: string; note: string; owner: boolean } | null> {
  if (typeof space !== 'string' || typeof note !== 'string') return null
  const reached = await reachedSpace(env, who, space)
  if (!reached) return null
  const found = await env.DB.prepare(
    'select id from notes where id = ? and space_id = ? and deleted = 0',
  )
    .bind(note, space)
    .first<{ id: string }>()
  return found ? { space, note, owner: reached.role === 'owner' } : null
}

/** Who in the chat cannot open a note dropped into it (docs/chats.md 4.13), by name, and
 *  whether the asker may share it with them: what the composer shows over the field
 *  before the message goes. Asked only by somebody who reaches the note themselves. */
chats.get('/:chat/note', async (context) => {
  const env = context.env
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const dropped = await droppedNote(
    env,
    context.get('who'),
    context.req.query('space'),
    context.req.query('note'),
  )
  if (!dropped) return context.json({ error: NO_SUCH_SPACE }, 404)
  const { results } = await env.DB.prepare(MISSING)
    .bind(reached.chat, dropped.space, dropped.note)
    .all<{ id: string; name: string | null }>()
  return context.json({
    missing: results.map((one) => ({ who: `user:${one.id}`, name: one.name })),
    share: dropped.owner,
  })
})

/** A note dropped into a chat shared, to read, with everybody in the chat who could not
 *  open it: Slack's one press when a file's link goes where some cannot follow it. By
 *  the note's owner only, as every share is; no mail goes, because the message they
 *  are about to read is the news. */
chats.post('/:chat/note', async (context) => {
  const env = context.env
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const sent = (await context.req.json().catch(() => null)) as Record<string, unknown> | null
  const dropped = await droppedNote(env, context.get('who'), sent?.space, sent?.note)
  if (!dropped) return context.json({ error: NO_SUCH_SPACE }, 404)
  if (!dropped.owner) return context.json({ error: refusal('owner') }, 403)
  if (!(await roomForAnItem(env, dropped.space, dropped.note))) {
    return context.json({ error: TOO_MANY_ITEMS }, 409)
  }
  const { results } = await env.DB.prepare(MISSING)
    .bind(reached.chat, dropped.space, dropped.note)
    .all<{ email: string }>()
  const at = now()
  for (const one of results) {
    await env.DB.prepare(
      `insert into space_members (space_id, email, item, role, joined_at, created_at)
       values (?, ?, ?, 'read', ?, ?) on conflict(space_id, email, item) do nothing`,
    )
      .bind(dropped.space, one.email, dropped.note, at, at)
      .run()
  }
  return context.json({ shared: results.length })
})

/* ── Search ────────────────────────────────────────────────────────────── */

/** The reader's calendar day of a moment, in the zone their device said (`zone`), UTC
 *  for one this runtime does not know. */
function dayIn(zone: string | undefined): (at: number) => string {
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: zone ?? 'UTC' })
  } catch {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' })
  }
  return (at) => format.format(new Date(at))
}

/** One search over some chats: the query as `@nib/chats` reads it, the candidates each
 *  chat's words index gives, answered with `matches`, newest first (4.12). */
export async function searched(
  env: Env,
  who: Whoever,
  query: (name: string) => string | undefined,
  picked: readonly { id: string; reached: Reached }[],
): Promise<{ chat: string; message: Message }[]> {
  const dayOf = dayIn(query('zone'))
  const asked = parseSearch(query('q') ?? '', query('today') ?? dayOf(Date.now()))
  const me: Who = who.kind === 'user' ? `user:${who.user.id}` : `guest:${who.guest.id}`
  const words = [...asked.words, ...asked.phrases]

  const found = await Promise.all(
    picked.map(async ({ id, reached }) => {
      const answer = await askChat(env, id, 'search', asking(reached), {
        body: JSON.stringify({ words }),
      })
      if (!answer?.ok) return []
      const { messages } = await answer.json<{ messages: Message[] }>()
      const names = new Map((await membersOf(env, id)).map((one) => [one.who, one.name ?? '']))
      const name = await chatName(env, id)
      return messages
        .filter((message) =>
          matches(asked, {
            message,
            chat: name,
            me,
            namesOf: (person) => [names.get(person) ?? ''].filter(Boolean),
            dayOf,
          }),
        )
        .map((message) => ({ chat: id, message }))
    }),
  )
  return found
    .flat()
    .sort((a, b) => b.message.at - a.message.at)
    .slice(0, MOST_HITS)
}

/** A chat's name: its pointer's file name, once the account has seen the pointer. */
async function chatName(env: Env, chat: string): Promise<string> {
  const row = await env.DB.prepare(
    'select f.path as path from chats ch join notes f on f.id = ch.file_id where ch.id = ?',
  )
    .bind(chat)
    .first<{ path: string }>()
  return (row?.path.split('/').pop() ?? '').replace(/\.chat$/i, '')
}

/** Across every chat this person reaches: the browser build's search, which has no store
 *  of its own to search. */
chats.get('/search', async (context) => {
  const who = context.get('who')
  const all = await listed(context.env, who, null)
  const reachedAll = await Promise.all(
    all.slice(0, MOST_SEARCHED).map(async (one) => ({
      id: one.id,
      reached: await reachChat(context.env, who, one.id),
    })),
  )
  const picked = reachedAll.flatMap((one) =>
    one.reached ? [{ id: one.id, reached: one.reached }] : [],
  )
  const hits = await searched(context.env, who, context.req.query.bind(context.req), picked)
  return context.json({ hits })
})

/** In one chat: Ctrl+F's search (4.12). */
chats.get('/:chat/search', async (context) => {
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const hits = await searched(
    context.env,
    context.get('who'),
    context.req.query.bind(context.req),
    [{ id: reached.chat, reached }],
  )
  return context.json({ hits: hits.map((one) => one.message) })
})

/* ── Files ─────────────────────────────────────────────────────────────── */

/** A file a message in this chat names, for its members. */
chats.get('/:chat/files/:hash', async (context) => {
  const env = context.env
  const hash = context.req.param('hash').toLowerCase()
  const reached = await reachedOf(context, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)

  const named = HASH.test(hash)
    ? await env.DB.prepare('select 1 as yes from chat_files where chat_id = ? and hash = ?')
        .bind(reached.chat, hash)
        .first<{ yes: number }>()
    : null
  const object = named ? await env.NOTES.get(blobKey(hash)) : null
  if (!object) return context.json({ error: NO_SUCH_FILE }, 404)

  return new Response(object.body, {
    headers: {
      'content-type': BYTES,
      'content-length': String(object.size),
      // Its bytes never change under one hash, and they are this chat's, not the
      // world's: kept by the device that asked and by nothing in between.
      'cache-control': 'private, max-age=31536000, immutable',
      etag: `"${hash}"`,
      'x-content-type-options': 'nosniff',
    },
  })
})
