import { Hono } from 'hono'
import { NOT_AN_EMAIL, TOOK_TOO_LONG, WRONG_CODE } from './refused'
import { readBody } from './body'
import {
  equals,
  isEmail,
  newId,
  normaliseEmail,
  now,
  randomCode,
  randomToken,
  sha256,
} from './crypto'
import { codeMessage, mailer } from './email'
import { claimGuest, claimGuestsAt, guestForToken } from './guests'
import { machineOf, mailCeilings } from './limits'
import { accepted, asksForSecond, halfWay, spendHalf, whoseHalf } from './second'
import { roomsSignedOut } from './rooms'
import { makeFirstSpace } from './spaces/first'
import { deviceIn } from './versions'
import type { Env, User, Variables, Whoever } from './types'

const CODE_TTL = 10 * 60 * 1000
const RESEND_GAP = 30 * 1000
const MAX_ATTEMPTS = 5
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000

async function userForToken(env: Env, token: string): Promise<User | null> {
  const hash = await sha256(token)

  const row = await env.DB.prepare(
    `select u.id, u.email, u.name, u.created_at, s.last_used_at as seen
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = ? and s.expires_at > ?`,
  )
    .bind(hash, now())
    .first<User & { seen: number | null }>()

  if (!row) return null

  // When a session was last seen, so the list of them can say. Written at most
  // once an hour per session rather than on every request: what the reader wants
  // to know is "today" or "in March", and a write per request would be a write
  // per keystroke of somebody else's typing.
  if (!row.seen || now() - row.seen > SEEN_EVERY) {
    await env.DB.prepare('update sessions set last_used_at = ? where token_hash = ?')
      .bind(now(), hash)
      .run()
  }

  return { id: row.id, email: row.email, name: row.name, created_at: row.created_at }
}

/** How often a session's own row learns that it is still in use. */
const SEEN_EVERY = 60 * 60 * 1000

/** The token an `Authorization` header carries, or nothing. The scheme is read
 *  without regard to case, as RFC 7235 says it is written: a client that sends
 *  `bearer` is holding a good session and was being answered 401. */
export function tokenIn(header: string | undefined): string | null {
  const token = /^bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim()
  return token ?? null
}

/** Whoever the request is from: the account whose session it carries, or the
 *  guest a link handed one to. One lookup each, in that order, because an
 *  account's is much the commoner case and either answer is one round trip.
 *
 *  Nothing else answers this question: a route that wants a session gets one of
 *  the two kinds there are and says which it can work with. */
export async function requireWhoever(
  env: Env,
  header: string | undefined,
): Promise<Whoever | null> {
  const token = tokenIn(header)
  if (!token) return null

  const user = await userForToken(env, token)
  if (user) return { kind: 'user', user }

  const guest = await guestForToken(env, token)
  return guest ? { kind: 'guest', guest } : null
}

/** The account one row names, for a caller that has the id and not the session.
 *
 *  Which is a program acting for somebody: its token says whose account it is
 *  and nothing about a session, and the routes it reaches read `user` like any
 *  other. See programs.ts for which those are. */
export function accountById(env: Env, id: string): Promise<User | null> {
  return env.DB.prepare('select id, email, name, created_at from users where id = ?')
    .bind(id)
    .first<User>()
}

/** A session for an account, and the row behind it. Sessions that ran out are
 *  cleared as new ones arrive: nothing else would ever take them away, and a
 *  row nobody can use is only a row. */
export async function openSession(env: Env, userId: string, device = ''): Promise<string> {
  await env.DB.prepare('delete from sessions where expires_at < ?').bind(now()).run()

  const token = randomToken()
  await env.DB.prepare(
    `insert into sessions (token_hash, user_id, created_at, expires_at, id, name, last_used_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(await sha256(token), userId, now(), now() + SESSION_TTL, newId(), device, now())
    .run()

  return token
}

/** The account at an address, made on the spot for one seen for the first time:
 *  signing in and signing up are the same thing, and so is walking through an
 *  invitation written to an address nobody has ever used.
 *
 *  `accepted` is the request's `Accept-Language`, which is the only thing the
 *  service ever learns about what language somebody reads. It is what the first
 *  note is written in, and that note is written once, so the header has to
 *  arrive here rather than be asked for later. */
export async function accountFor(
  env: Env,
  address: string,
  accepted: string | undefined,
): Promise<User> {
  const held = await env.DB.prepare('select id, email, name, created_at from users where email = ?')
    .bind(address)
    .first<User>()

  if (held) return held

  const user: User = { id: newId(), email: address, name: null, created_at: now() }

  // Two devices signing in at once with an address nobody has used yet both read
  // nothing above, and the second insert was `UNIQUE constraint failed` coming
  // back as a 500 on somebody's very first sign-in. The address is the account,
  // so the second insert is not a mistake to report; it is the same account,
  // already made.
  const wrote = await env.DB.prepare(
    'insert into users (id, email, created_at) values (?, ?, ?) on conflict(email) do nothing',
  )
    .bind(user.id, user.email, user.created_at)
    .run()

  // Whichever request wrote the row, this is the account: the id to carry on with
  // is the one in the table and not necessarily the one made above.
  const account =
    (await env.DB.prepare('select id, email, name, created_at from users where email = ?')
      .bind(address)
      .first<User>()) ?? user

  // And the request whose insert actually wrote the row is the one that seeds.
  // `changes` is zero for the one that lost, which is what keeps two sign-ins
  // arriving together from giving one account two spaces called Notes: the guard
  // inside `makeFirstSpace` reads a row that the other request has not written
  // yet, so it is not one either of them can be held to.
  if (wrote.meta.changes > 0) {
    try {
      await makeFirstSpace(env, account.id, accepted)
    } catch {
      // An account is worth more than the note it opens with, so a store that
      // baulks here does not cost somebody their sign-in. Nothing tries again:
      // only an account being made is given a space, because a later sign-in
      // cannot tell an empty rail somebody meant from one that went wrong.
    }
  }

  return account
}

/** Whatever a guest on this device, or a guest at this address, was already in
 *  becomes the account's. Called wherever a session for an account begins, so
 *  that neither way of arriving loses what the person had.
 *
 *  `held` is the guest token the app hands over, which is how the device says
 *  "this was me". Failing to claim is not a failed sign-in: the account is what
 *  was asked for, and a space that did not follow is one the link opens again. */
export async function claimWhatWasGuested(
  env: Env,
  user: User,
  held: string | null,
): Promise<void> {
  const guest = held ? await guestForToken(env, held) : null
  if (guest) await claimGuest(env, guest.id, user)

  await claimGuestsAt(env, user)
}

/** Sends a sign-in code, or says how long until another may go. Always
 *  answers the same way for an address it has never seen, so it cannot be
 *  used to discover which addresses have accounts. The OAuth consent page
 *  signs people in with the same code as the app, which is why this is not
 *  written straight into the route.
 *
 *  `machine` is where the request came from, for the ceiling on how much mail
 *  one of them may cause; see limits.ts. */
export async function sendCode(
  env: Env,
  address: string,
  machine: string | null = null,
): Promise<{ ok: true; resendIn: number } | { error: string; status: 400 | 429 | 503 }> {
  if (!isEmail(address)) return { error: NOT_AN_EMAIL, status: 400 }

  const existing = await env.DB.prepare('select sent_at from login_codes where email = ?')
    .bind(address)
    .first<{ sent_at: number }>()

  if (existing && now() - existing.sent_at < RESEND_GAP) {
    return { ok: true, resendIn: Math.ceil((RESEND_GAP - (now() - existing.sent_at)) / 1000) }
  }

  // Asked here rather than at the top, so that the gap this address already
  // keeps holds a resend back without spending anything against the ceilings: a
  // message that is not going out is not mail.
  const ceiling = await mailCeilings(env, address, machine)
  if (ceiling) return { error: ceiling, status: 429 }

  const code = randomCode()
  const salt = randomToken()

  // Codes that ran out are cleared as new ones arrive, the way sessions are:
  // nothing else would ever take them away, and a row nobody can use is only a
  // row. One per address that ever started a sign-in and did not finish it adds
  // up, and the table is one anybody can write to.
  await env.DB.prepare('delete from login_codes where expires_at < ?').bind(now()).run()

  await env.DB.prepare(
    `insert into login_codes (email, code_hash, salt, expires_at, attempts, sent_at)
     values (?, ?, ?, ?, 0, ?)
     on conflict(email) do update set
       code_hash = excluded.code_hash,
       salt = excluded.salt,
       expires_at = excluded.expires_at,
       attempts = 0,
       sent_at = excluded.sent_at`,
  )
    .bind(address, await sha256(salt + code), salt, now() + CODE_TTL, now())
    .run()

  const message = codeMessage(code)

  if (!(await mailer(env).send(address, message.subject, message))) {
    // The code itself stands. The message may well have gone out and only its
    // answer been lost, and somebody holding a code that no longer works is
    // worse off than somebody who had to ask twice.
    //
    // What goes is the thirty second gap written a moment ago. It exists to keep
    // an address from being written to twice over; nothing was written to it, and
    // leaving the row would answer the next try with "already sent" and send
    // nothing - which is how one failed send became a sign-in that could not be
    // retried at all.
    await env.DB.prepare('update login_codes set sent_at = 0 where email = ?').bind(address).run()

    return { error: 'could not send the mail - try again', status: 503 }
  }

  return { ok: true, resendIn: RESEND_GAP / 1000 }
}

/** Checks a code and hands back the account, made on the spot for an address
 *  seen for the first time: signing in and signing up are the same thing. */
export async function verifyCode(
  env: Env,
  address: string,
  code: string,
  accepted: string | undefined,
): Promise<{ user: User } | { error: string; status: 400 | 429 }> {
  const entered = code.replace(/\D/g, '')

  if (!isEmail(address) || entered.length !== 6) {
    return { error: WRONG_CODE, status: 400 }
  }

  const pending = await env.DB.prepare(
    'select code_hash, salt, expires_at, attempts from login_codes where email = ?',
  )
    .bind(address)
    .first<{ code_hash: string; salt: string; expires_at: number; attempts: number }>()

  if (!pending || pending.expires_at < now()) {
    return { error: 'that code has expired - ask for a new one', status: 400 }
  }

  if (pending.attempts >= MAX_ATTEMPTS) {
    return { error: 'too many tries - ask for a new code', status: 429 }
  }

  if (!equals(await sha256(pending.salt + entered), pending.code_hash)) {
    await env.DB.prepare('update login_codes set attempts = attempts + 1 where email = ?')
      .bind(address)
      .run()
    return { error: WRONG_CODE, status: 400 }
  }

  await env.DB.prepare('delete from login_codes where email = ?').bind(address).run()

  return { user: await accountFor(env, address, accepted) }
}

export const auth = new Hono<{ Bindings: Env; Variables: Variables }>()

/** What an address and a code may be before either is looked at. The address
 *  is checked properly by `isEmail`; this is only the outer bound, so nothing
 *  absurd reaches a query or a mail. */
const EMAIL_LIMIT = 320
const CODE_LIMIT = 16
/** A session token, as the outer bound on the guest one a sign-in hands over. */
const TOKEN_LIMIT = 128

/** Step one. */
auth.post('/code', async (context) => {
  const body = await readBody(context)
  const email = body.text('email', EMAIL_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const sent = await sendCode(context.env, normaliseEmail(email ?? ''), machineOf(context.req))

  if ('error' in sent) {
    // A provider having a bad minute is worth trying again straight away, and
    // saying so is what keeps a client from treating it as a dead end. The
    // ceilings are the other kind of no and name their own wait in words.
    return sent.status === 503
      ? context.json({ error: sent.error }, 503, { 'retry-after': '5' })
      : context.json({ error: sent.error }, sent.status)
  }

  return context.json(sent)
})

/** Step two. */
auth.post('/verify', async (context) => {
  const body = await readBody(context)
  const email = body.text('email', EMAIL_LIMIT)
  const code = body.text('code', CODE_LIMIT)
  // What this device was as a guest, if it was one. Handed over so that the
  // spaces a link let it into follow it into the account.
  const held = body.text('guest', TOKEN_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const verified = await verifyCode(
    context.env,
    normaliseEmail(email ?? ''),
    code ?? '',
    context.req.header('accept-language'),
  )

  if ('error' in verified) return context.json({ error: verified.error }, verified.status)
  const { user } = verified

  await claimWhatWasGuested(context.env, user, held ?? null)

  // An account with a second factor is not signed in yet: what comes back is
  // half a sign-in, which the code out of an authenticator app finishes. The
  // guest's spaces are claimed above either way - proving the address is what
  // that turned on, and it has been proved. See second.ts.
  if (await asksForSecond(context.env, user.id)) {
    return context.json({ second: true, holding: await halfWay(context.env, user) })
  }

  return context.json({
    token: await openSession(context.env, user.id, deviceIn(context.req.header('x-nib-device'))),
    user: presentUser(user),
  })
})

/** The other half of a sign-in that asks for a second factor: the code out of
 *  the app, or one of the recovery codes.
 *
 *  Outside the session guard like the two steps before it, because there is no
 *  session yet - that is the whole point of standing here. */
auth.post('/second', async (context) => {
  const body = await readBody(context)
  const holding = body.text('holding', TOKEN_LIMIT)
  const code = body.text('code', 64)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const whose = holding ? await whoseHalf(context.env, holding) : null
  if (!whose) return context.json({ error: TOOK_TOO_LONG }, 400)

  if (!(await accepted(context.env, whose, code ?? '', machineOf(context.req)))) {
    return context.json({ error: WRONG_CODE }, 400)
  }

  const user = await accountById(context.env, whose)
  if (!user) return context.json({ error: WRONG_CODE }, 400)

  // The emailed half is spent now that the second one has worked, and not
  // before: a mistyped code is not a reason to ask for another mail. See
  // `whoseHalf`.
  await spendHalf(context.env, holding ?? '')

  return context.json({
    token: await openSession(context.env, user.id, deviceIn(context.req.header('x-nib-device'))),
    user: presentUser(user),
  })
})

/** The account as the app sees it: never the session, never the timestamps. */
export function presentUser(user: User) {
  return { id: user.id, email: user.email, name: user.name }
}

/** Every session this account has open, and the two ways to close one.
 *
 *  A session row used to say nothing but its own hash and when it expires, so
 *  nobody could answer "is anybody else signed in as me" and nothing could be
 *  done about it if they were. Which made a second factor half a feature: it
 *  stops somebody getting in and does nothing about somebody already inside.
 *
 *  Behind the session guard, so `sessions` is mounted from index.ts rather than
 *  here beside the sign-in. */
export const sessions = new Hono<{ Bindings: Env; Variables: Variables }>()

sessions.get('/', async (context) => {
  const user = context.get('user')
  const mine = await sha256(tokenIn(context.req.header('authorization')) ?? '')

  const { results } = await context.env.DB.prepare(
    `select id, name, created_at, last_used_at, token_hash from sessions
      where user_id = ? and expires_at > ? order by last_used_at desc, created_at desc`,
  )
    .bind(user.id, now())
    .all<{
      id: string | null
      name: string
      created_at: number
      last_used_at: number | null
      token_hash: string
    }>()

  return context.json({
    sessions: results.map((one) => ({
      id: one.id ?? '',
      name: one.name,
      createdAt: one.created_at,
      lastUsedAt: one.last_used_at,
      // Which row is the one asking, so the app can say "this device" and keep
      // its own row out of "end every other".
      current: equals(one.token_hash, mine),
    })),
  })
})

sessions.delete('/:id', async (context) => {
  const user = context.get('user')
  const gone = await context.env.DB.prepare('delete from sessions where user_id = ? and id = ?')
    .bind(user.id, context.req.param('id'))
    .run()

  // And whatever that device had open, which a deleted row does not reach: a socket
  // is not a request. See `roomsSignedOut`.
  if (gone.meta.changes) await roomsSignedOut(context.env, user.id)

  return context.json({ ok: !!gone.meta.changes })
})

/** Everything except the one asking. What somebody does when a laptop has gone
 *  missing: the sessions end, and every device that had one signs in again. */
sessions.delete('/', async (context) => {
  const user = context.get('user')
  const mine = tokenIn(context.req.header('authorization')) ?? ''

  const gone = await context.env.DB.prepare(
    'delete from sessions where user_id = ? and token_hash <> ?',
  )
    .bind(user.id, await sha256(mine))
    .run()

  // The rooms as well, which is the whole point of the row for a laptop that has
  // gone missing: its session is ended and its socket is closed. This device's own
  // rooms are closed with them and rejoin at once; see `roomsSignedOut`.
  if (gone.meta.changes) await roomsSignedOut(context.env, user.id)

  return context.json({ ended: gone.meta.changes })
})

auth.post('/signout', async (context) => {
  const token = tokenIn(context.req.header('authorization'))
  if (token) {
    const held = await context.env.DB.prepare('select user_id from sessions where token_hash = ?')
      .bind(await sha256(token))
      .first<{ user_id: string }>()

    await context.env.DB.prepare('delete from sessions where token_hash = ?')
      .bind(await sha256(token))
      .run()

    // A device signing itself out closes its own rooms rather than leaving them to
    // notice; see `roomsSignedOut`. The account is read before the row goes, because
    // this route carries a token and not a session.
    if (held) await roomsSignedOut(context.env, held.user_id)
  }
  return context.json({ ok: true })
})
