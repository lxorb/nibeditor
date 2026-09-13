/** Sharing: who else may reach a space, or one file of it, the link that lets
 *  somebody ask, and the requests waiting on the owner.
 *
 *  Everything here is the owner's, which is what `owner` means. What the people
 *  it lets in may then do is decided somewhere else, by `atLeast` in front of
 *  every route that names a space; and how they got in is in `join.ts`.
 *
 *  Two kinds of person show up in the one sheet. A member is an address rather
 *  than an account, so somebody with no Nib account can be given a space today
 *  and find it waiting the first time they prove that address. A guest is
 *  whoever followed the space's own link, which names nobody and so has no
 *  address to write down: what the owner sees of them is the name their device
 *  gave them or the one they typed. Both hold one of the two given roles, and
 *  the sheet treats them the same because they are the same thing to it: a
 *  person in a space who is not its owner.
 *
 *  And two sizes of thing to share, which is the one addition: the space, as
 *  ever, or one note or canvas out of it. Every route below takes `?item=<note
 *  id>` and answers about that file instead; without it they answer about the
 *  space exactly as they always have. It is the same membership, the same two
 *  roles, the same link, the same guests and the same sheet - the row simply
 *  says what it is about. See docs/sharing.md. */

import { Hono, type MiddlewareHandler } from 'hono'
import { NOT_AN_EMAIL, NO_SUCH_NOTE, SPACE_IS_FULL } from '../refused'
import { readBody } from '../body'
import { isEmail, normaliseEmail, now, randomToken, sha256 } from '../crypto'
import { forgetMailed, inviteMessage, mailer, mayMail } from '../email'
import { forgetEmptyGuest } from '../guests'
import { machineOf } from '../limits'
import { roomsRevoked } from '../rooms'
import type { Env, Note, Space, User, Variables } from '../types'
import { atLeast, isGiven, MOST_ITEMS, spaceOf, type Given } from './space'

/** An invitation, a change of role or a guest's role with no role named. Three
 *  routes and one sentence: what is missing is the same field each time. */
const SAY_WHICH_ROLE = 'say whether they may write or read'

/** More people in one space than anyone shares with, and the bound on every
 *  listing below. Exported because `join.ts` holds a link to the same number: a
 *  space whose sheet cannot list everybody in it is a space whose owner cannot
 *  take anybody out. */
export const MOST_MEMBERS = 200
export const EMAIL_LIMIT = 320
/** An id is a UUID; the length is all this needs to know. */
const ID_LIMIT = 64
/** How long the link in an invitation stays a shortcut. After that the address
 *  still opens the space; only the link has stopped carrying it there. */
const INVITE_TTL = 30 * 24 * 60 * 60 * 1000

/** How long a request nobody answered waits. The same month an invitation's link
 *  lasts, for the same reason: past that it is not something either side is still
 *  thinking about, and the person can ask again in one press. */
const WAITED_FOR = 30 * 24 * 60 * 60 * 1000

/** Requests nobody answered, let go. Part of the nightly job, beside Recently
 *  deleted; nothing else would ever take these away, and every one of them counts
 *  against how many people may be waiting on the space. */
export async function expireRequests(env: Env, at: number): Promise<number> {
  const gone = await env.DB.prepare('delete from space_requests where created_at < ?')
    .bind(at - WAITED_FOR)
    .run()

  return gone.meta.changes
}

type Mode = 'open' | 'approval'

function isMode(value: unknown): value is Mode {
  return value === 'open' || value === 'approval'
}

/** A role somebody can be given: never `owner`, which is the space's own column. */
function givenRole(value: unknown): Given | null {
  return isGiven(value) ? value : null
}

/* ── What one share is about ──────────────────────────────────────────── */

/** What a share is about: one file of the space, or the space itself.
 *
 *  `id` is the empty string for the space, which is what the column holds for
 *  every row written before there were items and what every query below binds.
 *  See migration 0026: a key has to be able to say that two rows are the same
 *  row, and one null is not equal to another. */
export interface Scope {
  id: string
  /** The file's path, for the head of the sheet and for the mail. Null for the
   *  space, which is named by the space. */
  path: string | null
}

const WHOLE_SPACE: Scope = { id: '', path: null }

/** Which share the request is about, off `?item=`. Null when it names a note
 *  that is not a live note of this space - which is the same 404 a note nobody
 *  shared gets, and says nothing about whether the id exists somewhere else. */
async function scopeOf(
  env: Env,
  spaceId: string,
  asked: string | undefined,
): Promise<Scope | null> {
  const id = (asked ?? '').slice(0, ID_LIMIT)
  if (!id) return WHOLE_SPACE

  const note = await env.DB.prepare(
    'select id, path from notes where id = ? and space_id = ? and deleted = 0',
  )
    .bind(id, spaceId)
    .first<Pick<Note, 'id' | 'path'>>()

  return note ? { id: note.id, path: note.path } : null
}

/** How many of a space's files are shared on their own right now, counting the
 *  ones nobody has opened yet: an invitation is a share whether or not it has
 *  been walked through, and a ceiling that only counted arrivals would not be
 *  one. */
async function itemsShared(env: Env, spaceId: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    `select item from space_members where space_id = ?1 and item <> ''
      union select item from space_links where space_id = ?1 and item <> ''
      union select item from guest_members where space_id = ?1 and item <> ''
      limit ?2`,
  )
    .bind(spaceId, MOST_ITEMS + 1)
    .all<{ item: string }>()

  return new Set(results.map((row) => row.item))
}

/** Whether one more of this space's files may be shared. Nothing is refused
 *  about a file that is already shared: what is bounded is how many of them
 *  there are, not how many people are in one. */
async function roomForAnItem(env: Env, spaceId: string, item: string): Promise<boolean> {
  if (!item) return true

  const held = await itemsShared(env, spaceId)
  return held.has(item) || held.size < MOST_ITEMS
}

/** What a sheet is told when a space is sharing as many of its files as it can. */
const TOO_MANY_ITEMS = 'that is as many notes as one space shares on their own'

interface MemberRow {
  email: string
  role: Given
  joined_at: number | null
  name: string | null
}

interface RequestRow {
  email: string
  role: Given
  created_at: number
  name: string | null
}

interface LinkRow {
  space_id: string
  item: string
  token: string
  role: Given
  mode: Mode
  created_at: number
}

/** Somebody the space's own link let in. `joined_at` is whether they are in:
 *  null with no `declined_at` is a request the owner has not answered yet. */
interface GuestRow {
  guest_id: string
  name: string
  /** What they typed into a link that asks first, unverified. Shown to the owner
   *  because it is what the request said, and never treated as proved. */
  email: string | null
  role: Given
  joined_at: number | null
  declined_at: number | null
  created_at: number
}

/** Where a link takes somebody. The web app reads this path, and so does the
 *  desktop app when it is what opened it; see docs/collaboration.md. */
function joinUrl(env: Env, token: string): string {
  return `${env.APP_ORIGIN}/join/${token}`
}

/** What to call somebody in a sentence: the name on the account, else the part
 *  of the address in front of the at sign. Never the whole address, which is
 *  not a name and which the other person may not have been given. */
export function personName(user: { name: string | null; email: string }): string {
  const chosen = user.name?.trim()
  if (chosen) return chosen

  return user.email.split('@')[0] ?? user.email
}

/** What a file is called in a sentence: its own name, without the folders in
 *  front of it and without the extension the app keeps its documents under. */
export function itemName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.replace(/\.(md|markdown|mdown|mkd)$/i, '')
}

/** The account at an address, which is what a room knows a person as. Null for a
 *  membership written to an address nobody has proved yet: that person has no
 *  session anywhere, so there is nothing of theirs to close. */
async function accountAt(env: Env, email: string): Promise<string | null> {
  const row = await env.DB.prepare('select id from users where email = ?')
    .bind(email)
    .first<{ id: string }>()

  return row?.id ?? null
}

async function membersOf(env: Env, spaceId: string, item: string): Promise<MemberRow[]> {
  const { results } = await env.DB.prepare(
    `select m.email, m.role, m.joined_at, u.name
       from space_members m
       left join users u on u.email = m.email
      where m.space_id = ? and m.item = ?
      order by m.created_at, m.email limit ?`,
  )
    .bind(spaceId, item, MOST_MEMBERS)
    .all<MemberRow>()

  return results
}

async function requestsOf(env: Env, spaceId: string, item: string): Promise<RequestRow[]> {
  const { results } = await env.DB.prepare(
    `select r.email, r.role, r.created_at, u.name
       from space_requests r
       left join users u on u.email = r.email
      where r.space_id = ? and r.item = ?
      order by r.created_at, r.email limit ?`,
  )
    .bind(spaceId, item, MOST_MEMBERS)
    .all<RequestRow>()

  return results
}

async function guestsOf(env: Env, spaceId: string, item: string): Promise<GuestRow[]> {
  const { results } = await env.DB.prepare(
    `select g.id as guest_id, g.name, g.email, m.role, m.joined_at, m.declined_at, m.created_at
       from guest_members m join guests g on g.id = m.guest_id
      where m.space_id = ? and m.item = ? and m.declined_at is null
      order by m.created_at, g.id limit ?`,
  )
    .bind(spaceId, item, MOST_MEMBERS)
    .all<GuestRow>()

  return results
}

async function linkOf(env: Env, spaceId: string, item: string): Promise<LinkRow | null> {
  const row = await env.DB.prepare('select * from space_links where space_id = ? and item = ?')
    .bind(spaceId, item)
    .first<LinkRow>()

  return row ?? null
}

/** One row of the sheet's People list. Whichever kind of person it is, exactly
 *  one of `email` and `guest` says which and names them: a member is an address,
 *  a guest is an id, and the sheet keys its rows on whichever it got. */
function presentMember(member: MemberRow) {
  return {
    email: member.email,
    guest: null,
    name: member.name,
    role: member.role,
    // Nobody has opened it yet. Shown quietly beside the name rather than as a
    // second list: they are already in, they have simply not been in.
    pending: member.joined_at === null,
  }
}

function presentGuest(guest: GuestRow) {
  return {
    email: guest.email,
    guest: guest.guest_id,
    name: guest.name,
    role: guest.role,
    // A guest who is in has been in: the link they followed was the arriving.
    pending: false,
  }
}

function presentLink(env: Env, link: LinkRow) {
  return { url: joinUrl(env, link.token), role: link.role, mode: link.mode }
}

/** Everything the sheet draws, in one request.
 *
 *  Members and guests are one list, and so are the two ways of waiting: what the
 *  owner is being asked is the same question either way, and a sheet with two
 *  Waiting sections would be saying so twice. */
async function sharing(env: Env, space: Space, owner: User, scope: Scope) {
  const [members, requests, guests, link] = await Promise.all([
    membersOf(env, space.id, scope.id),
    requestsOf(env, space.id, scope.id),
    guestsOf(env, space.id, scope.id),
    linkOf(env, space.id, scope.id),
  ])

  return {
    owner: { email: owner.email, name: owner.name },
    /** Which file this is about, so the sheet's head can say so. Null for the
     *  space, which the sheet already knows it is in. */
    item: scope.path === null ? null : { id: scope.id, path: scope.path },
    members: [
      ...members.map(presentMember),
      ...guests.filter((one) => one.joined_at !== null).map(presentGuest),
    ],
    requests: [
      ...requests.map((one) => ({
        email: one.email,
        guest: null,
        name: one.name,
        role: one.role,
        at: one.created_at,
      })),
      ...guests
        .filter((one) => one.joined_at === null)
        .map((one) => ({
          email: one.email,
          guest: one.guest_id,
          name: one.name,
          role: one.role,
          at: one.created_at,
        })),
    ],
    link: link ? presentLink(env, link) : null,
  }
}

export const share = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Middleware: the share the request names, put on the request.
 *
 *  Written once, behind `atLeast('owner')`, so that no route can forget it and
 *  so that a note id naming nothing in this space is refused in one place. Every
 *  route below then reads `scope` and is otherwise the route it always was:
 *  there is one set of routes for both sizes of share, because there is one
 *  question. */
function about(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (context, next) => {
    const space = spaceOf(context)
    const scope = await scopeOf(context.env, space.id, context.req.query('item'))
    if (!scope) return context.json({ error: NO_SUCH_NOTE }, 404)

    context.set('scope', scope)
    await next()
  }
}

share.get('/:id/share', atLeast('owner'), about(), async (context) => {
  return context.json(
    await sharing(context.env, spaceOf(context), context.get('user'), context.get('scope')),
  )
})

/** Somebody is given the space, or one file of it, and told so. The row is
 *  written first and the mail sent after: the membership is what lets them in,
 *  and a mail that could not go out is not a reason for the sharing not to have
 *  happened. */
share.post('/:id/share/invite', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const owner = context.get('user')

  const body = await readBody(context)
  const given = body.text('email', EMAIL_LIMIT)
  const asked = body.text('role', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const email = normaliseEmail(given ?? '')
  const role = givenRole(asked)

  if (!isEmail(email)) return context.json({ error: NOT_AN_EMAIL }, 400)
  if (!role) return context.json({ error: SAY_WHICH_ROLE }, 400)
  if (email === owner.email) {
    return context.json(
      { error: scope.id ? 'this note is already yours' : 'this space is already yours' },
      409,
    )
  }

  const held = await membersOf(context.env, space.id, scope.id)
  if (held.length >= MOST_MEMBERS && !held.some((one) => one.email === email)) {
    return context.json({ error: SPACE_IS_FULL }, 409)
  }

  if (!(await roomForAnItem(context.env, space.id, scope.id))) {
    return context.json({ error: TOO_MANY_ITEMS }, 409)
  }

  // Asked before anything is written, because a ceiling is the one answer here
  // that is a refusal rather than a quiet no: the invitation itself is what lets
  // somebody in, so a row written and then answered 429 would be an owner told
  // nothing happened while it had.
  const may = await mayMail(context.env, email, machineOf(context.req))
  if (may.error) return context.json({ error: may.error }, 429)

  const token = randomToken()
  await context.env.DB.prepare(
    `insert into space_members (space_id, email, item, role, invite_hash, expires_at, created_at)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     on conflict(space_id, email, item) do update set
       role = excluded.role,
       invite_hash = excluded.invite_hash,
       expires_at = excluded.expires_at`,
  )
    .bind(space.id, email, scope.id, role, await sha256(token), now() + INVITE_TTL, now())
    .run()

  // Asking to be let in and then being let in is one thing, not two.
  await context.env.DB.prepare(
    'delete from space_requests where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .run()

  // Whether the mail went is not answered back. The gate is per address across
  // every space there is, so saying so would tell an owner whether somebody
  // else had just written to that address.
  if (may.ok) {
    const message = inviteMessage({
      space: space.name,
      item: scope.path === null ? null : itemName(scope.path),
      from: personName(owner),
      role,
      link: joinUrl(context.env, token),
    })

    // Still nothing said back about it - but a send that failed gives up the gap
    // it took, so an owner pressing the button again writes to the address
    // instead of being held behind a message that never went. The invitation
    // above stands either way: the row is what lets somebody in, and the link in
    // it is one the owner can hand over themselves.
    if (!(await mailer(context.env).send(email, message.subject, message))) {
      await forgetMailed(context.env, email)
    }
  }

  return context.json(await sharing(context.env, space, owner, scope))
})

share.patch('/:id/share/members/:email', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')

  const body = await readBody(context)
  const asked = body.text('role', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const role = givenRole(asked)
  if (!role) return context.json({ error: SAY_WHICH_ROLE }, 400)

  const email = normaliseEmail(context.req.param('email'))
  const held = await context.env.DB.prepare(
    'select role from space_members where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .first<{ role: Given }>()

  if (!held) return context.json({ error: 'nobody by that address' }, 404)

  await context.env.DB.prepare(
    'update space_members set role = ? where space_id = ? and email = ? and item = ?',
  )
    .bind(role, space.id, email, scope.id)
    .run()

  // A writer who is now a reader may have a file of this space open, and a socket
  // is not a request: nothing else would ask again. Only the one file, when the
  // share was about one file: nothing else they hold has changed.
  if (held.role === 'write' && role === 'read') {
    await roomsRevoked(context.env, space.id, await accountAt(context.env, email), 'read', scope.id)
  }

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.delete('/:id/share/members/:email', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const email = normaliseEmail(context.req.param('email'))

  await context.env.DB.prepare(
    'delete from space_members where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .run()

  await roomsRevoked(context.env, space.id, await accountAt(context.env, email), 'none', scope.id)

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

/** Somebody letting themselves out of a space. The one thing under this path
 *  that is not the owner's: being in a space is something a person can stop, and
 *  having to ask the owner to do it for them is not a way to leave.
 *
 *  Which is as true of a guest, so this is the one route under `share` a guest
 *  may ask for. A guest who leaves their last space is nobody, and the session
 *  goes with them: the device is back to the app it had before the link.
 *
 *  Only ever about the space, because reaching this route at all means reaching
 *  the space. Letting yourself out of one file is `DELETE /v1/shared/:id`, which
 *  is where the files somebody was given are listed. */
share.delete('/:id/share/me', atLeast('read'), async (context) => {
  const space = spaceOf(context)
  const who = context.get('who')
  if (space.role === 'owner') return context.json({ error: 'this space is yours' }, 409)

  if (who.kind === 'guest') {
    await context.env.DB.prepare(
      "delete from guest_members where space_id = ? and guest_id = ? and item = ''",
    )
      .bind(space.id, who.guest.id)
      .run()
    await forgetEmptyGuest(context.env, who.guest.id)
    await roomsRevoked(context.env, space.id, who.guest.id, 'none')

    return context.json({ ok: true })
  }

  await context.env.DB.prepare(
    "delete from space_members where space_id = ? and email = ? and item = ''",
  )
    .bind(space.id, who.user.email)
    .run()

  // Their own other devices, which may still have a file of it open: leaving on
  // one is leaving.
  await roomsRevoked(context.env, space.id, who.user.id, 'none')

  return context.json({ ok: true })
})

/** The link, made on the first ask and kept afterwards. Changing what it hands
 *  out changes it for the copy already in somebody's message, which is what an
 *  owner means by changing it; a link that should stop working is revoked.
 *
 *  One per thing shared: the space has its own, and so does each file shared on
 *  its own. A file's link opens that file and nothing around it. */
share.put('/:id/share/link', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')

  const body = await readBody(context)
  const askedRole = body.text('role', 16)
  const askedMode = body.text('mode', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const role = givenRole(askedRole)
  const mode = isMode(askedMode) ? askedMode : null
  if (!role) return context.json({ error: 'say whether the link may write or read' }, 400)
  if (!mode) return context.json({ error: 'say whether the link asks first' }, 400)

  if (!(await roomForAnItem(context.env, space.id, scope.id))) {
    return context.json({ error: TOO_MANY_ITEMS }, 409)
  }

  const held = await linkOf(context.env, space.id, scope.id)
  const token = held?.token ?? randomToken()

  await context.env.DB.prepare(
    `insert into space_links (space_id, item, token, role, mode, created_at)
     values (?1, ?2, ?3, ?4, ?5, ?6)
     on conflict(space_id, item) do update set role = excluded.role, mode = excluded.mode`,
  )
    .bind(space.id, scope.id, token, role, mode, now())
    .run()

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.delete('/:id/share/link', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')

  await context.env.DB.prepare('delete from space_links where space_id = ? and item = ?')
    .bind(space.id, scope.id)
    .run()

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.post('/:id/share/requests/:email', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const email = normaliseEmail(context.req.param('email'))

  const waiting = await context.env.DB.prepare(
    'select role from space_requests where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .first<{ role: Given }>()

  if (!waiting) return context.json({ error: 'nobody by that address' }, 404)

  // Already proved the address to have asked at all, so they are in rather than
  // invited: joined_at is set now and no mail goes anywhere. Set on a row that
  // was already there as well - an invitation nobody had opened - or accepting
  // the request would leave the sheet saying they are still waiting to arrive
  // when they have already been.
  await context.env.DB.prepare(
    `insert into space_members (space_id, email, item, role, joined_at, created_at)
     values (?1, ?2, ?3, ?4, ?5, ?5)
     on conflict(space_id, email, item) do update set
       role = excluded.role,
       joined_at = coalesce(space_members.joined_at, excluded.joined_at)`,
  )
    .bind(space.id, email, scope.id, waiting.role, now())
    .run()

  await context.env.DB.prepare(
    'delete from space_requests where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .run()

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.delete('/:id/share/requests/:email', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const email = normaliseEmail(context.req.param('email'))

  await context.env.DB.prepare(
    'delete from space_requests where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .run()

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

/* ── The guests the link let in ───────────────────────────────────────── */

/** A guest is one row rather than a membership and a request, so the three
 *  things the owner can do to one are three verbs on one path: let them in,
 *  change what they may do, and end it. Which of the two lists they were in when
 *  it happened is the row's own business.
 *
 *  Nothing here takes an address, because a guest has none to take. */

function guestIdOf(context: { req: { param: (name: string) => string | undefined } }): string {
  return (context.req.param('guest') ?? '').slice(0, ID_LIMIT)
}

/** Letting a waiting guest in, at the role the link promised them. */
share.post('/:id/share/guests/:guest', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const guest = guestIdOf(context)

  const waiting = await context.env.DB.prepare(
    `select role from guest_members
      where space_id = ? and guest_id = ? and item = ?
        and joined_at is null and declined_at is null`,
  )
    .bind(space.id, guest, scope.id)
    .first<{ role: Given }>()

  if (!waiting) return context.json({ error: 'nobody is waiting by that name' }, 404)

  await context.env.DB.prepare(
    'update guest_members set joined_at = ? where space_id = ? and guest_id = ? and item = ?',
  )
    .bind(now(), space.id, guest, scope.id)
    .run()

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.patch('/:id/share/guests/:guest', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const guest = guestIdOf(context)

  const body = await readBody(context)
  const asked = body.text('role', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const role = givenRole(asked)
  if (!role) return context.json({ error: SAY_WHICH_ROLE }, 400)

  const held = await context.env.DB.prepare(
    'select role from guest_members where space_id = ? and guest_id = ? and item = ?',
  )
    .bind(space.id, guest, scope.id)
    .first<{ role: Given }>()

  if (!held) return context.json({ error: 'nobody by that name' }, 404)

  await context.env.DB.prepare(
    'update guest_members set role = ? where space_id = ? and guest_id = ? and item = ?',
  )
    .bind(role, space.id, guest, scope.id)
    .run()

  if (held.role === 'write' && role === 'read') {
    await roomsRevoked(context.env, space.id, guest, 'read', scope.id)
  }

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

/** Declining somebody who is waiting, and taking out somebody who is in. One
 *  gesture, because to the owner it is one: this person is not in my space.
 *
 *  A guest who was waiting keeps their row, stamped, so the calm page they are
 *  waiting on can say they were told no rather than only stop saying anything. A
 *  guest who was in loses the row, which is what ends their access on the next
 *  pass - and loses the guest itself once nothing of theirs is left. */
share.delete('/:id/share/guests/:guest', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const guest = guestIdOf(context)

  const held = await context.env.DB.prepare(
    'select joined_at from guest_members where space_id = ? and guest_id = ? and item = ?',
  )
    .bind(space.id, guest, scope.id)
    .first<{ joined_at: number | null }>()

  if (held?.joined_at === null) {
    await context.env.DB.prepare(
      'update guest_members set declined_at = ? where space_id = ? and guest_id = ? and item = ?',
    )
      .bind(now(), space.id, guest, scope.id)
      .run()
  } else {
    await context.env.DB.prepare(
      'delete from guest_members where space_id = ? and guest_id = ? and item = ?',
    )
      .bind(space.id, guest, scope.id)
      .run()
    await forgetEmptyGuest(context.env, guest)
    await roomsRevoked(context.env, space.id, guest, 'none', scope.id)
  }

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

/* ── The files somebody else shared with me ───────────────────────────── */

/** One file this person was given on its own: what it is, whose it is, and what
 *  they may do to it.
 *
 *  A file, not a space: there is no folder for it on the machine and no row in
 *  the tree, because it is one note out of somebody else's drawer and inventing
 *  a drawer to put it in would be inventing a space. It is listed at the foot of
 *  the space switcher and opens in a tab of its own, whose words travel through
 *  the file's room; see docs/sharing.md. */
interface SharedRow {
  id: string
  path: string
  updated_at: number
  role: Given
  space_id: string
  space_name: string
  owner_name: string | null
  owner_email: string
}

const SHARED_WITH_ME = `select n.id, n.path, n.updated_at, m.role,
    sp.id as space_id, sp.name as space_name, u.name as owner_name, u.email as owner_email
  from space_members m
  join notes n on n.id = m.item and n.deleted = 0
  join spaces sp on sp.id = m.space_id and sp.deleted = 0
  join users u on u.id = sp.user_id
 where m.email = ?1 and m.item <> ''
 order by u.email, n.path limit ?2`

/** And the same for a guest, whose row is keyed by the guest and who is only in
 *  once the owner has said so. */
const GUEST_SHARED_WITH_ME = `select n.id, n.path, n.updated_at, g.role,
    sp.id as space_id, sp.name as space_name, u.name as owner_name, u.email as owner_email
  from guest_members g
  join notes n on n.id = g.item and n.deleted = 0
  join spaces sp on sp.id = g.space_id and sp.deleted = 0
  join users u on u.id = sp.user_id
 where g.guest_id = ?1 and g.item <> '' and g.joined_at is not null
 order by u.email, n.path limit ?2`

/** One shared file as the app reads it, wherever it is answered: the listing
 *  below, and walking through a link to one; see join.ts. One shape, because the
 *  app opens it the same way whichever answer carried it. */
export function presentItem(item: {
  id: string
  path: string
  updatedAt: number
  role: Given
  space: { id: string; name: string }
  owner: { name: string | null; email: string }
}) {
  return {
    id: item.id,
    path: item.path,
    name: itemName(item.path),
    role: item.role,
    updatedAt: item.updatedAt,
    /** Whose it is, by name. Never the address: a name is what a row needs, and
     *  an address is something the person shared with may not have been given. */
    owner: { name: personName(item.owner) },
    /** Which space it came out of, so two notes called the same thing from two
     *  people are still told apart. The id travels because the room's door needs
     *  no space and the app's listing does not either - it is here for the mark,
     *  not for a way in. */
    space: { id: item.space.id, name: item.space.name },
  }
}

function presentShared(row: SharedRow) {
  return presentItem({
    id: row.id,
    path: row.path,
    updatedAt: row.updated_at,
    role: row.role,
    space: { id: row.space_id, name: row.space_name },
    owner: { name: row.owner_name, email: row.owner_email },
  })
}

export const sharedWithMe = new Hono<{ Bindings: Env; Variables: Variables }>()

sharedWithMe.get('/', async (context) => {
  const who = context.get('who')
  const { results } =
    who.kind === 'user'
      ? await context.env.DB.prepare(SHARED_WITH_ME)
          .bind(who.user.email, MOST_ITEMS)
          .all<SharedRow>()
      : await context.env.DB.prepare(GUEST_SHARED_WITH_ME)
          .bind(who.guest.id, MOST_ITEMS)
          .all<SharedRow>()

  return context.json({ shared: results.map(presentShared) })
})

/** Letting yourself out of one file, which is the same act as leaving a space
 *  and for the same reason: what somebody was handed is theirs to hand back.
 *
 *  Outside `atLeast`, because somebody holding one note of a space cannot reach
 *  the space at all - which is the whole point of an item share.
 *
 *  The same answer whatever is there. Nobody has to hold anything to ask this, and it
 *  used to say 404 for a name no note has - so anybody signed in, and any guest with
 *  a link to one unrelated file, could ask whether an id names a note on this server
 *  and be told, one guess at a time, about spaces they have never been near. Letting
 *  go of what you were never holding is already done, so `ok` is the truth as well as
 *  the only thing worth saying: a row that is not there is deleted by a statement that
 *  matches nothing. */
sharedWithMe.delete('/:noteId', async (context) => {
  const who = context.get('who')
  const noteId = context.req.param('noteId').slice(0, ID_LIMIT)

  const note = await context.env.DB.prepare('select id, space_id from notes where id = ?')
    .bind(noteId)
    .first<Pick<Note, 'id' | 'space_id'>>()

  if (note && who.kind === 'guest') {
    await context.env.DB.prepare(
      'delete from guest_members where space_id = ? and guest_id = ? and item = ?',
    )
      .bind(note.space_id, who.guest.id, note.id)
      .run()
    await forgetEmptyGuest(context.env, who.guest.id)
    await roomsRevoked(context.env, note.space_id, who.guest.id, 'none', note.id)
  }

  if (note && who.kind === 'user') {
    await context.env.DB.prepare(
      'delete from space_members where space_id = ? and email = ? and item = ?',
    )
      .bind(note.space_id, who.user.email, note.id)
      .run()

    await roomsRevoked(context.env, note.space_id, who.user.id, 'none', note.id)
  }

  return context.json({ ok: true })
})
