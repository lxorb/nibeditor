/** Placing one event: whether this person may, the order it takes, and the messages it
 *  changes, in one synchronous step the object runs inside a transaction
 *  (docs/chats.md 4.3, 4.5 and 4.6).
 *
 *  Nothing here decides a rule of its own. Who may is `mayEvent` from `@nib/chats`,
 *  the table the app hides its buttons by; what an event does to a message is `apply`,
 *  the reducer every device runs. A placed event is applied by replaying every event
 *  about the messages it touches - a post's own, the edits, reactions, pins, votes and
 *  deletes aimed at it, and its replies - which is the reducer's state for those
 *  messages exactly, and a handful of rows however long the chat. What is refused is
 *  never logged, so every device replaying the log arrives at the same state.
 *
 *  Each refusal is a `Refusal` code; the app says it in the reader's language. */

import { apply, chatState, mayEvent } from '@nib/chats'
import type { Event, FileRef, Logged, Mention, Message, Meta, Role, Who } from '@nib/chats'
import { BURST_POSTS, BURST_SECONDS, EVENTS_A_MINUTE } from '@nib/chats/limits'
import type { Refusal } from '@nib/chats/wire'

/** The refusals a route or the object names outside `admit`: an event or a body that
 *  does not check, a person who may not, and a ceiling. */
export const INVALID: Refusal = 'invalid'
export const ROLE: Refusal = 'role'
export const RATE: Refusal = 'rate'

export interface Asker {
  who: Who
  role: Role
  device?: string
}

/** What a placed event set going that is not the log's: the people a post calls (and
 *  the author of the message a reply answers), the files it brought, and the files a
 *  delete let go of. */
export interface Effects {
  called: Mention[]
  answered: Who | null
  files: FileRef[]
  freed: FileRef[]
}

export interface EventRow extends Record<string, SqlStorageValue> {
  seq: number
  id: string
  kind: string
  target: string | null
  message: string | null
  parent: string | null
  author: string
  device: string | null
  at: number
  made_at: number | null
  body: string
}

/** An event as the log placed it. */
export function loggedOf(row: EventRow): Logged {
  const placed: Logged = {
    ...(JSON.parse(row.body) as Event),
    seq: row.seq,
    at: row.at,
    author: row.author as Who,
  }
  if (row.device) placed.device = row.device
  if (row.made_at !== null) placed.madeAt = row.made_at
  return placed
}

/** A message as the object keeps it. */
function messageIn(sql: SqlStorage, id: string): Message | null {
  const row = sql.exec<{ json: string }>('select json from messages where id = ?', id).toArray()[0]
  return row ? (JSON.parse(row.json) as Message) : null
}

/* ── The chat's settings ───────────────────────────────────────────────── */

export function metaOf(sql: SqlStorage): Meta {
  const kept = new Map(
    sql
      .exec<{ key: string; value: string | null }>('select key, value from meta')
      .toArray()
      .map((one) => [one.key, one.value]),
  )
  return {
    topic: kept.get('topic') ?? '',
    posting: kept.get('posting') === 'owner' ? 'owner' : 'writers',
    slowmode: Number(kept.get('slowmode') ?? 0) || 0,
  }
}

export function readMeta(sql: SqlStorage, key: string): string | null {
  return (
    sql.exec<{ value: string | null }>('select value from meta where key = ?', key).toArray()[0]
      ?.value ?? null
  )
}

export function setMeta(sql: SqlStorage, key: string, value: string | null): void {
  sql.exec(
    `insert into meta (key, value) values (?, ?)
     on conflict(key) do update set value = excluded.value`,
    key,
    value,
  )
}

/* ── Admitting ─────────────────────────────────────────────────────────── */

/** Counts one arrival against a ceiling, answering whether it was inside it. */
function paced(
  sql: SqlStorage,
  who: Who,
  kind: string,
  most: number,
  window: number,
  at: number,
): boolean {
  const row = sql
    .exec<{ since: number; count: number }>(
      'select since, count from paces where who = ? and kind = ?',
      who,
      kind,
    )
    .toArray()[0]
  const fresh = !row || at - row.since >= window
  const count = fresh ? 1 : row.count + 1
  sql.exec(
    `insert into paces (who, kind, since, count) values (?, ?, ?, ?)
     on conflict(who, kind) do update set since = excluded.since, count = excluded.count`,
    who,
    kind,
    fresh ? at : row.since,
    count,
  )
  return count <= most
}

/** The message an event is about, for those that are about one. */
function targetOf(event: Event): string | null {
  return 'target' in event ? event.target : null
}

const posts = (event: Event) =>
  event.kind === 'post' ||
  event.kind === 'schedule' ||
  event.kind === 'react' ||
  event.kind === 'vote'

/** Whether this person may send this event now, or why not: the roles table, then
 *  whether what it is about is there, then the chat's slowmode and the ceilings (4.3). A
 *  ceiling is counted only for what got that far. */
export function admit(sql: SqlStorage, event: Event, asker: Asker, at: number): Refusal | null {
  const meta = metaOf(sql)
  const target = targetOf(event)
  const message = target === null ? null : messageIn(sql, target)
  const mine = message?.author === asker.who

  if (!mayEvent(asker.role, event, mine, meta.posting)) {
    return asker.role !== 'read' && posts(event) && meta.posting === 'owner' ? 'posting' : 'role'
  }

  if (target !== null) {
    if (!message) return 'gone'
    // A delete stands over everything else said about a message.
    if (message.deleted && event.kind !== 'delete') return 'gone'
  }
  if (event.kind === 'vote') {
    const poll = message?.poll
    if (!poll || (poll.ends !== undefined && at > poll.ends)) return 'gone'
    if (event.answers.some((one) => one >= poll.answers.length)) return 'invalid'
    if (!poll.several && event.answers.length > 1) return 'invalid'
  }

  const post = event.kind === 'schedule' ? event.post : event.kind === 'post' ? event : null
  if (post) {
    if (messageIn(sql, post.message) || heldFor(sql, post.message, asker.who) === 'other') {
      return 'invalid'
    }
    if (post.parent !== undefined && !messageIn(sql, post.parent)) return 'gone'
    if (post.quote !== undefined && !messageIn(sql, post.quote)) return 'gone'
    if (meta.slowmode > 0 && asker.role !== 'owner' && event.kind === 'post') {
      if (!paced(sql, asker.who, 'slow', 1, meta.slowmode * 1000, at)) return 'slow'
    }
    if (!paced(sql, asker.who, 'posts', BURST_POSTS, BURST_SECONDS * 1000, at)) return 'rate'
  }
  return paced(sql, asker.who, 'events', EVENTS_A_MINUTE, 60_000, at) ? null : 'rate'
}

/** Whether a message id is held for its time: by this person, by another, or not. */
function heldFor(sql: SqlStorage, message: string, who: Who): 'mine' | 'other' | null {
  const row = sql
    .exec<{ author: string }>('select author from scheduled where message = ?', message)
    .toArray()[0]
  if (!row) return null
  return row.author === who ? 'mine' : 'other'
}

/* ── Placing ───────────────────────────────────────────────────────────── */

/** The place an event already has, if the log holds it. */
export function placedEvent(sql: SqlStorage, id: string): Logged | null {
  const row = sql.exec<EventRow>('select * from events where id = ?', id).toArray()[0]
  return row ? loggedOf(row) : null
}

/** One admitted event appended and applied. Synchronous, for one transaction. */
export function place(
  sql: SqlStorage,
  event: Exclude<Event, { kind: 'schedule' }>,
  asker: Asker,
  at: number,
  madeAt?: number,
): { logged: Logged; effects: Effects } {
  const target = targetOf(event)
  const before = target === null ? null : messageIn(sql, target)

  // When it was written, kept only where that was more than a minute before it arrived:
  // the hover's "written 13:40" (4.5).
  const written = madeAt !== undefined && madeAt < at - 60_000 ? madeAt : null
  const { seq } = sql
    .exec<{ seq: number }>(
      `insert into events (id, kind, target, message, parent, author, device, at, made_at, body)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning seq`,
      event.id,
      event.kind,
      target,
      event.kind === 'post' ? event.message : null,
      event.kind === 'post' ? (event.parent ?? null) : null,
      asker.who,
      asker.device ?? null,
      at,
      written,
      JSON.stringify(event),
    )
    .one()

  const logged: Logged = { ...event, seq, at, author: asker.who }
  if (asker.device) logged.device = asker.device
  if (written !== null) logged.madeAt = written

  if (event.kind === 'meta') {
    if (event.topic !== undefined) setMeta(sql, 'topic', event.topic)
    if (event.posting !== undefined) setMeta(sql, 'posting', event.posting)
    if (event.slowmode !== undefined) setMeta(sql, 'slowmode', String(event.slowmode))
  } else {
    const ids = event.kind === 'post' ? [event.message, event.parent] : [target, before?.parent]
    keep(
      sql,
      replayed(
        sql,
        ids.filter((one): one is string => typeof one === 'string'),
      ),
    )
  }

  const answered =
    event.kind === 'post' && event.parent !== undefined
      ? (messageIn(sql, event.parent)?.author ?? null)
      : null
  return {
    logged,
    effects: {
      called: event.kind === 'post' ? (event.mentions ?? []) : [],
      answered: answered === asker.who ? null : answered,
      files: event.kind === 'post' || event.kind === 'edit' ? (event.files ?? []) : [],
      freed: event.kind === 'delete' && before && !before.deleted ? before.files : [],
    },
  }
}

/** These messages as the reducer makes them from every event about them. */
function replayed(sql: SqlStorage, ids: readonly string[]): Message[] {
  if (!ids.length) return []
  const list = ids.map(() => '?').join(', ')
  const rows = sql
    .exec<EventRow>(
      `select * from events
        where message in (${list}) or target in (${list}) or parent in (${list})
           or target in (select message from events where parent in (${list}))
        order by seq`,
      ...ids,
      ...ids,
      ...ids,
      ...ids,
    )
    .toArray()
  const state = chatState()
  for (const row of rows) apply(state, loggedOf(row))
  return ids.flatMap((id) => state.messages.get(id) ?? [])
}

/** Messages written back as they now stand. */
function keep(sql: SqlStorage, messages: readonly Message[]): void {
  for (const message of messages) {
    sql.exec(
      `insert into messages (seq, id, author, at, parent, deleted, replies, body, json)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set deleted = excluded.deleted, replies = excluded.replies,
         body = excluded.body, json = excluded.json`,
      message.seq,
      message.id,
      message.author,
      message.at,
      message.parent ?? null,
      message.deleted ? 1 : 0,
      message.replies,
      message.body,
      JSON.stringify(message),
    )
  }
}
