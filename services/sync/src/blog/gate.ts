/** A site behind a password.
 *
 *  What it is for: notes somebody wants a few named people to read and nobody
 *  else - a draft with a client, a handbook for a team, a wedding page. The
 *  alternative in the app is sharing, which is an account and a link per person;
 *  this is one word said out loud to a room.
 *
 *  What it is not: security for the notes themselves. One password everybody in
 *  a room knows is one password somebody forwards, so it keeps a site out of a
 *  search engine and out of a stranger's hands, and that is the whole of the
 *  claim. Anything that must not leave is not published.
 *
 *  How it is kept: hashed with PBKDF2 and a salt of its own, so the row is not a
 *  password. What a reader carries afterwards is a ticket signed with a key made
 *  when the password was set - not the password, and not a session anybody has to
 *  store - so taking the password off or setting a new one ends every ticket the
 *  old one handed out. */

import { equals, randomBytes } from '../crypto'
import { rounds } from '../rounds'
import { escape } from './head'
import type { SitePassword } from './site'

/** Long enough for a passphrase, short enough that the field is not a place to
 *  put a file. */
export const PASSWORD_LIMIT = 200

/** How long a ticket lasts. A month: long enough that a reader coming back to a
 *  handbook every week is asked once, short enough that a laptop left in a
 *  library does not hold a site open for ever. */
const LASTS = 30 * 24 * 60 * 60 * 1000

/** What the cookie is called. Named for what it is: the reader has been let in
 *  to one site, and a site is one hostname, so nothing about it travels. */
const TICKET = 'nib_site'

/** How hard the hash is to try. A hundred thousand rounds of PBKDF2 is what a
 *  Worker can do inside one request and what a password guesser cannot do a
 *  million times. The tests hash at less; see rounds.ts. */
export const SITE_ROUNDS = 100_000

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** The key a site's tickets are signed with. Its own, so that one site's ticket
 *  is not another's, and new every time a password is set. */
export function newSiteKey(): string {
  return hex(randomBytes(32))
}

async function derived(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', bytes(password), 'PBKDF2', false, ['deriveBits'])

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: rounds(SITE_ROUNDS) },
    key,
    256,
  )

  return hex(new Uint8Array(bits))
}

/** A password as it is kept: a salt and what the salt makes of it. */
export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = hex(randomBytes(16))
  return { salt, hash: await derived(password, salt) }
}

/** Whether what somebody typed is the password. Compared without leaking how
 *  far along the two strings first differ; see `equals` in crypto.ts. */
export async function matches(held: SitePassword, given: string): Promise<boolean> {
  if (!given || given.length > PASSWORD_LIMIT) return false
  return equals(await derived(given, held.salt), held.hash)
}

async function signature(key: string, until: number): Promise<string> {
  const signing = await crypto.subtle.importKey(
    'raw',
    bytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signed = await crypto.subtle.sign('HMAC', signing, bytes(String(until)))
  return hex(new Uint8Array(signed))
}

/** The ticket a reader who typed the password carries: when it runs out, and a
 *  signature over that. Nothing else - there is nobody to name. */
export async function newTicket(held: SitePassword, at: number): Promise<string> {
  const until = at + LASTS
  return `${until}.${await signature(held.key, until)}`
}

/** Whether a ticket is this site's, and still good. */
export async function ticketHolds(
  held: SitePassword,
  ticket: string | null,
  at: number,
): Promise<boolean> {
  if (!ticket) return false

  const [said, signed] = ticket.split('.')
  const until = Number(said)
  if (!signed || !Number.isFinite(until) || until <= at) return false

  return equals(await signature(held.key, until), signed)
}

/** The cookie as it is set: for this hostname only, unreadable to script,
 *  not sent along on somebody else's request. */
export function ticketCookie(ticket: string): string {
  const seconds = Math.floor(LASTS / 1000)
  return `${TICKET}=${ticket}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`
}

/** The ticket a request carries, if it carries one. */
export function ticketIn(header: string | null): string | null {
  if (!header) return null

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === TICKET) return rest.join('=') || null
  }

  return null
}

/** The form, which is the whole page a reader who has not been let in sees.
 *
 *  The site's name and one field. No explanation of what is behind it, because
 *  whoever sent the address said that, and no hint about the password, because a
 *  hint is half the password. `autofocus` so the caret is already where the only
 *  thing to do is done. */
export function gateBody(site: string, path: string, wrong: boolean): string {
  return `<h1>${escape(site)}</h1>
<form class="gate" method="post" action="${escape(path)}">
<input type="password" name="password" autocomplete="current-password" aria-label="Password" placeholder="Password" autofocus>
<button type="submit">Read</button>
${wrong ? '<p class="wrong">That is not the password.</p>' : ''}
</form>`
}
