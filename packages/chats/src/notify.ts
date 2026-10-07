/** Whether a message pings its reader (docs/chats.md 4.11).
 *
 *  One pure function, so the app and, the day phone push is switched on (decision
 *  7.4), the Worker decide by the same rules: the app asks it for a desktop
 *  notification as a poke arrives; the Worker would ask it for the same message,
 *  then push only where no desktop of the person's was active a moment ago
 *  (`owesPush`), Slack's rule. Nothing here knows a clock, a zone or a window: the
 *  caller says what time it is on the reader's own calendar and whether the chat is
 *  in front of them.
 *
 *  The order of the questions is the order a person would give: their own words never
 *  ping them; a chat they are looking at is already seen; a muted chat says nothing;
 *  the chat's level decides what reaches them (all, or only what calls for them); a
 *  pause and the hours they allow come last, because those hold back what would
 *  otherwise ping, never what would not. */

import { MENTIONS_ONLY_PAST } from './limits'
import type { Mention, Notify, Who } from './types'

/** The hours pings are let through, Slack's notification schedule: on the listed days
 *  (0 Sunday to 6 Saturday, the reader's own calendar), from `from` to `to`, each in
 *  minutes after midnight. A window that ends before it starts runs past midnight and
 *  belongs to the day it starts on; one that ends where it starts is the whole day.
 *  Outside it nothing pings, and counts still move. */
export interface Hours {
  days: number[]
  from: number
  to: number
}

/** What the reader chose for every chat at once, in the account's settings. */
export interface Hush {
  /** Words that call for the reader as their name does. */
  keywords: readonly string[]
  /** The hours pings are let through; null for every hour. */
  hours: Hours | null
  /** Nothing pings before this moment: Slack's "pause notifications". */
  pausedUntil: number | null
}

/** A message, as much of it as the decision reads. */
export interface Heard {
  author: Who
  body: string
  mentions: readonly Mention[]
  /** The author of the message this replies to, for a reply. */
  repliesTo?: Who | null
}

/** The reader's setting for one chat, as `GET /v2/chats` answers it. */
export interface Hearing {
  /** Null is the default for the chat's size (`levelOf`). */
  notify: Notify | null
  mutedUntil: number | null
  members: number
}

/** Now, and where now falls on the reader's own calendar. */
export interface Moment {
  now: number
  /** 0 Sunday to 6 Saturday. */
  day: number
  /** Minutes after the reader's midnight. */
  minute: number
}

/** Everything the decision reads. */
export interface Asked {
  me: Who
  message: Heard
  chat: Hearing
  hush: Hush
  moment: Moment
  /** Somebody is at one of the reader's devices: what `@here` reaches. */
  active: boolean
  /** The chat is on screen in a window in front of the reader. */
  seen: boolean
}

/** What the decision says: `show`, or the first reason it does not. */
export type Ping = 'show' | 'own' | 'seen' | 'muted' | 'level' | 'paused' | 'quiet'

/** Why a message calls for the reader in particular: their name, `@everyone`, `@here`
 *  while they are active, a reply to them, or one of their keywords. */
export type Call = 'name' | 'everyone' | 'here' | 'reply' | 'keyword'

/** Keywords a reader may keep, and the longest. Slack's list is a line of words;
 *  more than this is a filter, which nib does not offer. */
export const MOST_KEYWORDS = 50
export const LONGEST_KEYWORD = 60

/** A mute that lasts until the reader turns it back: the largest moment a number and
 *  the account's integer column both hold exactly. */
export const MUTED_FOR_GOOD = Number.MAX_SAFE_INTEGER

/** How recently a desktop must have been active for a phone push to be held back. */
export const DESKTOP_ACTIVE_WITHIN = 2 * 60 * 1000

const DAY_MINUTES = 24 * 60

/** What pings for a chat whose reader has not chosen: everything in a small chat, only
 *  what calls for them in one of more than ten people. */
export function levelOf(notify: Notify | null, members: number): Notify {
  return notify ?? (members > MENTIONS_ONLY_PAST ? 'mentions' : 'all')
}

/** Whether the reader muted the chat, as of `now`. */
export function isMuted(mutedUntil: number | null, now: number): boolean {
  return mutedUntil !== null && mutedUntil > now
}

/** A letter, a digit or an underscore: what may not touch a keyword on either side, so
 *  `nib` is found in "nib, again" and not in "nibble". */
const WORDY = '[\\p{L}\\p{N}_]'

/** The first of the reader's keywords the words hold, as the reader wrote it; null for
 *  none. Any case, whole words only, and a keyword may be several words. */
export function keywordIn(body: string, keywords: readonly string[]): string | null {
  const text = body.normalize('NFC')
  for (const keyword of keywords) {
    const clean = keyword.trim().normalize('NFC')
    if (!clean) continue
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?<!${WORDY})${escaped}(?!${WORDY})`, 'iu').test(text)) return keyword
  }
  return null
}

/** Why the message calls for the reader, the strongest reason first; null where it
 *  only speaks to the chat. */
export function callOf(
  message: Heard,
  me: Who,
  active: boolean,
  keywords: readonly string[],
): Call | null {
  if (message.mentions.includes(me)) return 'name'
  if (message.mentions.includes('everyone')) return 'everyone'
  if (active && message.mentions.includes('here')) return 'here'
  if (message.repliesTo === me) return 'reply'
  return keywordIn(message.body, keywords) === null ? null : 'keyword'
}

/** Whether `moment` falls inside the hours pings are let through. */
export function inHours(hours: Hours | null, moment: Moment): boolean {
  if (!hours) return true
  const { days, from, to } = hours
  if (from === to) return days.includes(moment.day)
  if (from < to) return days.includes(moment.day) && moment.minute >= from && moment.minute < to
  // Past midnight: the evening of a listed day, or the small hours after one.
  const yesterday = (moment.day + 6) % 7
  return (
    (days.includes(moment.day) && moment.minute >= from) ||
    (days.includes(yesterday) && moment.minute < to)
  )
}

/** Whether the message pings the reader, or the first reason it does not. */
export function decide(asked: Asked): Ping {
  const { me, message, chat, hush, moment } = asked
  if (message.author === me) return 'own'
  if (asked.seen) return 'seen'
  if (isMuted(chat.mutedUntil, moment.now)) return 'muted'

  const level = levelOf(chat.notify, chat.members)
  if (level === 'nothing') return 'level'
  if (level === 'mentions' && callOf(message, me, asked.active, hush.keywords) === null)
    return 'level'

  if (hush.pausedUntil !== null && hush.pausedUntil > moment.now) return 'paused'
  return inHours(hush.hours, moment) ? 'show' : 'quiet'
}

/** Whether a message that pings is owed a phone push: only where no desktop of the
 *  reader's was active within `DESKTOP_ACTIVE_WITHIN`, which has already shown it. The
 *  Worker's seam for the day push is switched on (decision 7.4); nothing calls it yet. */
export function owesPush(ping: Ping, desktopActive: boolean): boolean {
  return ping === 'show' && !desktopActive
}

/** Whether a value is a list of keywords the account keeps. */
export function isKeywords(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MOST_KEYWORDS &&
    value.every(
      (one) => typeof one === 'string' && one.trim().length > 0 && one.length <= LONGEST_KEYWORD,
    )
  )
}

/** Whether a value is hours the account keeps: whole minutes inside a day and days of
 *  the week, each once. */
export function isHours(value: unknown): value is Hours {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { days, from, to } = value as Record<string, unknown>
  const minute = (one: unknown) =>
    typeof one === 'number' && Number.isInteger(one) && one >= 0 && one < DAY_MINUTES
  return (
    Array.isArray(days) &&
    days.every((one) => typeof one === 'number' && Number.isInteger(one) && one >= 0 && one <= 6) &&
    new Set(days).size === days.length &&
    minute(from) &&
    minute(to)
  )
}
