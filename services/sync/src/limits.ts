/** How often a thing may happen, and to whom.
 *
 *  Three of the ways in here cost the service something it cannot take back:
 *  mail leaves the building, a registration writes a row, an owner is told
 *  somebody is waiting. Each already had a gate on the one person it is about -
 *  an address hears from Nib at most every thirty seconds - and none of them had
 *  a ceiling on the whole: one machine could ask for a code for ten thousand
 *  addresses, and every one of those sends is Nib's reputation as a sender.
 *
 *  So this module holds the ceilings. `within` is the general one, counting
 *  arrivals per scope and key inside a window; `mailCeilings` is the set that
 *  guards every message that goes out - per machine, per address, and on the
 *  service as a whole - which is the one place worth naming because three of the
 *  modules here send mail and none should decide the numbers for itself.
 *
 *  Each counts and answers in one call, for the reason the per-address gate does:
 *  nothing can ask, be told no, and go ahead anyway. */

import { now } from './crypto'
import { TRY_IN_AN_HOUR } from './refused'
import type { Env } from './types'

const AN_HOUR = 60 * 60 * 1000
const A_DAY = 24 * AN_HOUR

/** How many messages one machine may cause in an hour. A person signing in
 *  needs one and asks for a second if the first went astray; the number is what
 *  an office behind one address can want at once, and far below what somebody
 *  working through a list of addresses does. */
const MAIL_FROM_ONE_MACHINE = 20

/** How many people the service writes to in a day. Every address that has heard
 *  from Nib today counts once, however often it heard; past this, an address
 *  that has not heard yet waits for tomorrow. */
const ADDRESSES_A_DAY = 500

/** The machine a request came from, as Cloudflare names it.
 *
 *  Cloudflare sets the header on everything that reaches a Worker, so in the
 *  places this is used it is there. Where it is not - `wrangler dev`, a test,
 *  anything reaching the app some other way - there is no machine to count, and
 *  counting them all as one would make one shared bucket that the first person
 *  through empties for everybody. So the answer is null and the ceiling on the
 *  whole day is what is left standing. */
export function machineOf(headers: { header(name: string): string | undefined }): string | null {
  const said = headers.header('cf-connecting-ip')?.trim()
  // An address is 45 characters at the outside; anything longer is not one, and
  // the column is not somewhere to write a story.
  return said && said.length <= 64 ? said : null
}

/** Counts one arrival under a scope and key, and says how many there have been
 *  inside the window. */
async function counted(env: Env, scope: string, key: string, window: number): Promise<number> {
  // Rows whose window has ended say nothing any more, so they go as new ones
  // arrive - the way the sessions and the sign-in codes are cleared. It also
  // means the upsert below never has to reason about a stale row: by the time it
  // runs, the row it finds is one still inside its window.
  await env.DB.prepare('delete from limits where until < ?').bind(now()).run()

  const row = await env.DB.prepare(
    `insert into limits (scope, key, count, until) values (?1, ?2, 1, ?3)
     on conflict(scope, key) do update set count = limits.count + 1
     returning count`,
  )
    .bind(scope, key, now() + window)
    .first<{ count: number }>()

  return row?.count ?? 1
}

/** Counts one arrival against a ceiling and says whether it was inside it. */
async function within(
  env: Env,
  scope: string,
  key: string,
  most: number,
  window: number,
): Promise<boolean> {
  return (await counted(env, scope, key, window)) <= most
}

/** Takes one arrival back, for something that was counted and then did not
 *  happen. Never below nothing, and a row already swept stays swept. */
async function uncount(env: Env, scope: string, key: string): Promise<void> {
  await env.DB.prepare(
    'update limits set count = count - 1 where scope = ? and key = ? and count > 0',
  )
    .bind(scope, key)
    .run()
}

/** Whether the service may write to one more person today, counting this one. */
async function withinTheDay(env: Env, address: string): Promise<boolean> {
  const day = Math.floor(now() / A_DAY)

  await env.DB.prepare('delete from mailed_days where day < ?').bind(day).run()

  const counted = await env.DB.prepare(
    `select count(*) as many, sum(case when email = ?2 then 1 else 0 end) as held
       from mailed_days where day = ?1`,
  )
    .bind(day, address)
    .first<{ many: number; held: number | null }>()

  // Somebody who has already heard from Nib today is not one more person to
  // write to, so the ceiling has nothing to say about them.
  if (!counted?.held && (counted?.many ?? 0) >= ADDRESSES_A_DAY) return false

  await env.DB.prepare('insert into mailed_days (day, email) values (?, ?) on conflict do nothing')
    .bind(day, address)
    .run()

  return true
}

/** How many clients one machine may register in an hour. Registering is open to
 *  anybody, so this is the only thing standing between one script and a table of
 *  clients; a client that registers afresh on every conversation gets its own row
 *  back rather than a new one, so it never reaches this. */
const REGISTRATIONS_AN_HOUR = 20

/** Whether one more client may be registered from this machine. */
export function mayRegister(env: Env, machine: string | null): Promise<boolean> {
  if (!machine) return Promise.resolve(true)
  return within(env, 'register', machine, REGISTRATIONS_AN_HOUR, AN_HOUR)
}

/** How often the owner of one space hears that somebody is waiting on them. A
 *  link anybody may follow is a door a roomful of people can knock on in a
 *  minute, and what the owner needs to know is that somebody is there. */
export function mayTellTheOwner(env: Env, spaceId: string): Promise<boolean> {
  return within(env, 'waiting', spaceId, 1, AN_HOUR)
}

/** How many questions one account may ask the model in an hour, and how many
 *  utterances it may have turned into words.
 *
 *  These cost somebody money - the account's own OpenAI credit, or Nib's own Workers
 *  AI allowance where an account has no key - and the Worker is what spends it now
 *  that the key never leaves the Worker. So the ceiling is not
 *  about Nib's reputation like the mail ones; it is about a bug, or a phone in a
 *  pocket, not being able to run through a month's credit in an afternoon.
 *
 *  Sixty questions is far more than a person walking around asks and far less than a
 *  loop does. Utterances are the higher of the two because the microphone hears
 *  every command, not only the questions - and only where the WebView has no
 *  recogniser of its own, which is the phone doing the work for free. */
const QUESTIONS_AN_HOUR = 60
const UTTERANCES_AN_HOUR = 600

/** Whether one more question may be asked, counting this one. */
export function mayAsk(env: Env, userId: string): Promise<boolean> {
  return within(env, 'ask', userId, QUESTIONS_AN_HOUR, AN_HOUR)
}

/** Whether one more utterance may be turned into words, counting this one. */
export function mayTranscribe(env: Env, userId: string): Promise<boolean> {
  return within(env, 'said', userId, UTTERANCES_AN_HOUR, AN_HOUR)
}

/** How many times one account may be given a second-factor code to check in an
 *  hour. Six digits is a million guesses, and without a ceiling a script with an
 *  afternoon walks them; twenty is far more than anybody mistypes. */
const SECOND_TRIES_AN_HOUR = 20

/** Whether one more second-factor code may be checked, counting this one. */
export function mayTrySecond(env: Env, userId: string): Promise<boolean> {
  return within(env, 'second', userId, SECOND_TRIES_AN_HOUR, AN_HOUR)
}

/** And how many one machine may try, whoever they are about.
 *
 *  The ceiling above says nothing to a script working through a list of
 *  addresses: twenty guesses each is as many as it likes, from one machine, so
 *  long as it keeps moving on to the next account. This is the one that answers
 *  that. Generous against the account ceiling, because a household or an office
 *  behind one address is several people mistyping. */
const SECOND_TRIES_FROM_ONE_MACHINE = 60

/** Whether one more may be checked from this machine, counting this one. */
export function mayTrySecondFrom(env: Env, machine: string | null): Promise<boolean> {
  if (!machine) return Promise.resolve(true)
  return within(env, 'second-from', machine, SECOND_TRIES_FROM_ONE_MACHINE, AN_HOUR)
}

/** How many sign-in codes one address may have checked in an hour, whichever
 *  codes they were.
 *
 *  Five wrong tries spend one code, and that alone bounds nothing: asking for
 *  another resets the count, an address may be sent one every thirty seconds, and
 *  the machine ceiling on mail says nothing to a script spread over a few of them.
 *  That was six hundred guesses an hour at somebody's account for as long as it
 *  cared to run. Fifteen is three codes' worth of mistyping, and far below that.
 *
 *  Counted per address rather than per machine, because the address is what is
 *  being guessed at. The price is that a script can make somebody wait an hour to
 *  sign in, which is the trade every such ceiling makes, and a far better one than
 *  the account. */
const CODE_TRIES_AN_HOUR = 15

/** Whether one more sign-in code may be checked for this address, counting this
 *  one. */
export function mayTryCode(env: Env, address: string): Promise<boolean> {
  return within(env, 'code-tries', address, CODE_TRIES_AN_HOUR, AN_HOUR)
}

/** How many answers one machine may send through the forms on published pages
 *  in an hour, and how many any one site may take.
 *
 *  A form on the open web is a spam target, and the whole of what is done about
 *  it here is counting: no captcha, which is a third party watching the reader,
 *  and no address kept, which is the row's own promise. Ten is far more than
 *  somebody filling in a form, and a site that is being flooded stops taking
 *  answers rather than growing a table nobody asked for. */
const ANSWERS_FROM_ONE_MACHINE = 10
const ANSWERS_TO_ONE_SITE = 200

export function maySendAnswer(env: Env, machine: string | null): Promise<boolean> {
  if (!machine) return Promise.resolve(true)
  return within(env, 'answer-from', machine, ANSWERS_FROM_ONE_MACHINE, AN_HOUR)
}

export function mayTakeAnswer(env: Env, spaceId: string): Promise<boolean> {
  return within(env, 'answers', spaceId, ANSWERS_TO_ONE_SITE, AN_HOUR)
}

/** How many passwords one machine may try at one site in an hour, and how many
 *  tries any one site answers.
 *
 *  A guess costs the reader nothing and costs the service a hundred thousand rounds
 *  of PBKDF2, which is the point of a hundred thousand rounds - and an unmetered
 *  door is both a way to guess a short password and a way to spend somebody else's
 *  CPU with a loop. Twenty is far past somebody typing the word they were sent and
 *  mistyping it; the site's own ceiling is what a roomful of readers on one office
 *  address share, and it is generous for the same reason.
 *
 *  What a refused try is told is what a wrong password is told, which is the point:
 *  a door that says "too many tries" to a guesser has confirmed that the tries are
 *  being counted, and the reader who mistyped theirs waits either way. */
const GUESSES_FROM_ONE_MACHINE = 20
const GUESSES_AT_ONE_SITE = 500

export async function mayGuess(
  env: Env,
  spaceId: string,
  machine: string | null,
): Promise<boolean> {
  if (!(await within(env, 'guesses', spaceId, GUESSES_AT_ONE_SITE, AN_HOUR))) return false
  if (!machine) return true

  return within(env, 'guess-from', `${spaceId}:${machine}`, GUESSES_FROM_ONE_MACHINE, AN_HOUR)
}

/** How many messages one address may be sent in an hour, and in a day, whoever
 *  caused them and whichever kind they were.
 *
 *  The thirty second gap each address keeps is a pace and not a ceiling: it let
 *  anybody who kept asking send one address a hundred and twenty codes an hour,
 *  and the ceiling on one machine said nothing to a few machines taking turns. So
 *  somebody's inbox could be filled from outside, on the service's account. Six
 *  an hour is a sign-in on every device somebody owns with a second try on two of
 *  them; twenty-four a day is far past what anybody not being flooded is sent. */
const MAIL_TO_ONE_ADDRESS_AN_HOUR = 6
const MAIL_TO_ONE_ADDRESS_A_DAY = 24

/** How many messages the service sends in any twenty-four hours, all told.
 *
 *  Below the thousand a day the provider sends for the account, so that when the
 *  day runs short it is this that says no, with a time to come back, rather than
 *  the provider refusing every sign-in there is. Counted in hourly buckets that
 *  each last a day, so the window rolls and there is no midnight at which two
 *  days' worth can go out together. */
const MAIL_A_DAY = 900

const SENT = 'mail-sent'

/** The bucket a message sent now is counted in. */
function thisHour(): string {
  return String(Math.floor(now() / AN_HOUR))
}

/** How many seconds until the service has mail to send again, or null while it
 *  has. Asked without counting, and first, so that nothing refused anywhere
 *  below - one address being flooded above all - spends the day's mail. */
async function mailRunsOutFor(env: Env): Promise<number | null> {
  const row = await env.DB.prepare(
    `select coalesce(sum(count), 0) as sent, min(until) as first
       from limits where scope = ? and until >= ? and count > 0`,
  )
    .bind(SENT, now())
    .first<{ sent: number; first: number | null }>()

  if (!row || row.sent < MAIL_A_DAY) return null

  // The oldest hour is the first to stop counting, and that is when to come back.
  return Math.max(1, Math.ceil(((row.first ?? now()) - now()) / 1000))
}

const TOO_MUCH_TODAY = 'too much mail today - try again tomorrow'

/** Why a message may not go. */
export interface MailRefusal {
  error: string
  /** 429 when whoever asked, or the address, has had enough; 503 when the
   *  service has no mail left to send for now. */
  status: 429 | 503
  /** Seconds until asking again can work, where that is known. */
  retryAfter: number | null
  /** Whether it is about the address rather than the asker or the service. Only
   *  somebody asking for their own address is told that; see `mayMail`. */
  aboutTheAddress: boolean
}

/** Whether a message may go now, and why not when it may not, counting it
 *  against every ceiling when it may.
 *
 *  Null is the answer that means yes, so that a caller writes
 *  `if (refusal) ...` and nothing reads as allowed by accident. Every sentence is
 *  the app's own voice, because the ones about the service and the asker are
 *  always shown: unlike the per-address gate, which is silent on purpose - saying
 *  it would tell whoever asked that somebody else had just written to that
 *  address - a ceiling is about the service and the person in front of it, and
 *  says so. The ones about the address are shown only to that address's owner.
 *
 *  The order is what is spent by what: the day's mail is asked first and counted
 *  last, and the address is counted only once the asker and the day have let the
 *  message through, so that a flood refused at any step costs nobody else. */
export async function mailCeilings(
  env: Env,
  address: string,
  machine: string | null,
): Promise<MailRefusal | null> {
  const wait = await mailRunsOutFor(env)
  if (wait !== null) {
    return { error: TOO_MUCH_TODAY, status: 503, retryAfter: wait, aboutTheAddress: false }
  }

  if (machine && !(await within(env, 'mail', machine, MAIL_FROM_ONE_MACHINE, AN_HOUR))) {
    return {
      error: 'too many messages from here - try again later',
      status: 429,
      retryAfter: null,
      aboutTheAddress: false,
    }
  }

  if (!(await withinTheDay(env, address))) {
    return { error: TOO_MUCH_TODAY, status: 429, retryAfter: null, aboutTheAddress: false }
  }

  if (!(await within(env, 'mail-to', address, MAIL_TO_ONE_ADDRESS_AN_HOUR, AN_HOUR))) {
    return { error: TRY_IN_AN_HOUR, status: 429, retryAfter: null, aboutTheAddress: true }
  }

  if (!(await within(env, 'mail-to-day', address, MAIL_TO_ONE_ADDRESS_A_DAY, A_DAY))) {
    return { error: TOO_MUCH_TODAY, status: 429, retryAfter: null, aboutTheAddress: true }
  }

  await counted(env, SENT, thisHour(), A_DAY)
  return null
}

/** Gives back what `mailCeilings` counted, for a message that then did not go.
 *
 *  A provider having a bad hour would otherwise spend somebody's six messages on
 *  nothing, and they would be told to wait an hour for a code that never came.
 *  The machine keeps its count: it did ask. */
export async function mailNotSent(env: Env, address: string): Promise<void> {
  await uncount(env, 'mail-to', address)
  await uncount(env, 'mail-to-day', address)
  await uncount(env, SENT, thisHour())
}
