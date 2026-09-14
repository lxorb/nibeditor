/** A guest: somebody a share link let in, with no account.
 *
 *  An invitation is written to an address, so proving the address is the right
 *  check and the emailed code is how it is proved. A link anybody may follow
 *  names nobody, so there is nothing to prove and asking for an address anyway
 *  is a sign-up wearing a different hat. Possession of the link is the check,
 *  which is what a link always was, and what it hands out is one of these.
 *
 *  A guest is not a small account. It has a session and a name and that is all:
 *  no storage of its own, no settings, no connector, nothing to publish, and no
 *  say over who else is in a space. It reaches exactly the spaces its links
 *  granted, at the role each link offered, and `guestMayReach` below is the
 *  whole of what it may ask for.
 *
 *  It can also stop being one. Signing in on the same device hands the account
 *  whatever the guest was in, and so does proving the address a guest said it
 *  was at; see `claimGuest`. */

import { cleanPersonName, NAME_LIMIT, newId, now, randomToken, sha256 } from './crypto'
import type { Env, Guest, User } from './types'

/** How long a guest session lasts. The same as an account's: a guest bound to a
 *  device is that device's way in, and one that expired sooner would be a reader
 *  sent back to a link they no longer have. */
const GUEST_TTL = 90 * 24 * 60 * 60 * 1000

/** Long enough for any platform name and nothing else. */
const DEVICE_LIMIT = 24

/** The second half of a name a device is given. Proper nouns, so none of them is
 *  translated, for the same reason the platform names in the app's rooms/who.ts
 *  are not: what they are for is telling two carets apart, and a word that
 *  changed with the reader's language would not.
 *
 *  Short, so "Windows wren" fits over a caret. */
const WORDS = [
  'fox',
  'wren',
  'moth',
  'hare',
  'lark',
  'newt',
  'owl',
  'elk',
  'ibis',
  'crane',
  'vole',
  'seal',
  'stoat',
  'tern',
  'pike',
  'finch',
]

/** What a device may call itself: a word or two of letters and digits. Anything
 *  else is dropped rather than cleaned, because a device name that needs
 *  cleaning was not sent by the app. */
function device(given: string | null): string | null {
  const said = (given ?? '').replace(/\s+/g, ' ').trim()
  if (!said || said.length > DEVICE_LIMIT) return null

  return /^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(said) ? said : null
}

/** A name for somebody who has not given one: the platform they are on and a
 *  short word, which is the same answer the carets already give for a device.
 *  "Emil's iPad" is not knowable from here and never will be; "iPhone wren" is,
 *  and it tells two guests apart, which is the whole job. */
function guestName(hint: string | null): string {
  const platform = device(hint) ?? 'Guest'
  const word = WORDS[Math.floor(Math.random() * WORDS.length)] ?? WORDS[0] ?? ''

  return `${platform} ${word}`
}

/** A guest and a session for it, in one go. `hint` is what the device calls
 *  itself and `named` is what somebody typed into a link that asks first;
 *  either may be nothing. */
export async function newGuest(
  env: Env,
  hint: string | null,
  named: string | null,
  email: string | null,
): Promise<{ guest: Guest; token: string }> {
  const chosen = cleanPersonName(named ?? '').slice(0, NAME_LIMIT)
  const guest: Guest = {
    id: newId(),
    name: chosen || guestName(hint),
    email,
    created_at: now(),
  }

  await env.DB.prepare('insert into guests (id, name, email, created_at) values (?, ?, ?, ?)')
    .bind(guest.id, guest.name, guest.email, guest.created_at)
    .run()

  return { guest, token: await openGuestSession(env, guest.id) }
}

/** A session token for a guest. Sessions that ran out are cleared as new ones
 *  arrive, the way an account's are: nothing else would ever take them away. */
async function openGuestSession(env: Env, guestId: string): Promise<string> {
  await env.DB.prepare('delete from guest_sessions where expires_at < ?').bind(now()).run()

  const token = randomToken()
  await env.DB.prepare(
    'insert into guest_sessions (token_hash, guest_id, created_at, expires_at) values (?, ?, ?, ?)',
  )
    .bind(await sha256(token), guestId, now(), now() + GUEST_TTL)
    .run()

  return token
}

/** The guest a token belongs to, or nothing. */
export async function guestForToken(env: Env, token: string): Promise<Guest | null> {
  const row = await env.DB.prepare(
    `select g.id, g.name, g.email, g.created_at
       from guest_sessions s join guests g on g.id = s.guest_id
      where s.token_hash = ? and s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<Guest>()

  return row ?? null
}

export async function renameGuest(env: Env, guestId: string, name: string): Promise<void> {
  await env.DB.prepare('update guests set name = ? where id = ?').bind(name, guestId).run()
}

/** A guest as the app reads it. Never the session, and never the address it
 *  said it was at: nobody proved that, so nothing shows it back as a fact. */
export function presentGuest(guest: Guest) {
  return { id: guest.id, name: guest.name }
}

/* ── What a guest may ask for ─────────────────────────────────────────── */

/** The whole of it, written as what is allowed rather than what is refused: a
 *  route added tomorrow is closed to a guest until somebody says otherwise,
 *  which is the right way round for a credential anybody who has a link holds.
 *
 *  What is left out is everything account-wide. The settings and the storage
 *  belong to an account and a guest has neither; the connector, publishing and
 *  Recently deleted are the owner's; and sharing is a space being given away,
 *  which is nobody's to do with a link they were handed. Images already answer
 *  to anybody who asks by hash, outside all of this, so a guest reading a note
 *  sees its pictures without being able to add one. */
const OPEN_TO_GUESTS: readonly { method: string; path: RegExp }[] = [
  // Who they are, and the one thing they can change about it.
  { method: 'GET', path: /^\/v1\/me$/ },
  { method: 'PATCH', path: /^\/v1\/me$/ },
  // The spaces their links granted, and what is inside them.
  { method: 'GET', path: /^\/v1\/spaces$/ },
  // And the files a link granted on their own, which are in no space a guest can
  // reach: one note out of somebody's drawer, listed at the foot of the switcher
  // and handed back from the same row. See spaces/share.ts.
  { method: 'GET', path: /^\/v1\/shared$/ },
  { method: 'DELETE', path: /^\/v1\/shared\/[^/]+$/ },
  { method: 'GET', path: /^\/v1\/spaces\/[^/]+\/changes$/ },
  { method: 'POST', path: /^\/v1\/spaces\/[^/]+\/notes$/ },
  // What a space says about its own tree, which a guest who may write may say too:
  // somebody who can move a note into a folder can drag it above its neighbour, and
  // a link that let them do the first and not the second would read as a fault.
  // Every one of these is still behind its own `atLeast('write')`.
  {
    method: 'PUT',
    path: /^\/v1\/spaces\/[^/]+\/(bookmarks|icons|arranged|files|graph|excluded)$/,
  },
  { method: 'GET', path: /^\/v1\/notes\/[^/]+$/ },
  { method: 'PUT', path: /^\/v1\/notes\/[^/]+$/ },
  { method: 'DELETE', path: /^\/v1\/notes\/[^/]+$/ },
  // Deliberately not the versions a note has on the account, nor putting a space
  // back to a moment. The history is the account's record of its own notes, and a
  // guest has no account; a rollback is the whole space at once, which is not
  // something to do with a link somebody was handed. Both are reachable code for
  // a guest - `reachedNote` answers about one - so this is the door, and it says
  // so here rather than nowhere.
  // Letting themselves out, which is the one thing under `share` that is not
  // the owner's: being in a space is something a person can stop.
  { method: 'DELETE', path: /^\/v1\/spaces\/[^/]+\/share\/me$/ },
]

export function guestMayReach(method: string, path: string): boolean {
  return OPEN_TO_GUESTS.some((one) => one.method === method && one.path.test(path))
}

/* ── Becoming an account ──────────────────────────────────────────────── */

/** Everything one guest was in becomes the account's, and the guest is gone.
 *
 *  Two things ask for this, and they are the two ways a guest turns out to be
 *  somebody: the device signing in, which the app says by handing its guest
 *  token to the sign-in, and an address being proved that a guest had said it
 *  was at. Both end here.
 *
 *  Only what they were actually in moves. A request the owner has not answered
 *  stays with the guest, because a membership is what there is to take over and
 *  a `space_members` row has no way to say "still waiting" - writing one would
 *  turn an unanswered request into a way in. */
export async function claimGuest(env: Env, guestId: string, user: User): Promise<void> {
  const { results } = await env.DB.prepare(
    `select space_id, item, role from guest_members
      where guest_id = ? and joined_at is not null limit 200`,
  )
    .bind(guestId)
    .all<{ space_id: string; item: string; role: string }>()

  for (const held of results) {
    // Whatever the account already had in that space stands: a role the owner
    // gave the person by address is the one they meant, and a link is how they
    // arrived rather than what they are. One row apiece, whichever size of share
    // it was: a link to one note becomes a membership about that note.
    await env.DB.prepare(
      `insert into space_members (space_id, email, item, role, joined_at, created_at)
       values (?1, ?2, ?3, ?4, ?5, ?5)
       on conflict(space_id, email, item)
         do update set joined_at = coalesce(space_members.joined_at, ?5)`,
    )
      .bind(held.space_id, user.email, held.item, held.role, now())
      .run()

    await env.DB.prepare(
      'delete from guest_members where guest_id = ? and space_id = ? and item = ?',
    )
      .bind(guestId, held.space_id, held.item)
      .run()
  }

  // Nothing of theirs is left to reach, so neither is the guest. Its sessions
  // go with it, which is what ends the way in the device still holds.
  await forgetEmptyGuest(env, guestId)
}

/** Every guest that said it was at this address, handed to the account that has
 *  just proved it. What the owner accepted was the person that request named,
 *  and this is that person turning up. */
export async function claimGuestsAt(env: Env, user: User): Promise<void> {
  const { results } = await env.DB.prepare('select id from guests where email = ? limit 50')
    .bind(user.email)
    .all<{ id: string }>()

  for (const one of results) await claimGuest(env, one.id, user)
}

/** A guest with nothing left to reach and no request outstanding is nobody, so
 *  the row goes and its sessions with it. Called where a membership ends: by the
 *  owner taking one out, and by a guest becoming an account. */
export async function forgetEmptyGuest(env: Env, guestId: string): Promise<void> {
  await env.DB.prepare(
    'delete from guests where id = ? and not exists (select 1 from guest_members where guest_id = ?)',
  )
    .bind(guestId, guestId)
    .run()
}

/** How long somebody a link never let in is kept waiting. */
const WAITED_FOR = 30 * 24 * 60 * 60 * 1000

/** Guests nobody let in, let go. Part of the nightly job, beside Recently
 *  deleted; nothing else would ever take these away.
 *
 *  Two shapes of abandoned, and they are the same row. A request the owner never
 *  answered and one they said no to both have no `joined_at`, and after a month
 *  neither is news to anyone: the person went elsewhere, and the space is left
 *  carrying a row that its ceiling counts. Then the guest itself, once nothing of
 *  theirs is left to reach - which is the same thing `forgetEmptyGuest` says
 *  after one membership ends, said here about the ones that ended some other way.
 *  Its sessions go with it, by the schema.
 *
 *  A guest who is in a space is not abandoned however long ago they arrived: the
 *  space is their way in and the owner is the one who ends it. */
export async function expireGuests(env: Env, at: number): Promise<number> {
  const cutoff = at - WAITED_FOR

  const waiting = await env.DB.prepare(
    'delete from guest_members where joined_at is null and created_at < ?',
  )
    .bind(cutoff)
    .run()

  const nobody = await env.DB.prepare(
    `delete from guests
      where created_at < ?
        and not exists (select 1 from guest_members where guest_id = guests.id)`,
  )
    .bind(cutoff)
    .run()

  return waiting.meta.changes + nobody.meta.changes
}
