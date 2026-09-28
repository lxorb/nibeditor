/** What a note said before, on the account.
 *
 *  A device already keeps its own versions, and that is the one a reader reaches
 *  for: it is there instantly, it goes back to before the note was ever synced,
 *  and it costs nobody anything. But it is keyed by the note's path on that
 *  machine, so a rename orphans it, another machine never sees it, and a laptop
 *  that dies takes it with it. This is the other half: keyed by the note's id,
 *  which is the one name for a note that every device agrees on.
 *
 *  What a version is: a body the account was sent. Every push already carries the
 *  whole note, so the versions are the pushes - nothing is computed, diffed or
 *  stored twice. The body goes to R2 under its own hash, so a note that flips
 *  between two states costs two objects however many times it flips, and two
 *  notes that say the same thing cost one; the same arrangement pictures already
 *  use. The row is a moment, a hash, a size and the device that sent it.
 *
 *  What is deliberately not kept:
 *
 *  Every save. At most one version per note per five minutes, which is the same
 *  interval the device's own keeper defaults to. The newest state of a note is
 *  the note, so a version from thirty seconds ago says nothing the file does not.
 *
 *  Forever. A month by default, or a year for an account that asks - and thinned
 *  as it ages, the way a backup is: everything from the first day, one an hour
 *  for the first month, one a day for the next two, one a week after that. Which
 *  is the shape Time Machine has had since 2007, for the reason it has it: what
 *  somebody wants from last Tuesday is the version they were writing, and what
 *  they want from last spring is *a* version.
 *
 *  There is a ceiling under all of it, per account and in bytes, swept
 *  oldest-first: a year of a busy vault is real storage, and a history that grew
 *  without limit would be a bill nobody agreed to. Version bytes do not count
 *  against the account's own gigabyte - that is Emil's to decide - so this is the
 *  only thing holding them. */

import { cleanPersonName, now } from './crypto'
import type { Env, Note } from './types'

/** How long the account keeps a version, in days: a month, or a year. The two
 *  the setting offers, and the two the service will take; see settings.ts. */
export const KEEP_DAYS = [30, 365] as const

/** What an account that has never said keeps: a month, which is what every
 *  account kept before there was a choice. */
export const KEEP_FOR = 30 * 24 * 60 * 60 * 1000

/** The closest two versions of one note are allowed to be. */
const VERSION_EVERY = 5 * 60 * 1000

/** Everything from the last day is kept as it happened; older than that, one per
 *  hour survives, then one per day, then one per week. */
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** Where each shelf begins, as an age. Older than a month, a day is enough;
 *  older than three, a week is - and a year of a note written in every day comes
 *  to 24 + 30 + 60 + 39, which is a hundred and fifty-odd rows rather than nine
 *  thousand. */
const AFTER_A_MONTH = 30 * DAY
const AFTER_THREE = 90 * DAY

/** How many bytes of history one account may hold before the oldest of it starts
 *  to go.
 *
 *  Two gigabytes. A year of hourly versions of a thousand-note vault written in
 *  every day is around that, and the bodies are shared by hash, so a vault of
 *  small edits costs far less than the arithmetic suggests. It is a number to
 *  turn rather than a policy: version bytes are not counted against the account's
 *  own gigabyte, so this is what stands between a year of history and a bill. */
export const MOST_VERSION_BYTES = 2 * 1024 * 1024 * 1024

/** How many accounts over that ceiling one night deals with. The sweep is
 *  nightly and an account that is over it is over it by a little more each day,
 *  so a queue that empties slowly empties. */
const ACCOUNTS_AT_ONCE = 20

/** How much one sweep does. Counted in writes rather than rows, because a Worker
 *  invocation has a ceiling on those and a busy month has plenty of both. */
const AT_ONCE = 400

/** The most versions a route hands back at once. A month of one an hour is 720,
 *  and a list nobody scrolls is a list nobody reads. */
const MOST_SHOWN = 300

/** The most versions the account keeps of any one note.
 *
 *  A month under the two rules above is the first day at one every five minutes
 *  and twenty-nine days at one an hour, which is 984 - so a note somebody writes
 *  in every day of a month lands just under this and nothing anybody does reaches
 *  it by accident.
 *
 *  It is here rather than left to the sweep because the sweep runs nightly with a
 *  write budget, and a note written in all day makes 288 versions between two
 *  runs of it. A ceiling that holds where the version is written is one the
 *  bucket can be sized against; one that waits for a sweep is a hope. */
export const MOST_KEPT = 1024

/** How long a device's name may be. */
const DEVICE_LIMIT = 40

export interface Version {
  note_id: string
  at: number
  hash: string
  size: number
  by: string
}

/** Where a version's bytes live. Its hash, so the same words are stored once. */
export function versionKey(hash: string): string {
  return `versions/${hash}`
}

export function presentVersion(version: Version) {
  return { at: version.at, size: version.size, by: version.by }
}

/** The name a device sent for itself, as far as it is worth keeping.
 *
 *  A note settled in a room names the device that was typing, the same as a note
 *  pushed by a pass; see rooms/room.ts. Empty means nobody announced a name - the
 *  note a new space arrives with, a connected app writing through the connector,
 *  a client that sent no header. The history sheet shows the moment with no name
 *  beside it, which is what the device's own snapshots look like. See
 *  docs/sync.md. */
export function deviceIn(header: string | undefined): string {
  // Cleaned the way a person's name is, because that is what it is: a word
  // somebody's client chose, shown in the history sheet and beside a session in
  // the Account pane. A newline was already taken out; the rest of the control
  // characters were not, and a name is words and not layout either way.
  const name = cleanPersonName(header ?? '')
  if (name.length <= DEVICE_LIMIT) return name

  // Cut by what a reader would call a character rather than by UTF-16 unit, so a
  // bound of forty never leaves half of one in the column. A code point is not
  // that either: a flag is two of them and a family is seven.
  const characters = new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(name)

  let out = ''
  let held = 0
  for (const { segment } of characters) {
    if (held === DEVICE_LIMIT) break
    out += segment
    held += 1
  }

  return out
}

/** Keeps what the account was just sent, unless it says nothing new.
 *
 *  Called from the one place every note body arrives through, so a note that a
 *  room settled between four devices is kept the same way a note one device
 *  pushed is. Best effort by design: a version that could not be written is not a
 *  reason to fail the save that carried it, and the note itself is already
 *  safely stored by the time this runs. */
export async function keepVersion(
  env: Env,
  note: Pick<Note, 'id' | 'hash' | 'size'>,
  content: string,
  by = '',
): Promise<void> {
  const newest = await env.DB.prepare(
    'select at, hash from note_versions where note_id = ? order by at desc limit 1',
  )
    .bind(note.id)
    .first<{ at: number; hash: string }>()

  // Nothing new to say, or too soon to say it again.
  if (newest?.hash === note.hash) return
  if (newest && now() - newest.at < VERSION_EVERY) return

  // The bytes before the row, so a row never names a body that is not there. A
  // hash another note already keeps needs neither.
  const held = await env.DB.prepare('select 1 as one from note_versions where hash = ? limit 1')
    .bind(note.hash)
    .first<{ one: number }>()

  if (!held) await env.NOTES.put(versionKey(note.hash), content)

  await env.DB.prepare(
    'insert or ignore into note_versions (note_id, at, hash, size, by) values (?, ?, ?, ?, ?)',
  )
    .bind(note.id, now(), note.hash, note.size, by)
    .run()

  await keepAtMost(env, note.id)
}

/** The ceiling on one note's history, held where the version is written.
 *
 *  Counted rather than read, because almost every save is nowhere near the
 *  ceiling and a count on the note's own index is one seek. Over it, the oldest
 *  go - which is the same answer the month gives, arrived at sooner. */
async function keepAtMost(env: Env, noteId: string): Promise<void> {
  const held = await env.DB.prepare('select count(*) as many from note_versions where note_id = ?')
    .bind(noteId)
    .first<{ many: number }>()

  const over = (held?.many ?? 0) - MOST_KEPT
  if (over <= 0) return

  const { results } = await env.DB.prepare(
    `delete from note_versions
      where note_id = ?1
        and at in (select at from note_versions where note_id = ?1 order by at limit ?2)
      returning hash`,
  )
    .bind(noteId, over)
    .all<{ hash: string }>()

  await forgetBodies(
    env,
    results.map((one) => one.hash),
  )
}

/** The bodies of versions that have gone, for the hashes no row names any more.
 *
 *  The one place a version's bytes are taken away, because the rule is one rule:
 *  a body goes when the last row naming it has, so a version two notes share
 *  outlives either of them losing it. Answers how many went. */
async function forgetBodies(env: Env, hashes: Iterable<string>): Promise<number> {
  let gone = 0

  for (const hash of new Set(hashes)) {
    const held = await env.DB.prepare('select 1 as one from note_versions where hash = ? limit 1')
      .bind(hash)
      .first<{ one: number }>()

    if (held) continue
    await env.NOTES.delete(versionKey(hash))
    gone += 1
  }

  return gone
}

/** Every version of one note, newest first. */
export async function versionsOf(env: Env, noteId: string): Promise<Version[]> {
  const { results } = await env.DB.prepare(
    'select * from note_versions where note_id = ? order by at desc limit ?',
  )
    .bind(noteId, MOST_SHOWN)
    .all<Version>()

  return results
}

/** What one version said, or null for a moment this note has no version at.
 *
 *  Null as well for a row whose body has gone, which is the same answer for the
 *  same reason: there is nothing to show. Answering that with no words at all is
 *  worse than answering nothing - the history sheet would draw an empty note, and
 *  restoring it would write that emptiness over the words somebody still has. */
export async function versionAt(env: Env, noteId: string, at: number): Promise<string | null> {
  const version = await env.DB.prepare(
    'select hash from note_versions where note_id = ? and at = ?',
  )
    .bind(noteId, at)
    .first<{ hash: string }>()

  if (!version) return null

  const object = await env.NOTES.get(versionKey(version.hash))
  return object ? await object.text() : null
}

/** What the path of every note inside a folder starts with: the folder and a
 *  slash, or nothing for the whole space.
 *
 *  Compared as the characters it is rather than as a `like` pattern. A pattern
 *  reads `_` and `%` in a folder's name as wildcards and ignores the case of every
 *  letter, so putting `Work` back put `work` back too, and `a_b` took `aXb` with it:
 *  a rollback reaching notes the reader never asked it to touch. */
function folderPrefix(under: string): string {
  const folder = under.replace(/\/+$/, '')
  return folder ? `${folder}/` : ''
}

/** What every note under a path said at a moment: the newest version at or
 *  before it, for the notes that have one.
 *
 *  Deleted notes are in, because a note that was deleted after that moment is
 *  one of the things a rollback is for. */
export async function versionsAt(
  env: Env,
  spaceId: string,
  under: string,
  at: number,
): Promise<{ note_id: string; path: string; hash: string; live: string }[]> {
  const prefix = folderPrefix(under)

  const { results } = await env.DB.prepare(
    `select v.note_id as note_id, n.path as path, v.hash as hash, n.hash as live
       from note_versions v
       join notes n on n.id = v.note_id
      where n.space_id = ?1 and substr(n.path, 1, length(?2)) = ?2 and v.at <= ?3
        and v.at = (select max(at) from note_versions where note_id = v.note_id and at <= ?3)
      order by n.path
      limit ?4`,
  )
    .bind(spaceId, prefix, at, AT_ONCE)
    .all<{ note_id: string; path: string; hash: string; live: string }>()

  return results
}

/** What the account a note belongs to keeps its history for, in milliseconds.
 *
 *  Read off the owner's settings through the note's space, which is where the
 *  word the reader chose already lives; a column on the version row would be the
 *  same fact written twice, and would answer for the choice in force on the day
 *  the version was written rather than the one in force now. `keepVersions` is
 *  days, and an account that has never said keeps the month it always kept. */
const HORIZON = "coalesce(json_extract(u.settings, '$.keepVersions'), ?2) * 86400000"

/** Which shelf a row is on, as the bucket its survivor is chosen within: an hour
 *  for the first month, a day for the next two, a week after that.
 *
 *  Used twice in one statement - grouped by, and divided by - and the group key
 *  carries both, because two shelves can otherwise land on the same number: a
 *  week's bucket of an old row and an hour's bucket of a recent one are both
 *  integers and nothing says they differ. */
const SHELF = 'case when at < ?3 then ?4 when at < ?5 then ?6 else ?7 end'

/** The sweep: a month or a year, thinned as it ages, and a ceiling under both.
 *
 *  Bodies go only when the last row naming one has gone, and the whole run is
 *  bounded: a sweep that tried to catch up on a year in one invocation would be
 *  stopped in the middle by the platform rather than by us, and the next night
 *  would start again from the same place. */
export async function sweepVersions(env: Env, at: number): Promise<number> {
  const freed = new Set<string>()

  // Older than what its own account keeps. The join is what makes the horizon
  // the reader's rather than the service's; see HORIZON.
  const old = await env.DB.prepare(
    `delete from note_versions
      where rowid in (
        select v.rowid from note_versions v
          join notes n on n.id = v.note_id
          join spaces s on s.id = n.space_id
          left join users u on u.id = s.user_id
         where v.at < ?1 - ${HORIZON}
         limit ?3
      )
      returning hash`,
  )
    .bind(at, KEEP_FOR / DAY, AT_ONCE)
    .all<{ hash: string }>()

  for (const row of old.results) freed.add(row.hash)

  // And the thinning, for what is left beyond the first day: one statement per
  // note rather than one per row.
  //
  // Which is the difference between a promise the sweep keeps and one it does
  // not. A note written in all day is 288 rows, of which 264 are crowded, and a
  // budget counted in rows spent the whole night's on a single note - so with two
  // busy notes the month thinned to one an hour was simply not what the account
  // held, and every night began the same distance behind. A statement a note is
  // 400 notes a night instead, and a note is only ever behind by one run.
  const { results: busy } = await env.DB.prepare(
    'select distinct note_id from note_versions where at < ? limit ?',
  )
    .bind(at - DAY, AT_ONCE)
    .all<{ note_id: string }>()

  for (const one of busy) {
    const thinned = await env.DB.prepare(
      `delete from note_versions
        where note_id = ?1 and at < ?2
          and at not in (select max(at) from note_versions
                          where note_id = ?1 and at < ?2
                          group by ${SHELF}, cast(at / (${SHELF}) as integer))
        returning hash`,
    )
      .bind(one.note_id, at - DAY, at - AFTER_THREE, WEEK, at - AFTER_A_MONTH, DAY, HOUR)
      .all<{ hash: string }>()

    for (const row of thinned.results) freed.add(row.hash)
  }

  return (await forgetBodies(env, freed)) + (await capVersions(env))
}

/** The ceiling: an account over it loses its oldest history until it is under.
 *
 *  Oldest-first, because that is the order anybody would give history up in - and
 *  because the version somebody actually asks for is nearly always a recent one.
 *  Bounded twice, by the accounts looked at and by the rows deleted, so one
 *  night's run is one night's work and an account that is far over comes down
 *  over several of them.
 *
 *  Answers how many bodies went, which the sweep adds to its own count. */
async function capVersions(env: Env): Promise<number> {
  const { results: over } = await env.DB.prepare(
    `select s.user_id as user_id, sum(v.size) as bytes
       from note_versions v
       join notes n on n.id = v.note_id
       join spaces s on s.id = n.space_id
      group by s.user_id
     having bytes > ?1
      limit ?2`,
  )
    .bind(MOST_VERSION_BYTES, ACCOUNTS_AT_ONCE)
    .all<{ user_id: string; bytes: number }>()

  const freed = new Set<string>()

  for (const account of over) {
    let held = account.bytes

    for (let round = 0; round < 4 && held > MOST_VERSION_BYTES; round++) {
      // Read before deleted, so exactly as much goes as has to: a chunk deleted
      // outright would take four hundred versions where one was over the line.
      const { results: oldest } = await env.DB.prepare(
        `select v.rowid as id, v.hash as hash, v.size as size
           from note_versions v
           join notes n on n.id = v.note_id
           join spaces s on s.id = n.space_id
          where s.user_id = ?1
          order by v.at
          limit ?2`,
      )
        .bind(account.user_id, AT_ONCE)
        .all<{ id: number; hash: string; size: number }>()

      if (!oldest.length) break

      const going: number[] = []
      for (const row of oldest) {
        if (held <= MOST_VERSION_BYTES) break

        going.push(row.id)
        freed.add(row.hash)
        held -= row.size
      }

      if (!going.length) break

      await env.DB.prepare(
        `delete from note_versions where rowid in (${going.map(() => '?').join(', ')})`,
      )
        .bind(...going)
        .run()
    }
  }

  return await forgetBodies(env, freed)
}

/** Everything the account remembered one note saying, gone for good.
 *
 *  Called when a note's words are purged rather than when it is deleted: a note
 *  in Recently deleted is one somebody may still want back, and its history is
 *  part of what coming back means. Each body goes only once the last row naming
 *  it has, which is what keeps a version another note shares. */
/** How many notes one rollback puts back. The same ceiling `versionsAt` reads
 *  under, said out loud so the route can tell a full answer from a truncated
 *  one. */
export const ROLLBACK_AT_ONCE = AT_ONCE

/** How many notes a rollback has in all to put back, for the moment it hits that
 *  ceiling.
 *
 *  An answer that said "400 notes" where there were twelve hundred read as
 *  finished, and half the space was still where it had been. This is the same
 *  question `versionsAt` asks, counted rather than listed, and asked only when
 *  the answer was cut off - which is rarely, because most spaces are smaller than
 *  the ceiling. */
export async function countVersionsAt(
  env: Env,
  spaceId: string,
  under: string,
  at: number,
): Promise<number> {
  const prefix = folderPrefix(under)

  const found = await env.DB.prepare(
    `select count(*) as held from note_versions v
       join notes n on n.id = v.note_id
      where n.space_id = ?1 and substr(n.path, 1, length(?2)) = ?2 and v.at <= ?3
        and v.hash != n.hash
        and v.at = (select max(at) from note_versions where note_id = v.note_id and at <= ?3)`,
  )
    .bind(spaceId, prefix, at)
    .first<{ held: number }>()

  return found?.held ?? 0
}

export async function forgetVersions(env: Env, noteId: string): Promise<number> {
  const { results } = await env.DB.prepare(
    'delete from note_versions where note_id = ? returning hash',
  )
    .bind(noteId)
    .all<{ hash: string }>()

  return await forgetBodies(
    env,
    results.map((one) => one.hash),
  )
}
