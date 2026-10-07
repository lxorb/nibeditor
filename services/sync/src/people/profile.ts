/** A person, as the others see them: what a profile holds, what may be written into
 *  it, and how it is said to somebody else.
 *
 *  Pure, so every rule here is a test of its own: the columns are text somebody's
 *  client wrote, read the way a request's body is (see body.ts), and a status whose
 *  time has passed is read as no status at all, so nothing has to run at the minute it
 *  ends. See docs/chats.md 4.9 and 4.10, and migration 0048. */

import { objectIn } from '../body'
import { cleanPersonName } from '../crypto'
import { personName } from '../spaces/share'
import { avatarIn } from './avatar'

/** An emoji and a line, and when they go. `quiet` is Do not disturb: a status that
 *  stops pings, never counts. */
export interface Status {
  emoji: string
  text: string
  until: number | null
  quiet: boolean
}

export type Presence = 'active' | 'away' | 'offline'

/** The columns a profile is read from, beside the account's own. */
export interface ProfileRow {
  id: string
  email: string
  name: string | null
  avatar: string | null
  pronouns: string | null
  bio: string | null
  status: string | null
  accent: string | null
  zone: string | null
  hidden: number
}

/** The columns, for a `select` that reads a person: `u.` in front of each. */
export const PROFILE_COLUMNS =
  'u.id, u.email, u.name, u.avatar, u.pronouns, u.bio, u.status, u.accent, u.zone, u.hidden'

/** Discord's lengths, which people already write to: forty for pronouns, a hundred and
 *  ninety for a bio. A status is a line, and a hundred characters is a long one. */
const PRONOUNS_LIMIT = 40
const BIO_LIMIT = 190
const STATUS_LIMIT = 100
/** An emoji is one picture and may be several code points: a flag is two, a family
 *  seven. Sixteen units is room for any of them and none of a sentence. */
const EMOJI_LIMIT = 16
/** What a nickname may be, the same as a name: see `NAME_LIMIT` in crypto.ts. */
export const NICK_LIMIT = 60
/** Each picture of a face, made small on the device: the card's at 512 px is well
 *  under this, and a face that is not has kept something it should not have. */
export const AVATAR_BYTES = 100 * 1024

/** One of the app's accents, by its id: a word, never a colour. The app keeps the
 *  list, and an id it does not know is drawn as its first. */
const ACCENT = /^[a-z]{1,16}$/

/** The status as it stands at `now`: none once its time has passed. */
export function statusIn(raw: string | null, now: number): Status | null {
  const held = objectIn(raw)
  if (!held) return null

  const status = statusFrom(held)
  if (!status || (status.until !== null && status.until <= now)) return null
  return status
}

/** A status out of whatever arrived, or null where it is not one. */
function statusFrom(value: Record<string, unknown>): Status | null {
  const { emoji, text, until, quiet } = value
  if (typeof emoji !== 'string' || emoji.length > EMOJI_LIMIT) return null
  if (typeof text !== 'string' || text.length > STATUS_LIMIT) return null
  if (until !== null && until !== undefined && !Number.isSafeInteger(until)) return null
  if (quiet !== undefined && typeof quiet !== 'boolean') return null

  const words = cleanPersonName(text)
  if (!emoji.trim() && !words && quiet !== true) return null
  return {
    emoji: emoji.trim(),
    text: words,
    until: typeof until === 'number' ? until : null,
    quiet: quiet === true,
  }
}

/** Whether a time zone is one this runtime can tell the time in. */
function isZone(zone: string): boolean {
  if (zone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** What a request may change about its own profile, each field left out where it was
 *  left out and null where it is to be taken away. */
export interface ProfileChanges {
  pronouns?: string | null
  bio?: string | null
  status?: Status | null
  accent?: string | null
  zone?: string | null
  hidden?: boolean
}

/** A request's body, read as changes to a profile, or the sentence saying what is
 *  wrong with it. Lowercase like every refusal here; see body.ts. */
export function profileChanges(
  fields: Record<string, unknown>,
): { changes: ProfileChanges } | { problem: string } {
  const changes: ProfileChanges = {}

  /** A field of words: what to keep, or why not. A bio keeps its lines; pronouns are
   *  one. Empty is the same as taking it away. */
  const words = (
    name: 'pronouns' | 'bio',
    limit: number,
  ): { kept: string | null | undefined } | { problem: string } => {
    if (!Object.hasOwn(fields, name)) return { kept: undefined }
    const value = fields[name]
    if (value === null) return { kept: null }
    if (typeof value !== 'string') return { problem: `${name} must be text` }
    const kept =
      name === 'bio' ? value.replace(/(?!\n)\p{Cc}/gu, '').trim() : cleanPersonName(value)
    if (kept.length > limit) return { problem: `use at most ${limit} characters` }
    return { kept: kept || null }
  }

  for (const [name, limit] of [
    ['pronouns', PRONOUNS_LIMIT],
    ['bio', BIO_LIMIT],
  ] as const) {
    const read = words(name, limit)
    if ('problem' in read) return read
    if (read.kept !== undefined) changes[name] = read.kept
  }

  if (Object.hasOwn(fields, 'status')) {
    const value = fields.status
    if (value === null) changes.status = null
    else if (typeof value === 'object' && !Array.isArray(value)) {
      const status = statusFrom(value as Record<string, unknown>)
      if (!status) return { problem: `use at most ${STATUS_LIMIT} characters` }
      changes.status = status
    } else return { problem: 'status must be an object' }
  }

  if (Object.hasOwn(fields, 'accent')) {
    const value = fields.accent
    if (value !== null && (typeof value !== 'string' || !ACCENT.test(value))) {
      return { problem: 'accent must be an accent' }
    }
    changes.accent = value
  }

  if (Object.hasOwn(fields, 'zone')) {
    const value = fields.zone
    if (value !== null && (typeof value !== 'string' || !isZone(value))) {
      return { problem: 'zone must be a time zone' }
    }
    changes.zone = value
  }

  if (Object.hasOwn(fields, 'hidden')) {
    if (typeof fields.hidden !== 'boolean') return { problem: 'hidden must be true or false' }
    changes.hidden = fields.hidden
  }

  return { changes }
}

/** A person as every list of people names them: who, what to call them, and the face
 *  to draw. Never the address, which the others may not have been given. */
function presentFace(row: ProfileRow) {
  return {
    id: row.id,
    name: personName(row),
    avatar: avatarIn(row.avatar),
    accent: row.accent,
  }
}

/** The whole card: the face, the words about them, and whether they are here. A person
 *  who appears offline is offline to everybody but themselves. */
export function presentProfile(
  row: ProfileRow,
  presence: Presence | null,
  now: number,
  asker: string,
) {
  const mine = row.id === asker
  return {
    ...presentFace(row),
    pronouns: row.pronouns,
    bio: row.bio,
    status: statusIn(row.status, now),
    zone: row.zone,
    presence: !mine && row.hidden ? 'offline' : (presence ?? 'offline'),
  }
}

/** What `/v1/me` adds to the account: the profile as its owner edits it, the switch
 *  that hides them included. */
export function presentOwnProfile(row: ProfileRow, now: number) {
  return {
    avatar: avatarIn(row.avatar),
    pronouns: row.pronouns,
    bio: row.bio,
    status: statusIn(row.status, now),
    accent: row.accent,
    zone: row.zone,
    hidden: row.hidden === 1,
  }
}
