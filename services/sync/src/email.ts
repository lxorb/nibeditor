import type { Context } from 'hono'
import { now } from './crypto'
import { note } from './failed'
import { mailCeilings, mailNotSent, type MailRefusal } from './limits'
import type { EmailSender, Env } from './types'

/** How long an address waits between two messages about sharing. The same gap
 *  the sign-in code keeps, and kept per address for the same reason: it is the
 *  person receiving it who is being protected, whoever asked for the send. */
const MAIL_GAP = 30 * 1000

/** Whether a message may go, and why not when it may not. A refusal is meant
 *  to be answered; null with `ok` false is the gap below, or a ceiling on the
 *  address, which keep their silence on purpose. */
export interface Mailable {
  ok: boolean
  refusal: MailRefusal | null
}

/** Whether this address may be written to now, marking it as written to when it
 *  may. One call rather than a question and an answer, so nothing can ask, be
 *  told no, and send anyway.
 *
 *  For a message somebody causes to somebody else: an invitation, an owner told
 *  that somebody is waiting. The gap this one address keeps is asked first, so a
 *  message held back by it costs nothing against any ceiling. Then the ceilings
 *  in limits.ts, where the ones about the service and the asker have something to
 *  say and the ones about the address have not - for the gap's reason: a sentence
 *  would tell whoever asked that somebody else had been writing to that address. */
export async function mayMail(
  env: Env,
  address: string,
  machine: string | null,
): Promise<Mailable> {
  const last = await env.DB.prepare('select sent_at from mailed where email = ?')
    .bind(address)
    .first<{ sent_at: number }>()

  if (last && now() - last.sent_at < MAIL_GAP) return { ok: false, refusal: null }

  const refusal = await mailCeilings(env, address, machine)
  if (refusal) return { ok: false, refusal: refusal.aboutTheAddress ? null : refusal }

  // Rows past the gap say nothing any more, so they go as new ones arrive - the
  // way the sessions and the sign-in codes are cleared. One row per address ever
  // written to would otherwise be kept for ever to answer a question about the
  // last thirty seconds.
  await env.DB.prepare('delete from mailed where sent_at < ?')
    .bind(now() - MAIL_GAP)
    .run()

  await env.DB.prepare(
    `insert into mailed (email, sent_at) values (?, ?)
     on conflict(email) do update set sent_at = excluded.sent_at`,
  )
    .bind(address, now())
    .run()

  return { ok: true, refusal: null }
}

/** Takes back what `mayMail` wrote, for a message that then did not go.
 *
 *  The row is there so one address is not written to twice in half a minute. A
 *  message that never left the building wrote to nobody, and a row left behind
 *  for it would answer the next try with the gap's silent no - so whoever asked
 *  would press the button again, be told nothing, and still receive nothing. The
 *  ceilings give back what they counted, for the same reason. */
export async function forgetMailed(env: Env, address: string): Promise<void> {
  await env.DB.prepare('delete from mailed where email = ?').bind(address).run()
  await mailNotSent(env, address)
}

/** A refusal as the service answers it: the sentence, the status, and when to
 *  come back where that is known. */
export function refusedMail(
  context: Context,
  refusal: { error: string; status: 400 | 429 | 503; retryAfter: number | null },
): Response {
  return context.json(
    { error: refusal.error },
    refusal.status,
    refusal.retryAfter ? { 'retry-after': String(refusal.retryAfter) } : {},
  )
}

export interface Mailer {
  /** Whether the message went.
   *
   *  A boolean rather than a throw, because a provider refusing an address,
   *  timing out or having a bad minute is not a fault in this service and is not
   *  something for a route to fall over on. Every caller here has already
   *  written the row the message is about - a code, an invitation - and the
   *  person in front of it needs a sentence and a button, not a 500. The
   *  provider's own words go to the log; see failed.ts. */
  send(to: string, subject: string, body: { text: string; html: string }): Promise<boolean>
}

/** Without the binding - local dev and tests - codes go to the log. */
function logging(): Mailer {
  return {
    send(to, subject, body) {
      // The log is the mailbox here; without it there is no way to sign in
      // locally, and the tests read the code back out of it.
      // eslint-disable-next-line no-console -- the log stands in for the mail
      console.log(`[mail] ${to} - ${subject}\n${body.text}`)
      return Promise.resolve(true)
    },
  }
}

/** Cloudflare Email Sending. No API key: the binding is the credential, and
 *  SPF, DKIM and DMARC come from the sending domain.
 *
 *  That domain has to be onboarded to Email Sending (Email Service > Email
 *  Sending in the dashboard), and the account has to be on Workers Paid. Without
 *  both, the same binding still works - as Email Routing's, which reaches only
 *  the account's own verified addresses. Every sign-in from the owner then goes
 *  through and every other one fails with "destination address is not a
 *  verified address", which is how this looked fixed for months. */
function cloudflare(binding: EmailSender, from: string): Mailer {
  const named = sender(from)

  return {
    async send(to, subject, body) {
      try {
        await binding.send({ from: named, to, subject, text: body.text, html: body.html })
        return true
      } catch (error) {
        // The one call in a sign-in that leaves the building, and the only thing
        // in it that no amount of care here can keep from failing. Written down
        // with the provider's own words and code, and answered no.
        note('mail', error, null)
        return false
      }
    },
  }
}

/** `MAIL_FROM` as the binding takes it. The variable is written the way a
 *  person writes a sender, `Nib <nib@nibeditor.com>`, and Email Sending wants
 *  the name and the address apart: handed the whole line as a string, it is
 *  asked to send from an address that has a space and two brackets in it. */
export function sender(from: string): string | { name: string; email: string } {
  const parts = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(from.trim())
  if (!parts) return from.trim()

  const name = (parts[1] ?? '').trim().replace(/^"(.*)"$/, '$1')
  const email = parts[2] ?? ''
  return name ? { name, email } : email
}

export function mailer(env: Env): Mailer {
  if (!env.EMAIL || !env.MAIL_FROM) return logging()
  return cloudflare(env.EMAIL, env.MAIL_FROM)
}

/** A code in a message: what it is for, the six digits, and what to do about one
 *  nobody asked for. */
function codeMail(code: string, subject: string, what: string, unasked: string) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`

  return {
    subject,
    text: `${what} is ${spaced}. It expires in 10 minutes.\n\n${unasked}`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;color:#1a1d23">
  <p>${what}:</p>
  <p style="font-family:ui-monospace,monospace;font-size:30px;letter-spacing:.18em;font-weight:600">${spaced}</p>
  <p style="color:#8a93a2">It expires in 10 minutes. ${unasked}</p>
</div>`,
  }
}

export function codeMessage(code: string) {
  return codeMail(
    code,
    `${code} is your Nib code`,
    'Your sign-in code',
    'If you did not ask for it, ignore this message.',
  )
}

/** The code that deletes an account. Its own words, because it is the one code
 *  somebody holding a session asks for about the account itself: one nobody at
 *  this address asked for means a session is in somebody else's hands, and that is
 *  worth more than "ignore this". */
export function leavingMessage(code: string) {
  return codeMail(
    code,
    `${code} deletes your Nib account`,
    'Your code to delete your Nib account',
    'If you did not ask for it, somebody is signed in as you: end every other session in Settings, Account.',
  )
}

/** The receipt for a deleted account: that it happened, what it did not touch, and
 *  what to do if it was not the person reading it. */
export function goneMessage() {
  const said = 'Your Nib account and everything it synced have been deleted.'
  const stays = 'The notes on your devices are still there.'
  const unasked = 'If you did not do this, somebody had your mailbox: secure it first.'

  return {
    subject: 'Your Nib account has been deleted',
    text: `${said} ${stays}\n\n${unasked}`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;color:#1a1d23">
  <p>${said} ${stays}</p>
  <p style="color:#8a93a2">${unasked}</p>
</div>`,
  }
}

/** A subject is one line. Everything put into one below comes from a person - a
 *  space's name, a name somebody chose - and a line break in one of those is not
 *  part of a name; it is a second header. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Everything put into the messages below comes from a person: a space's name,
 *  an address, a name somebody chose. None of it may become markup. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The house style for a message that is not a code: a sentence or two, the one
 *  thing to do, and nothing else. Written once so that everything sharing sends
 *  looks like the same app wrote it. */
function letter(lines: readonly string[], action: { label: string; href: string }) {
  const paragraphs = lines
    .map((line) => `  <p style="margin:0 0 14px">${escape(line)}</p>`)
    .join('\n')

  return {
    text: [...lines, '', action.href].join('\n\n'),
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.55;color:#1a1d23">
${paragraphs}
  <p style="margin:22px 0 0"><a href="${escape(action.href)}" style="display:inline-block;padding:10px 18px;border-radius:9px;background:#5b4be0;color:#fff;text-decoration:none;font-weight:600">${escape(action.label)}</a></p>
</div>`,
  }
}

/** Somebody was given a space. The link is where to go; what actually opens the
 *  space is the address being proved, by the same emailed code the app signs in
 *  with, so there is nothing to sign up for first. */
export function inviteMessage(invite: {
  space: string
  from: string
  role: 'write' | 'read'
  link: string
  /** The one file that was shared, when it was one file and not the space. The
   *  mail says what was actually handed over, because that is what the person
   *  opening it will find: a note, and not the drawer it came out of. */
  item?: string | null
}) {
  const what = invite.role === 'write' ? 'write in it' : 'read it'
  const named = invite.item ?? invite.space
  const kind = invite.item ? 'note' : 'space'

  return {
    subject: oneLine(`${invite.from} shared ${named} with you`),
    ...letter(
      [
        `${invite.from} shared the ${kind} ${named} with you on Nib, and you can ${what}.`,
        'Open it below. Nib emails you a code to check the address, and asks for nothing else.',
      ],
      { label: `Open the ${kind}`, href: invite.link },
    ),
  }
}

/** A computer was given the account's web key: the one moment somebody who had
 *  taken the mailbox and a session would need, and the one sync mail there is. Like
 *  a bank's new-device mail, it says what happened and where to undo it. See
 *  hub/keys.ts and docs/sync-v2.md section 6.6. */
export function webKeyMessage(device: string, link: string) {
  return {
    subject: oneLine(`${device} was given your web logins`),
    ...letter(
      [
        `Another of your computers allowed ${device} to open the sites you are signed in to in Nib.`,
        'If that was not you, end it in Settings, Account.',
      ],
      { label: 'Open Nib', href: link },
    ),
  }
}

/** Somebody followed a link that asks first, and is waiting on the owner. */
export function requestMessage(request: { space: string; who: string; link: string }) {
  return {
    subject: oneLine(`${request.who} would like to join ${request.space}`),
    ...letter(
      [`${request.who} followed your link to ${request.space} and is waiting to be let in.`],
      { label: 'Open Nib', href: request.link },
    ),
  }
}
