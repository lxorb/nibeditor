/** What the engine keeps in the sync store beyond the columns section 9.2 names, and how
 *  it is spelled there.
 *
 *  Three things. A document's two version numbers - where its confirmed state is on the
 *  account (`seq`, what a push names) and how far along the space's feed it has been
 *  pulled (`pulled`, which says a newer `docSeq` has words to fetch) - kept as a `meta`
 *  row beside its `docs` row, `doc:<id>`, in the same write. What waits to go up: tree
 *  ops, the losing side of an answer or a minor overlap on its way to `/v2/docs/keep`,
 *  and a day's note the account merged into one that was there, each a row of the
 *  `outbox` in the order it was made. And what a held note was held against, in the
 *  `held` row's `remote`.
 *
 *  All of it framed the way sync v2 frames a request (`frame` in @nib/sync-core), so a
 *  Yjs update inside a record is bytes and not a list of numbers, and read back through
 *  a check: a row is unknown until it has been looked at. */

import { frame, type CreateOp, type KeepRequest, type Op, opOf, unframe } from '@nib/sync-core/wire'
import type { MetaRow } from './store'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// ---------------------------------------------------------------------------
// A document's numbers

/** A push sent and not answered yet: its own id, and how many of the pending updates it
 *  carried. Written before it goes, so one whose answer was lost - to the network or to
 *  a crash - goes again as it was, the same id and the same bytes, and the account
 *  answers it the way it answered the first time (`PushDoc` in @nib/sync-core/wire). */
export interface Flight {
  push: string
  count: number
}

export interface DocNumbers {
  /** The document's version on the account that `confirmed` is at. */
  seq: number
  /** The feed's `docSeq` the confirmed state is known to cover. */
  pulled: number
  /** Whether it holds updates the account has not acknowledged: what a pass looks for
   *  without reading every document's bytes. */
  pending: boolean
  flight: Flight | null
}

const DOC = 'doc:'

export function numbersKey(id: string): string {
  return `${DOC}${id}`
}

const whole = (value: unknown): value is number => Number.isSafeInteger(value)

function flightOf(value: unknown): Flight | null {
  if (typeof value !== 'object' || value === null) return null
  const { push, count } = value as Record<string, unknown>
  return typeof push === 'string' && whole(count) ? { push, count } : null
}

/** The id a numbers row is about, or null for another meta row. */
export function numbersOf(row: MetaRow): { id: string; numbers: DocNumbers } | null {
  if (!row.key.startsWith(DOC) || typeof row.value !== 'string') return null
  try {
    const value: unknown = JSON.parse(row.value)
    if (typeof value !== 'object' || value === null) return null
    const { seq, pulled, pending, flight } = value as Record<string, unknown>
    if (!whole(seq) || !whole(pulled)) return null
    return {
      id: row.key.slice(DOC.length),
      numbers: { seq, pulled, pending: pending === true, flight: flightOf(flight) },
    }
  } catch {
    return null
  }
}

export function numbersRow(id: string, numbers: DocNumbers): MetaRow {
  return { key: numbersKey(id), value: JSON.stringify(numbers) }
}

/** A document's pending updates as the `pending` column holds them: a list, oldest
 *  first, each what one pause in the typing (or one answer) added. A list rather than
 *  one merged update, because a push carries the first few and an acknowledgement
 *  confirms the first few, and a merged update cannot be cut back into what it was
 *  made of. */
export function pendingBytes(chunks: readonly Uint8Array[]): Uint8Array | null {
  return chunks.length ? frame({ chunks: [...chunks] }) : null
}

export function pendingOf(bytes: Uint8Array | null): Uint8Array[] {
  if (!bytes) return []
  const value = unframe(bytes)
  if (!isRecord(value) || !Array.isArray(value.chunks)) return []
  return value.chunks.filter((one): one is Uint8Array => one instanceof Uint8Array)
}

// ---------------------------------------------------------------------------
// The outbox

/** A day's note the account answered `merged`: this device's words (`mine`) go into
 *  the note that was there (`into`), against the text both started from, and the create
 *  is kept for when that note is gone before they get there. */
export interface Merging {
  mine: string
  into: string
  create: CreateOp
}

/** `sent` marks an op that went up in a request whose answer has not come back: it is
 *  the account's already, and goes again exactly as it was. */
export type Outgoing =
  | { t: 'op'; op: Op; sent?: boolean }
  | { t: 'keep'; keep: KeepRequest }
  | { t: 'merge'; merge: Merging }

export function outgoingBytes(record: Outgoing): Uint8Array {
  return frame(record)
}

export function outgoingOf(bytes: Uint8Array): Outgoing | null {
  const value = unframe(bytes)
  if (!isRecord(value)) return null
  if (value.t === 'op') {
    const op = opOf(value.op)
    if (!op) return null
    return value.sent === true ? { t: 'op', op, sent: true } : { t: 'op', op }
  }
  if (value.t === 'keep' && isRecord(value.keep)) {
    const { id, text, device } = value.keep
    if (typeof id !== 'string' || typeof text !== 'string' || typeof device !== 'string') {
      return null
    }
    return { t: 'keep', keep: { id, text, device } }
  }
  if (value.t === 'merge' && isRecord(value.merge)) {
    const { mine, into, create } = value.merge
    const op = opOf(create)
    if (typeof mine !== 'string' || typeof into !== 'string' || op?.t !== 'create') return null
    return { t: 'merge', merge: { mine, into, create: op } }
  }
  return null
}

// ---------------------------------------------------------------------------
// Documents the feed said moved

/** A document the feed says has words this device has not pulled: the feed's `docSeq`
 *  for it and the epoch it is on. Kept per space in `meta` as `want:<space>`, written
 *  with the cursor that moved past them, so a pass cut off between reading the feed and
 *  pulling still pulls them next time. */
export interface Wanted {
  docSeq: number
  epoch: number
}

const WANT = 'want:'

export function wantKey(space: string): string {
  return `${WANT}${space}`
}

export function wantedOf(row: MetaRow): { space: string; wanted: Map<string, Wanted> } | null {
  if (!row.key.startsWith(WANT) || typeof row.value !== 'string') return null
  try {
    const value: unknown = JSON.parse(row.value)
    if (!isRecord(value)) return null
    const wanted = new Map<string, Wanted>()
    for (const [id, one] of Object.entries(value)) {
      if (!Array.isArray(one)) continue
      const [docSeq, epoch] = one as unknown[]
      if (whole(docSeq) && whole(epoch)) wanted.set(id, { docSeq, epoch })
    }
    return { space: row.key.slice(WANT.length), wanted }
  } catch {
    return null
  }
}

export function wantedRow(space: string, wanted: ReadonlyMap<string, Wanted>): MetaRow {
  const out: Record<string, [number, number]> = {}
  for (const [id, one] of wanted) out[id] = [one.docSeq, one.epoch]
  return { key: wantKey(space), value: JSON.stringify(out) }
}

// ---------------------------------------------------------------------------
// A held note

/** What a note is held against (section 5.4).
 *
 *  - `moved`: a push answered `moved`, or a socket opening with pending edits met the
 *    room's words; `update` is what the account sent, which brings the confirmed
 *    state to version `seq`, last changed at `at` on the account's clock.
 *  - `file`: another program changed the file while the document had moved too; the
 *    file's text is `local`, the words nib last wrote are `base`, and the document is
 *    the other side.
 *  - `merge`: a day's note made here met one of the same name on the account; `local`
 *    is this device's text, `base` the text both started from, and `from` the id of the
 *    note this device made, whose words are `local`. */
export type Against =
  | { t: 'moved'; update: Uint8Array; seq: number; at: number }
  | { t: 'file'; base: string; local: string }
  | { t: 'merge'; base: string; local: string; from: string }

export function againstBytes(against: Against): Uint8Array {
  return frame(against)
}

export function againstOf(bytes: Uint8Array): Against | null {
  const value = unframe(bytes)
  if (!isRecord(value)) return null
  const { t } = value
  if (t === 'moved') {
    const { update, seq, at } = value
    if (!(update instanceof Uint8Array) || !Number.isSafeInteger(seq)) return null
    return { t, update, seq: Number(seq), at: typeof at === 'number' ? at : 0 }
  }
  if (t === 'file') {
    const { base, local } = value
    if (typeof base !== 'string' || typeof local !== 'string') return null
    return { t, base, local }
  }
  if (t === 'merge') {
    const { base, local, from } = value
    if (typeof base !== 'string' || typeof local !== 'string' || typeof from !== 'string') {
      return null
    }
    return { t, base, local, from }
  }
  return null
}
