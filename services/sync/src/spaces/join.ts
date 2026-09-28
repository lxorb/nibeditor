/** Following a link into a space somebody shared.
 *
 *  If somebody shares something with you, you should not have to sign in to see
 *  it. So a link is its own proof, and which proof it is depends on which link:
 *
 *  An **invitation** was written to an address and mailed to it, so holding the
 *  mail is holding the address. Opening the link establishes the session for
 *  that address the way a magic link does, once, and lands in the space. It is
 *  the same account the emailed code would have opened, and the code is still
 *  there for whoever comes to a link that has been used or has run out.
 *
 *  An **open link** names nobody, so there is nothing to prove and asking for an
 *  address anyway is a sign-up wearing a different hat. It hands out a guest
 *  instead: a session with a name on it and no account behind it, in that one
 *  space at that one role. See src/guests.ts.
 *
 *  A link that **asks first** is the same guest, with one field in front of it so
 *  that the owner has something to accept or decline, and a wait that turns into
 *  the space when they do.
 *
 *  All three end at `POST /v1/join/:token`, which is also what somebody waiting
 *  asks again: the answer to "let me in" and the answer to "am I in yet" are the
 *  same answer. `GET` is the peek and stays open to anybody, because it is what
 *  the page shows before there is a session to have. Mail clients follow links,
 *  so nothing that changes anything happens on a GET. */

import { Hono, type Context } from 'hono'
import { SPACE_IS_FULL } from '../refused'
import { accountFor, claimWhatWasGuested, openSession, presentUser, requireWhoever } from '../auth'
import { readBody } from '../body'
import { cleanPersonName, isEmail, NAME_LIMIT, normaliseEmail, now, sha256 } from '../crypto'
import { forgetMailed, mailer, mayMail, requestMessage } from '../email'
import { claimGuest, newGuest, presentGuest } from '../guests'
import { machineOf, mayTellTheOwner } from '../limits'
import { asksForSecond, halfWay } from '../second'
import type { Env, Guest, Space, User, Variables } from '../types'
import { EMAIL_LIMIT, itemName, MOST_MEMBERS, personName, presentItem } from './share'
import { presentSpace, type Given } from './space'

/** A link that opens nothing: one nobody issued, one already spent, or one of the
 *  wrong kind for the route it was sent to. The same words for all of them, because
 *  which it was is not somebody-with-a-link's to learn. */
const EXPIRED = 'that link has expired'

type Mode = 'open' | 'approval'

/** What a device calls itself, which becomes the first half of a guest's name.
 *  A word, not a sentence. */
const DEVICE_LIMIT = 24

/** How many guests one space takes through its link in a minute, and how many it
 *  holds at once. A link anybody may follow is a door with no lock on it, so the
 *  bound belongs on the door rather than on whoever knocks: without it one
 *  address could make rows all afternoon. */
const GUESTS_A_MINUTE = 20
const MOST_GUESTS = 200

/** How many people may be waiting on one space at once, of either kind. The
 *  Share sheet lists two hundred of each list, and somebody it cannot show is
 *  somebody the owner can neither accept nor decline - the same reason a space
 *  holds two hundred people. */
const MOST_WAITING = MOST_MEMBERS

/** Where a token leads. One of two things, because there are two kinds of link:
 *  the space's own, which anybody may hold, and an invitation, which was written
 *  to one address.
 *
 *  And what it leads to is either the space or one file of it, which is `item`:
 *  the note's id, or empty for the space. Every check below is scoped by it, so a
 *  link to one note is bounded, waited on and joined exactly as a link to a space
 *  is - what is being shared is smaller and nothing else differs. */
interface About {
  /** The note this link is about, or empty for the space. */
  item: string
  /** That note's path, for the page and for the answer. Null for the space. */
  path: string | null
}

type Leads =
  | ({ kind: 'link'; space: Space; role: Given; mode: Mode } & About)
  | ({ kind: 'invite'; space: Space; role: Given; email: string; hash: string } & About)

type Reply = Context<{ Bindings: Env; Variables: Variables }>

/** What a token is about. Answered without a session, because it is what the
 *  page shows somebody who has not signed in yet: the space they were sent to,
 *  and what they will be able to do there. A token that names nothing is a 404,
 *  so the endpoint says nothing about spaces to somebody guessing. */
async function tokenLeadsTo(env: Env, token: string): Promise<Leads | null> {
  if (!token || token.length > 128) return null

  // The note is joined rather than looked up afterwards: a link to a file that
  // has been deleted since leads nowhere, which is the same answer as a link that
  // was never one. `item = ''` joins nothing and leaves the path null, which is
  // the space's own link.
  const link = await env.DB.prepare(
    `select l.role, l.mode, l.item, n.path as item_path, sp.* from space_links l
       join spaces sp on sp.id = l.space_id
       left join notes n on n.id = l.item and n.deleted = 0
      where l.token = ? and sp.deleted = 0 and (l.item = '' or n.id is not null)`,
  )
    .bind(token)
    .first<Space & { role: Given; mode: Mode; item: string; item_path: string | null }>()

  if (link) {
    return {
      kind: 'link',
      space: link,
      role: link.role,
      mode: link.mode,
      item: link.item,
      path: link.item_path,
    }
  }

  const hash = await sha256(token)
  const invite = await env.DB.prepare(
    `select m.email, m.role, m.expires_at, m.item, n.path as item_path, sp.* from space_members m
       join spaces sp on sp.id = m.space_id
       left join notes n on n.id = m.item and n.deleted = 0
      where m.invite_hash = ? and sp.deleted = 0 and (m.item = '' or n.id is not null)`,
  )
    .bind(hash)
    .first<
      Space & {
        email: string
        role: Given
        expires_at: number | null
        item: string
        item_path: string | null
      }
    >()

  if (!invite) return null
  // The address still opens the space; only the shortcut has run out.
  if (invite.expires_at !== null && invite.expires_at < now()) return null

  return {
    kind: 'invite',
    space: invite,
    role: invite.role,
    email: invite.email,
    hash,
    item: invite.item,
    path: invite.item_path,
  }
}

/** What the link led to, as the app opens it: the space, or the one file. Every
 *  answer below that lets somebody in carries one of the two, and the app reads
 *  whichever it got. */
function landedOn(env: Env, found: Leads, role: Given | 'owner', owner: OwnerRow | null) {
  if (!found.item || found.path === null) {
    return { space: presentSpace(found.space, env, role, true) }
  }

  return {
    item: presentItem({
      id: found.item,
      path: found.path,
      updatedAt: now(),
      // The owner walking through their own link is the one case this is not one
      // of the two given roles. It reads as what the link hands out instead: a
      // row in the owner's own switcher is not what Shared with you is for, and
      // their own file is already where they keep it.
      role: role === 'owner' ? found.role : role,
      space: { id: found.space.id, name: found.space.name },
      owner: owner ?? { name: null, email: '' },
    }),
  }
}

interface OwnerRow {
  name: string | null
  email: string
}

/** Whoever owns the space, for the sentence a page or a mail puts their name in. */
function ownerOf(env: Env, space: Space) {
  return env.DB.prepare('select name, email from users where id = ?')
    .bind(space.user_id)
    .first<{ name: string | null; email: string }>()
}

/** An invitation opens the space once. What it hands out is a session for an
 *  address nobody typed a code for, so it is spent the moment it works: after
 *  this the link says it has expired, and the code is the way in. The membership
 *  stays, because the membership was never the link's to take away. */
function spendInvitation(env: Env, hash: string): Promise<unknown> {
  return env.DB.prepare(
    'update space_members set invite_hash = null, expires_at = null where invite_hash = ?',
  )
    .bind(hash)
    .run()
}

/** The membership, written or found, and the role it actually holds. Somebody
 *  already in the space at a role the owner gave them keeps it: a link is how
 *  they arrived, not what they are.
 *
 *  Null when the space is full and this person is not in it. The invitation route
 *  holds itself to the same number, and a link that did not would be the way
 *  round it: past it the Share sheet cannot list the people it holds, so the owner
 *  can neither see nor take out whoever came in last. */
async function memberNow(
  env: Env,
  found: Leads,
  email: string,
  role: Given,
): Promise<Given | null> {
  const { space, item } = found

  const roleOf = () =>
    env.DB.prepare('select role from space_members where space_id = ? and email = ? and item = ?')
      .bind(space.id, email, item)
      .first<{ role: Given }>()

  const counted = await env.DB.prepare(
    'select count(*) as held from space_members where space_id = ? and item = ?',
  )
    .bind(space.id, item)
    .first<{ held: number }>()

  // A full space still lets in somebody who is already a member: what is refused
  // is one more row, not one more visit.
  if ((counted?.held ?? 0) >= MOST_MEMBERS) return (await roleOf())?.role ?? null

  await env.DB.prepare(
    `insert into space_members (space_id, email, item, role, joined_at, created_at)
     values (?1, ?2, ?3, ?4, ?5, ?5)
     on conflict(space_id, email, item)
       do update set joined_at = coalesce(space_members.joined_at, ?5)`,
  )
    .bind(space.id, email, item, role, now())
    .run()

  return (await roleOf())?.role ?? role
}

/** What a link says when the space it leads to holds as many people as it can. */
function spaceIsFull(context: Reply) {
  return context.json({ error: SPACE_IS_FULL }, 409)
}

/** Whether the space has room for another guest through its link: how many are
 *  in it, and how many arrived in the last minute.
 *
 *  Only the guests who are actually in count towards the first. A row for
 *  somebody the owner never answered, or said no to, is not a person in the
 *  space, and counting them used to make the ceiling permanent: two hundred
 *  people knocking on a link once was a link that had stopped working for ever,
 *  with nothing an owner could do about it. Waiting is bounded by `roomToWait`
 *  instead, and a row nobody answered runs out after a month; see
 *  `expireGuests`. */
async function roomForAGuest(env: Env, spaceId: string, item: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select sum(case when joined_at is not null then 1 else 0 end) as held,
            sum(case when created_at > ?2 then 1 else 0 end) as lately
       from guest_members where space_id = ?1 and item = ?3`,
  )
    .bind(spaceId, now() - 60_000, item)
    .first<{ held: number | null; lately: number | null }>()

  return (held?.held ?? 0) < MOST_GUESTS && (held?.lately ?? 0) < GUESTS_A_MINUTE
}

/** Whether one more person may be waiting on this space. Both kinds count,
 *  because both are one line in the sheet's Waiting list: an account that
 *  followed a link which asks first, and a guest that did. */
async function roomToWait(env: Env, spaceId: string, item: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select (select count(*) from space_requests where space_id = ?1 and item = ?2)
          + (select count(*) from guest_members
              where space_id = ?1 and item = ?2
                and joined_at is null and declined_at is null) as waiting`,
  )
    .bind(spaceId, item)
    .first<{ waiting: number }>()

  return (held?.waiting ?? 0) < MOST_WAITING
}

/** What a link that asks first says when the owner has as many people waiting as
 *  the sheet can show them. */
function tooManyWaiting(context: Reply) {
  return context.json({ error: 'that many people are already waiting to be let in' }, 429)
}

/** Where one guest stands in one space: in it, waiting on the owner, told no, or
 *  nowhere near it. */
function guestStanding(env: Env, spaceId: string, guestId: string, item: string) {
  return env.DB.prepare(
    `select role, joined_at, declined_at from guest_members
      where space_id = ? and guest_id = ? and item = ?`,
  )
    .bind(spaceId, guestId, item)
    .first<{ role: Given; joined_at: number | null; declined_at: number | null }>()
}

/** A guest in a space, at a role, either in it or waiting to be. */
function writeGuestMember(
  env: Env,
  spaceId: string,
  guestId: string,
  role: Given,
  waiting: boolean,
  item: string,
): Promise<unknown> {
  // A guest arriving twice at once is one row, not a 500: what `guestStanding`
  // read a moment ago is not a lock on it.
  return env.DB.prepare(
    `insert into guest_members (space_id, guest_id, item, role, joined_at, created_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(space_id, guest_id, item) do nothing`,
  )
    .bind(spaceId, guestId, item, role, waiting ? null : now(), now())
    .run()
}

/** The owner is told that somebody is waiting, at the same rate anybody is told
 *  anything: it is the person receiving the mail who is protected, whoever
 *  caused the send. And at most once an hour about any one space, because what
 *  the owner needs to know is that somebody is at the door rather than how many
 *  times it was knocked on.
 *
 *  Nothing is said back about any of this. The person at the link is waiting on
 *  the owner either way, and whether a message went is not their business. */
async function tellTheOwner(context: Reply, found: Leads, who: string): Promise<void> {
  const env = context.env
  const space = found.space
  const owner = await ownerOf(env, space)
  if (!owner) return

  if (!(await mayTellTheOwner(env, space.id))) return
  if (!(await mayMail(env, owner.email, machineOf(context.req))).ok) return

  // What was knocked on, which is what the owner has to go and look at: the note
  // where the link was about one, and the space where it was about the space.
  const named = found.path === null ? space.name : itemName(found.path)
  const message = requestMessage({ space: named, who, link: env.APP_ORIGIN })

  // Still nothing said back - but a send that failed gives up the gap it took, so
  // the next person at the door is one the owner can actually be told about. The
  // request itself is written either way, and the sheet is where it is answered.
  if (!(await mailer(env).send(owner.email, message.subject, message))) {
    await forgetMailed(env, owner.email)
  }
}

export const join = new Hono<{ Bindings: Env; Variables: Variables }>()

join.get('/:token', async (context) => {
  const found = await tokenLeadsTo(context.env, context.req.param('token'))
  if (!found) return context.json({ error: EXPIRED }, 404)

  const owner = await ownerOf(context.env, found.space)

  return context.json({
    kind: found.kind,
    space: found.space.name,
    /** The one file the link is about, by name, or null for the space. What the
     *  page says somebody was sent: "Emil shared Plans" is a space and "Emil
     *  shared the meeting" is a note, and the sentence is the same either way. */
    note: found.path === null ? null : itemName(found.path),
    role: found.role,
    // Which address the invitation was written to, so a page can say who it is
    // for. An open link is for whoever has it and names none.
    email: found.kind === 'invite' ? found.email : null,
    asks: found.kind === 'link' && found.mode === 'approval',
    from: owner ? personName(owner) : null,
  })
})

join.post('/:token', async (context) => {
  const who = await requireWhoever(context.env, context.req.header('authorization'))
  const found = await tokenLeadsTo(context.env, context.req.param('token'))
  if (!found) return context.json({ error: EXPIRED }, 404)

  // An invitation is proof of an address, so it opens that account whoever is
  // holding the tab. An account already signed in as somebody else is the one
  // case it is not: that is answered below, where the address is checked.
  if (found.kind === 'invite' && who?.kind !== 'user') {
    return await redeemInvitation(context, found, who?.guest ?? null)
  }

  if (who?.kind === 'user') return await asAnAccount(context, found, who.user)
  if (who?.kind === 'guest') return await asAGuest(context, found, who.guest)

  return await asNobody(context, found)
})

/** The mailed link, opening the account it was written to. The whole of what
 *  somebody with no Nib account does: they press the link. */
async function redeemInvitation(context: Reply, found: Leads, guest: Guest | null) {
  if (found.kind !== 'invite') return context.json({ error: EXPIRED }, 404)

  const user = await accountFor(context.env, found.email, context.req.header('accept-language'))

  // Whatever this device held as a guest, and whatever any guest said it was at
  // this address, is the account's now: proving the address is what that turns on.
  if (guest) await claimGuest(context.env, guest.id, user)
  await claimWhatWasGuested(context.env, user, null)

  // An account that asks for a second code is not signed in by a mail any more
  // than by the emailed code: the link proved the address, which is half, and the
  // app finishes it the way it finishes a sign-in - `/v1/auth/second` with this.
  // The invitation is left standing, so that the account walks through it once it
  // is signed in, the way an account already signed in does. See auth.ts.
  if (await asksForSecond(context.env, user.id)) {
    return context.json({ second: true, holding: await halfWay(context.env, user) })
  }

  const role = await memberNow(context.env, found, user.email, found.role)
  if (!role) return spaceIsFull(context)
  await spendInvitation(context.env, found.hash)

  return context.json({
    token: await openSession(context.env, user.id),
    user: presentUser(user),
    ...landedOn(context.env, found, role, await ownerOf(context.env, found.space)),
  })
}

/** Somebody with an account, walking through a link. The address behind the
 *  session is proved, so an invitation written to it is theirs and one written to
 *  somebody else is not. */
async function asAnAccount(context: Reply, found: Leads, user: User) {
  const { space, item } = found
  const owner = () => ownerOf(context.env, space)

  if (space.user_id === user.id) {
    return context.json(
      landedOn(context.env, found, 'owner', { name: user.name, email: user.email }),
    )
  }

  if (found.kind === 'invite') {
    if (found.email !== user.email) {
      return context.json({ error: 'that invitation was sent to another address' }, 403)
    }

    const role = await memberNow(context.env, found, user.email, found.role)
    if (!role) return spaceIsFull(context)

    await spendInvitation(context.env, found.hash)
    return context.json(landedOn(context.env, found, role, await owner()))
  }

  if (found.mode === 'approval') {
    const already = await context.env.DB.prepare(
      'select role from space_members where space_id = ? and email = ? and item = ?',
    )
      .bind(space.id, user.email, item)
      .first<{ role: Given }>()

    if (already) {
      return context.json(landedOn(context.env, found, already.role, await owner()))
    }

    if (!(await roomToWait(context.env, space.id, item))) return tooManyWaiting(context)

    await context.env.DB.prepare(
      `insert into space_requests (space_id, email, item, role, created_at)
       values (?1, ?2, ?3, ?4, ?5)
       on conflict(space_id, email, item) do nothing`,
    )
      .bind(space.id, user.email, item, found.role, now())
      .run()

    await tellTheOwner(context, found, personName(user))
    return context.json({ waiting: true })
  }

  const role = await memberNow(context.env, found, user.email, found.role)
  if (!role) return spaceIsFull(context)

  return context.json(landedOn(context.env, found, role, await owner()))
}

/** A guest at a link. Either they are asking again about the space they are
 *  waiting on, which is the same question as walking through it, or this is a
 *  second link and a second space for the same guest. */
async function asAGuest(context: Reply, found: Leads, guest: Guest) {
  const { space, item } = found
  const standing = await guestStanding(context.env, space.id, guest.id, item)
  const said = presentGuest(guest)

  if (standing?.joined_at) {
    return context.json({
      guest: said,
      ...landedOn(context.env, found, standing.role, await ownerOf(context.env, space)),
    })
  }

  if (standing?.declined_at) return context.json({ guest: said, declined: true })
  if (standing) return context.json({ guest: said, waiting: true })

  if (!(await roomForAGuest(context.env, space.id, item))) {
    return context.json({ error: 'that link is busy, try again in a minute' }, 429)
  }

  const asks = found.kind === 'link' && found.mode === 'approval'
  if (asks && !(await roomToWait(context.env, space.id, item))) return tooManyWaiting(context)

  await writeGuestMember(context.env, space.id, guest.id, found.role, asks, item)

  if (asks) {
    await tellTheOwner(context, found, guest.name)
    return context.json({ guest: said, waiting: true })
  }

  return context.json({
    guest: said,
    ...landedOn(context.env, found, found.role, await ownerOf(context.env, space)),
  })
}

/** Nobody at all, at a link the space itself holds. This is where a guest comes
 *  from: one session, one name, one space. */
async function asNobody(context: Reply, found: Leads) {
  if (found.kind !== 'link') return context.json({ error: EXPIRED }, 404)
  const { space, item } = found

  if (!(await roomForAGuest(context.env, space.id, item))) {
    return context.json({ error: 'that link is busy, try again in a minute' }, 429)
  }

  const body = await readBody(context)
  // A body is optional here: an open link asks for nothing at all, so what
  // arrived is complained about where it matters rather than at the door.
  const device = body.text('device', DEVICE_LIMIT)
  const said = body.text('name', NAME_LIMIT * 8)
  const address = body.text('email', EMAIL_LIMIT)

  if (found.mode === 'open') {
    const { guest, token } = await newGuest(context.env, device ?? null, null, null)
    await writeGuestMember(context.env, space.id, guest.id, found.role, false, item)

    return context.json({
      token,
      guest: presentGuest(guest),
      ...landedOn(context.env, found, found.role, await ownerOf(context.env, space)),
    })
  }

  if (body.problem) return context.json({ error: body.problem }, 400)

  // One field, and either half of it will do: the owner has to have something
  // to accept, and a name is as much as a link that asks first can ask for.
  const named = cleanPersonName(said ?? '').slice(0, NAME_LIMIT)
  const gave = normaliseEmail(address ?? '')
  if (!named && !isEmail(gave)) return context.json({ error: 'say who you are' }, 400)

  if (!(await roomToWait(context.env, space.id, item))) return tooManyWaiting(context)

  const { guest, token } = await newGuest(
    context.env,
    device ?? null,
    named || gave,
    isEmail(gave) ? gave : null,
  )
  await writeGuestMember(context.env, space.id, guest.id, found.role, true, item)
  await tellTheOwner(context, found, guest.name)

  return context.json({ token, guest: presentGuest(guest), waiting: true })
}
