/** The search language of chats (docs/chats.md 4.12): words, and Slack's modifiers.
 *
 *  `parseSearch` reads what was typed into a query; `matches` answers it for one message,
 *  which is what the browser build, the account's route and the tests ask; the desktop's
 *  store answers the same query through FTS5 and its own columns, and `hasOf` is what
 *  those columns hold, so every end means one thing by `has:image`.
 *
 *  A date in a query is the reader's own calendar day: "on Thursday" is Thursday where
 *  the reader is. So the parser answers days, `since` (inclusive) and `until` (not), and
 *  never instants; whoever holds the reader's zone turns a message's time into its day
 *  (`dayOf`). `today` is the parser's only clock, which keeps it pure.
 *
 *  Nothing typed is lost: a modifier the language does not know, or one whose value it
 *  cannot read, is searched for as a word, as Slack does. */

import type { Message, Who } from './types'

/** What a message can have. */
export type Has = 'link' | 'file' | 'image' | 'video' | 'voice' | 'poll' | 'pin' | 'reaction'

const HAS: readonly Has[] = ['link', 'file', 'image', 'video', 'voice', 'poll', 'pin', 'reaction']

/** A query, read. Each list is "any of" within itself, and every part must hold. */
export interface SearchQuery {
  /** Words every hit has, each as the start of one of its words. */
  words: string[]
  /** Runs of words every hit has as they are written. */
  phrases: string[]
  /** Words or phrases no hit has. */
  without: string[]
  /** Names of authors without the `@`, or `me`. */
  from: string[]
  /** Names of chats without the `#`. */
  in: string[]
  has: Has[]
  isReply: boolean
  /** Names called by the message without the `@`, or `me`. */
  mentions: string[]
  /** The first day a hit may be on, `YYYY-MM-DD`. */
  since?: string
  /** The first day after the last a hit may be on. */
  until?: string
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** A token: `key:"two words"`, `-"two words"`, `"two words"`, or a run of non-space. An
 *  unclosed quote runs to the end. */
const TOKEN = /([A-Za-z]+):"([^"]*)"?|(-?)"([^"]*)"?|(\S+)/g

/** `query` read as the language, with `today` (`YYYY-MM-DD`, the reader's) for the
 *  modifiers that name a day by where it is from today. */
export function parseSearch(query: string, today: string): SearchQuery {
  const out: SearchQuery = {
    words: [],
    phrases: [],
    without: [],
    from: [],
    in: [],
    has: [],
    isReply: false,
    mentions: [],
  }
  for (const match of query.matchAll(TOKEN)) {
    const [, quotedKey, quotedValue, minus, phrase, bare] = match
    if (quotedKey !== undefined && quotedValue !== undefined) {
      if (!modifier(out, quotedKey.toLowerCase(), quotedValue.trim(), today)) {
        out.phrases.push(`${quotedKey}:${quotedValue}`)
      }
    } else if (phrase !== undefined) {
      const words = phrase.trim()
      if (words) (minus ? out.without : out.phrases).push(words)
    } else if (bare !== undefined) {
      word(out, bare, today)
    }
  }
  return out
}

/** Whether a query asks anything but words: the search panel shows messages only then. */
export function hasModifiers(query: SearchQuery): boolean {
  return (
    query.from.length > 0 ||
    query.in.length > 0 ||
    query.has.length > 0 ||
    query.isReply ||
    query.mentions.length > 0 ||
    query.since !== undefined ||
    query.until !== undefined
  )
}

function word(out: SearchQuery, token: string, today: string) {
  // A dash or a quote alone finds nothing, so it asks nothing.
  if (!/[\p{L}\p{N}]/u.test(token)) return
  if (token.length > 1 && token.startsWith('-')) {
    out.without.push(token.slice(1))
    return
  }
  const colon = token.indexOf(':')
  if (
    colon > 0 &&
    modifier(out, token.slice(0, colon).toLowerCase(), token.slice(colon + 1), today)
  )
    return
  out.words.push(token)
}

/** Applies one modifier; false for a key or value the language does not read. */
function modifier(out: SearchQuery, key: string, value: string, today: string): boolean {
  if (!value) return false
  switch (key) {
    case 'from':
      return named(out.from, value, '@')
    case 'in':
      return named(out.in, value, '#')
    case 'mentions':
      return named(out.mentions, value, '@')
    case 'has': {
      const has = HAS.find((one) => one === value.toLowerCase())
      if (has && !out.has.includes(has)) out.has.push(has)
      return has !== undefined
    }
    case 'is':
      if (value.toLowerCase() !== 'reply') return false
      out.isReply = true
      return true
    case 'before':
    case 'after':
    case 'on':
    case 'during': {
      const range = rangeOf(key, value.toLowerCase(), today)
      if (!range) return false
      if (range.since !== undefined && (out.since === undefined || range.since > out.since))
        out.since = range.since
      if (range.until !== undefined && (out.until === undefined || range.until < out.until))
        out.until = range.until
      return true
    }
    default:
      return false
  }
}

function named(list: string[], value: string, mark: string): boolean {
  const name = value.startsWith(mark) ? value.slice(mark.length).trim() : value
  if (!name) return false
  list.push(name)
  return true
}

/** The days a date modifier allows. */
function rangeOf(
  key: string,
  value: string,
  today: string,
): { since?: string; until?: string } | null {
  if (key === 'during') {
    const span = spanOf(value, today)
    return span && { since: span[0], until: span[1] }
  }
  const day = dayNamed(value, today)
  if (!day) return null
  if (key === 'before') return { until: day }
  if (key === 'after') return { since: plusDays(day, 1) }
  return { since: day, until: plusDays(day, 1) }
}

/** A day by its date, or `today` or `yesterday`. */
function dayNamed(value: string, today: string): string | null {
  if (value === 'today') return today
  if (value === 'yesterday') return plusDays(today, -1)
  return isDay(value) ? value : null
}

/** The days of a day, a month (`2026-10`, `october`, `oct`) or a year, as [first, after
 *  the last). A month by its name alone is the latest one not after this month. */
function spanOf(value: string, today: string): [string, string] | null {
  const day = dayNamed(value, today)
  if (day) return [day, plusDays(day, 1)]
  if (/^\d{4}$/.test(value)) return [`${value}-01-01`, `${String(Number(value) + 1)}-01-01`]

  const numbered = /^(\d{4})-(\d{2})$/.exec(value)
  if (numbered) {
    const month = Number(numbered[2])
    return month >= 1 && month <= 12 ? monthSpan(Number(numbered[1]), month) : null
  }

  const named = value.length >= 3 ? MONTHS.findIndex((month) => month.startsWith(value)) : -1
  if (named === -1) return null
  const [year, month] = today.split('-').map(Number)
  if (year === undefined || month === undefined) return null
  return monthSpan(named + 1 > month ? year - 1 : year, named + 1)
}

function monthSpan(year: number, month: number): [string, string] {
  const next = month === 12 ? [year + 1, 1] : [year, month + 1]
  return [dayText(year, month, 1), dayText(next[0] ?? year, next[1] ?? 1, 1)]
}

function isDay(value: string): boolean {
  const parts = DAY.exec(value)
  if (!parts) return false
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function plusDays(day: string, days: number): string {
  const parts = DAY.exec(day)
  if (!parts) return day
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + days))
  return dayText(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function dayText(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Answering a query

const LINK = /\bhttps?:\/\/\S/i

/** What a message has, for `has:`: a link in its words or a preview, files, and of
 *  those pictures, video and sound, a poll, a pin, a reaction. A deleted message has
 *  nothing. */
export function hasOf(message: Message): Has[] {
  if (message.deleted) return []
  const has: Has[] = []
  if (message.preview || LINK.test(message.body)) has.push('link')
  if (message.files.length > 0) has.push('file')
  if (message.files.some((file) => file.type.startsWith('image/'))) has.push('image')
  if (message.files.some((file) => file.type.startsWith('video/'))) has.push('video')
  if (message.files.some((file) => file.type.startsWith('audio/'))) has.push('voice')
  if (message.poll) has.push('poll')
  if (message.pinned) has.push('pin')
  if (Object.keys(message.reactions).length > 0) has.push('reaction')
  return has
}

/** One message as a query sees it: the chat's name, who is asking, the names each
 *  person answers to (their account's name and nickname), and the reader's day of a
 *  time. */
export interface Hit {
  message: Message
  chat: string
  me: Who
  namesOf: (who: Who) => readonly string[]
  dayOf: (at: number) => string
}

/** Whether a message answers a query. */
export function matches(query: SearchQuery, hit: Hit): boolean {
  const { message } = hit
  if (message.deleted) return false

  const text = folded(message.body)
  const words = new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const has = (needle: string) => {
    const parts = folded(needle)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
    return parts.length > 0 && parts.every((part) => [...words].some((one) => one.startsWith(part)))
  }
  const says = (run: string) => text.includes(folded(run))

  if (!query.words.every(has) || !query.phrases.every(says)) return false
  if (query.without.some((one) => (one.includes(' ') ? says(one) : has(one)))) return false

  const isPerson = (name: string, who: Who) =>
    name.toLowerCase() === 'me'
      ? who === hit.me
      : hit.namesOf(who).some((one) => folded(one) === folded(name))
  if (query.from.length > 0 && !query.from.some((name) => isPerson(name, message.author)))
    return false
  if (query.in.length > 0 && !query.in.some((name) => folded(name) === folded(hit.chat)))
    return false
  if (query.mentions.length > 0) {
    const people = message.mentions.filter(
      (one): one is Who => one !== 'here' && one !== 'everyone',
    )
    if (!query.mentions.some((name) => people.some((who) => isPerson(name, who)))) return false
  }

  const hasNow = hasOf(message)
  if (!query.has.every((one) => hasNow.includes(one))) return false
  if (query.isReply && message.parent === undefined) return false

  const day = hit.dayOf(message.at)
  if (query.since !== undefined && day < query.since) return false
  return query.until === undefined || day < query.until
}

/** Text as a search compares it: without case, and without accents, so `cafe` finds
 *  `Café`. */
function folded(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}
