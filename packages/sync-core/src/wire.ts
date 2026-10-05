/** Everything sync v2 says over HTTP and over its sockets, as types, as checks, and
 *  as bytes.
 *
 *  One module for both ends, for the reason `packages/rooms/src/wire.ts` gives: the
 *  app and the Worker read and write the same shapes, and a shape spelled twice is
 *  two shapes a year later. Every route in section 7 of docs/sync-v2.md has its
 *  request and its answer here, and every one of them has a check that turns
 *  `unknown` into the type or into null. Nothing is coerced: a number where text was
 *  meant is a client's mistake, and saying so is more use than guessing.
 *
 *  Binary values - Yjs updates and state vectors - travel inside a small framed
 *  envelope instead of JSON: base64 would cost a third more on every update, and an
 *  update is what sync sends most. See `frame`. */

// ---------------------------------------------------------------------------
// The tree and the feed

/** What an entry in a space's tree is. A note, a canvas and a page note are
 *  documents; a `.url` is a small last-writer-wins file, and so is a `.term`, an
 *  online terminal naming its session (docs/online-terminal.md 4.5); `file` is any
 *  other file, a blob by hash; `folder` holds the others. */
export type EntryKind = 'note' | 'canvas' | 'pages' | 'url' | 'term' | 'file' | 'folder'

export const ENTRY_KINDS: readonly EntryKind[] = [
  'note',
  'canvas',
  'pages',
  'url',
  'term',
  'file',
  'folder',
]

/** One row of a space's feed: a tree change or a content change, in one order. */
export interface FeedItem {
  id: string
  kind: EntryKind
  /** The folder it is in, or null at the top of the space. */
  parent: string | null
  name: string
  deleted: boolean
  /** The space's cursor at this entry's latest change of any sort. */
  seq: number
  /** The cursor at its latest content change, for a document. */
  docSeq?: number
  /** The document's epoch (section 5.3), for a document; 0 means none yet. */
  epoch?: number
  /** The hash of the text the epoch was seeded from. */
  epochBase?: string
  hash: string
  size: number
  /** The device that made the change. */
  by: string
  /** When the account took it, on the account's clock. */
  at: number
}

/** `GET /v2/spaces/:space/feed?since=<seq>`. */
export interface FeedPage {
  items: FeedItem[]
  cursor: number
  more: boolean
}

/** The most items one page of the feed carries. */
export const FEED_PAGE = 1000

/** The most ops one `POST /v2/spaces/:space/ops` carries. */
export const OPS_BATCH = 200

/** What every tree operation carries: its own id, so a retry is answered with the
 *  first answer rather than applied twice, and the space cursor its device had
 *  seen when it made it, which is what "an edit beats a delete" is judged by. */
interface OpBase {
  op: string
  seen: number
}

/** A folder made. */
export interface MkdirOp extends OpBase {
  t: 'mkdir'
  id: string
  parent: string | null
  name: string
}

/** A note, canvas, page note, web note or file made.
 *
 *  `mergeable` marks a create that means "this note, made if it is not there yet":
 *  the append action and the journal. It carries the text the note started from
 *  (empty, or a template), which is the ancestor the device merges against when
 *  the account answers `merged`. */
export interface CreateOp extends OpBase {
  t: 'create'
  id: string
  kind: Exclude<EntryKind, 'folder'>
  parent: string | null
  name: string
  /** The blob's hash, for a file. */
  hash?: string
  mergeable?: { text: string }
}

export interface RenameOp extends OpBase {
  t: 'rename'
  id: string
  name: string
}

/** A move to another folder, renamed on the way when `name` is given. */
export interface MoveOp extends OpBase {
  t: 'move'
  id: string
  parent: string | null
  name?: string
}

export interface DeleteOp extends OpBase {
  t: 'delete'
  id: string
}

/** Out of Recently deleted, back where it was. */
export interface RestoreOp extends OpBase {
  t: 'restore'
  id: string
}

export type Op = MkdirOp | CreateOp | RenameOp | MoveOp | DeleteOp | RestoreOp

/** Why the account would not apply an op.
 *
 *  - `cycle`: a folder moved inside itself, by two moves that each looked fine;
 *  - `edited`: a delete of something written in after the delete's `seen`;
 *  - `role`: the device may read the space but not change it;
 *  - `gone`: the op names an id, or a folder, the account does not have. */
export type Refusal = 'cycle' | 'edited' | 'role' | 'gone'

/** The account's answer to one op, and what a device applies to its own tree.
 *
 *  A placing op (mkdir, create, rename, move, restore) is answered with where the
 *  entry ended up, which is where the device renames its own file to when the
 *  account numbered it. A delete is answered with `ok` alone. */
export type OpResult =
  | { op: string; ok: true }
  | { op: string; ok: true; id: string; parent: string | null; name: string }
  | { op: string; merged: string }
  | { op: string; refused: Refusal }

/** `POST /v2/spaces/:space/ops`. */
export interface OpsRequest {
  ops: Op[]
}

export interface OpsResponse {
  results: OpResult[]
  cursor: number
}

// ---------------------------------------------------------------------------
// Documents

/** The largest update the account takes in one piece (section 10). */
export const MOST_UPDATE_BYTES = 4 * 1024 * 1024

/** The most documents one pull asks for, and one push carries. */
export const PULL_BATCH = 200
export const PUSH_BATCH = 50

/** Why a document was not pushed or pulled: the device may only read it, the
 *  account has no such document, or the update is past `MOST_UPDATE_BYTES`. */
export type DocRefusal = 'role' | 'gone' | 'large'

/** One document a device wants news of: what it has, as a state vector.
 *
 *  Beside every state vector travels the document's `seq`: its version on the
 *  account, a counter the room moves on with every change it applies. The two answer
 *  different questions. A state vector says which insertions a copy holds, which is
 *  what a diff is made against; but a Yjs deletion only adds to the delete set and
 *  moves no client's clock, so two copies with one state vector can read differently.
 *  Whether anything changed is the version's to say. */
export interface PullDoc {
  id: string
  epoch: number
  sv: Uint8Array
}

/** `POST /v2/docs/pull`. */
export interface PullRequest {
  docs: PullDoc[]
}

/** What the device is missing (`Y.diffUpdateV2` of the snapshot against its state
 *  vector, deletions and all) and the version that brings it to; or, for a device on
 *  an old epoch, the epoch it should be on. */
export type PullAnswer =
  | { id: string; update: Uint8Array; seq: number }
  | { id: string; epoch: number; epochBase: string }
  | { id: string; refused: DocRefusal }

export interface PullResponse {
  docs: PullAnswer[]
}

/** One document's pending updates on their way up.
 *
 *  `seq` is the version the device's confirmed state is at, and `base` that state's
 *  vector. The account applies the update only if the document is still at `seq`;
 *  otherwise it answers `moved` with the diff against `base`, and the device
 *  classifies (section 5.4) and pushes again naming the version `moved` brought it
 *  to, which is what makes the second device the one that checks.
 *
 *  `push` is the push's own id. A push whose answer was lost is sent again with the
 *  same id and exactly the same update, whatever was typed since, and the account
 *  answers it with the answer it gave the first time. Without it the device could
 *  not tell its own words, already on the account, from somebody else's: they come
 *  back in `moved`, and once it has written around them they no longer classify as
 *  identical, and merge in twice. `at` is when the newest of the updates was made, on
 *  the device's clock: what `minor` compares, and nothing else. */
export interface PushDoc {
  id: string
  push: string
  epoch: number
  seq: number
  base: Uint8Array
  update: Uint8Array
  at: number
}

/** `POST /v2/docs/push`. */
export interface PushRequest {
  docs: PushDoc[]
}

/** Per document: applied and durable (the account is now at `seq`, with state vector
 *  `sv`); moved on since `seq` (here is what the device is missing, the version it
 *  comes to, and when the account last changed it, `at` on the account's clock, which
 *  is what a minor overlap compares with the device's own time: classify and come
 *  back); on a newer epoch; or refused. */
export type PushAnswer =
  | { id: string; ok: true; seq: number; sv: Uint8Array }
  | { id: string; moved: Uint8Array; seq: number; sv: Uint8Array; at: number }
  | { id: string; epoch: number }
  | { id: string; refused: DocRefusal }

export interface PushResponse {
  docs: PushAnswer[]
}

/** `POST /v2/docs/keep`: the losing side of a modal answer, kept as a version on
 *  the account and named after the device it came from. */
export interface KeepRequest {
  id: string
  text: string
  device: string
}

/** One document of a first sync's bulk read. */
export interface SnapshotDoc {
  id: string
  epoch: number
  epochBase?: string
  seq: number
  update: Uint8Array
}

/** `GET /v2/spaces/:space/snapshot?after=<id>`: documents in id order, about 4 MB a
 *  page; `next` is the `after` of the following page, null on the last. */
export interface SnapshotPage {
  docs: SnapshotDoc[]
  next: string | null
}

// ---------------------------------------------------------------------------
// The room's socket, under `nib.v2`

/** The subprotocol a v2 device offers beside its token. A socket without it is a v1
 *  client and hears neither message below. */
export const ROOM_V2 = 'nib.v2'

/** What the room says beyond y-protocols: the version and state it has made durable
 *  (at each settle), and the epoch it is moving to (before it closes with 4001).
 *
 *  An ACK's state vector confirms a device's pending insertions by their clocks. A
 *  pending update that only deletes has no clock to confirm it by, so it stays pending
 *  until a push is answered `ok`; sending it again is harmless, because Yjs ignores
 *  what it already has. */
export type RoomNews =
  { t: 'ack'; seq: number; sv: Uint8Array } | { t: 'epoch'; epoch: number; epochBase: string }

/** The close code a room uses when its document starts a new epoch. */
export const NEW_EPOCH = 4001

// ---------------------------------------------------------------------------
// The hub

/** The heartbeat a device sends every 10 s, and the answer the hub's auto-response
 *  gives without waking. */
export const BEAT = 'beat'
export const BEAT_ANSWER = 'ok'

/** The header a web state upload names its fence in. */
export const FENCE_HEADER = 'x-nib-fence'

/** The subprotocol prefix a hub socket names its device with. */
export const DEVICE_PROTOCOL = 'nib.device.'

/** What a device says to its hub. */
export type DeviceFrame =
  | { t: 'hello'; device: string; name: string; platform: string; app: string }
  | { t: 'active' }
  | { t: 'idle' }
  | { t: 'acquire'; key: string; take: boolean }
  | { t: 'release'; key: string; version: number }
  | { t: 'flushed'; key: string; version: number }
  | { t: 'want-key'; pub: string }
  | { t: 'grant-key'; to: string; wrapped: string; generation: number }
  | { t: 'deny-key'; to: string }

/** What the hub says to a device. `device` in `busy` and `lost` is the holder's
 *  device id. */
export type HubFrame =
  | { t: 'poke'; space: string; seq: number }
  | { t: 'granted'; key: string; fence: number; version: number }
  | { t: 'busy'; key: string; device: string }
  | { t: 'flush'; key: string; fence: number }
  | { t: 'lost'; key: string; device: string }
  | { t: 'free'; key: string }
  | { t: 'state'; key: string; version: number }
  | { t: 'key-wanted'; device: string; name: string; pub: string }
  | { t: 'key'; wrapped: string; generation: number }
  | { t: 'key-denied' }

/** One row of `GET /v2/devices`. */
export interface DeviceRow {
  id: string
  name: string
  platform: string
  createdAt: number
  lastSeenAt: number | null
}

// ---------------------------------------------------------------------------
// Checks: unknown in, the type or null out

export { ackFrame, epochFrame, frame, type Framed, roomNews, unframe } from './frame'

/** The longest id, op id, key or device name anything here carries. */
const LONGEST_ID = 200

/** The longest name of one file or folder, in code units: what every filesystem nib
 *  runs on holds. */
export const LONGEST_NAME = 255

/** The largest text `/v2/docs/keep` carries: twice the longest note (section 10). */
const MOST_KEPT = 8 * 1024 * 1024

type Checked<T> = (value: unknown) => T | null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LONGEST_ID
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

function isParent(value: unknown): value is string | null {
  return value === null || isId(value)
}

/** A name one file or folder may have on the account: not empty, not `.` or `..`, no
 *  slash, no NUL, no longer than a filesystem holds. Names one platform cannot hold
 *  (`CON`, `a:b`, a trailing dot) are allowed: the account keeps them as written and
 *  each device maps them to a local spelling (section 5.9). */
export function isName(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > LONGEST_NAME) return false
  if (value === '.' || value === '..') return false
  return !value.includes('/') && !value.includes('\u0000')
}

function isKind(value: unknown): value is EntryKind {
  return ENTRY_KINDS.some((kind) => kind === value)
}

/** A list of checked things, no longer than `most`; null if any one fails. */
function listOf<T>(value: unknown, each: Checked<T>, most = Number.MAX_SAFE_INTEGER): T[] | null {
  if (!Array.isArray(value) || value.length > most) return null
  const out: T[] = []
  for (const one of value) {
    const checked = each(one)
    if (checked === null) return null
    out.push(checked)
  }
  return out
}

/** One tree operation, as a device sent it. */
export function opOf(value: unknown): Op | null {
  if (!isRecord(value) || !isId(value.op) || !isCount(value.seen) || !isId(value.id)) return null
  const { op, seen, id } = value

  switch (value.t) {
    case 'mkdir':
      if (!isParent(value.parent) || !isName(value.name)) return null
      return { op, t: 'mkdir', id, parent: value.parent, name: value.name, seen }

    case 'create': {
      const { kind, parent, name, hash, mergeable } = value
      if (!isKind(kind) || kind === 'folder' || !isParent(parent) || !isName(name)) return null
      if (hash !== undefined && !isId(hash)) return null
      if (mergeable !== undefined && !(isRecord(mergeable) && typeof mergeable.text === 'string')) {
        return null
      }
      const made: CreateOp = { op, t: 'create', id, kind, parent, name, seen }
      if (hash !== undefined) made.hash = hash
      if (isRecord(mergeable) && typeof mergeable.text === 'string') {
        made.mergeable = { text: mergeable.text }
      }
      return made
    }

    case 'rename':
      return isName(value.name) ? { op, t: 'rename', id, name: value.name, seen } : null

    case 'move': {
      if (!isParent(value.parent)) return null
      if (value.name !== undefined && !isName(value.name)) return null
      const moved: MoveOp = { op, t: 'move', id, parent: value.parent, seen }
      if (value.name !== undefined) moved.name = value.name
      return moved
    }

    case 'delete':
      return { op, t: 'delete', id, seen }

    case 'restore':
      return { op, t: 'restore', id, seen }

    default:
      return null
  }
}

const REFUSALS: readonly Refusal[] = ['cycle', 'edited', 'role', 'gone']
const DOC_REFUSALS: readonly DocRefusal[] = ['role', 'gone', 'large']

function opResultOf(value: unknown): OpResult | null {
  if (!isRecord(value) || !isId(value.op)) return null
  const { op } = value

  if (value.ok === true) {
    if (value.id === undefined) return { op, ok: true }
    if (!isId(value.id) || !isParent(value.parent) || !isName(value.name)) return null
    return { op, ok: true, id: value.id, parent: value.parent, name: value.name }
  }
  if (isId(value.merged)) return { op, merged: value.merged }
  const refused = REFUSALS.find((one) => one === value.refused)
  return refused ? { op, refused } : null
}

/** `POST /v2/spaces/:space/ops`, as the Worker reads it: at most `OPS_BATCH` ops. */
export function opsRequestOf(value: unknown): OpsRequest | null {
  if (!isRecord(value)) return null
  const ops = listOf(value.ops, opOf, OPS_BATCH)
  return ops ? { ops } : null
}

/** The account's answer to a batch of ops, as a device reads it. */
export function opsResponseOf(value: unknown): OpsResponse | null {
  if (!isRecord(value) || !isCount(value.cursor)) return null
  const results = listOf(value.results, opResultOf)
  return results ? { results, cursor: value.cursor } : null
}

function feedItemOf(value: unknown): FeedItem | null {
  if (!isRecord(value)) return null
  const { id, kind, parent, name, deleted, seq, docSeq, epoch, epochBase, hash, size, by, at } =
    value
  if (!isId(id) || !isKind(kind) || !isParent(parent) || !isName(name)) return null
  if (typeof deleted !== 'boolean' || !isCount(seq) || typeof hash !== 'string') return null
  if (!isCount(size) || typeof by !== 'string' || !isTime(at)) return null
  if (docSeq !== undefined && !isCount(docSeq)) return null
  if (epoch !== undefined && !isCount(epoch)) return null
  if (epochBase !== undefined && typeof epochBase !== 'string') return null

  const item: FeedItem = { id, kind, parent, name, deleted, seq, hash, size, by, at }
  if (docSeq !== undefined) item.docSeq = docSeq
  if (epoch !== undefined) item.epoch = epoch
  if (epochBase !== undefined) item.epochBase = epochBase
  return item
}

/** One page of a space's feed, as a device reads it. */
export function feedPageOf(value: unknown): FeedPage | null {
  if (!isRecord(value) || !isCount(value.cursor) || typeof value.more !== 'boolean') return null
  const items = listOf(value.items, feedItemOf, FEED_PAGE)
  return items ? { items, cursor: value.cursor, more: value.more } : null
}

function pullDocOf(value: unknown): PullDoc | null {
  if (!isRecord(value) || !isId(value.id) || !isCount(value.epoch) || !isBytes(value.sv)) {
    return null
  }
  return { id: value.id, epoch: value.epoch, sv: value.sv }
}

/** `POST /v2/docs/pull`, as the Worker reads it: at most `PULL_BATCH` documents. */
export function pullRequestOf(value: unknown): PullRequest | null {
  if (!isRecord(value)) return null
  const docs = listOf(value.docs, pullDocOf, PULL_BATCH)
  return docs ? { docs } : null
}

function docRefusalOf(value: unknown): DocRefusal | null {
  return DOC_REFUSALS.find((one) => one === value) ?? null
}

function pullAnswerOf(value: unknown): PullAnswer | null {
  if (!isRecord(value) || !isId(value.id)) return null
  const { id } = value
  if (isBytes(value.update) && isCount(value.seq))
    return { id, update: value.update, seq: value.seq }
  if (isCount(value.epoch) && typeof value.epochBase === 'string') {
    return { id, epoch: value.epoch, epochBase: value.epochBase }
  }
  const refused = docRefusalOf(value.refused)
  return refused ? { id, refused } : null
}

/** The account's answer to a pull, as a device reads it. */
export function pullResponseOf(value: unknown): PullResponse | null {
  if (!isRecord(value)) return null
  const docs = listOf(value.docs, pullAnswerOf, PULL_BATCH)
  return docs ? { docs } : null
}

function pushDocOf(value: unknown): PushDoc | null {
  if (!isRecord(value)) return null
  const { id, push, epoch, seq, base, update, at } = value
  if (!isId(id) || !isId(push) || !isCount(epoch) || !isCount(seq)) return null
  if (!isBytes(base) || !isBytes(update) || !isTime(at)) return null
  return { id, push, epoch, seq, base, update, at }
}

/** `POST /v2/docs/push`, as the Worker reads it: at most `PUSH_BATCH` documents. The
 *  size of each update is the route's to judge, so it can answer `large` for that one
 *  document rather than refuse the batch. */
export function pushRequestOf(value: unknown): PushRequest | null {
  if (!isRecord(value)) return null
  const docs = listOf(value.docs, pushDocOf, PUSH_BATCH)
  return docs ? { docs } : null
}

function pushAnswerOf(value: unknown): PushAnswer | null {
  if (!isRecord(value) || !isId(value.id)) return null
  const { id, seq, sv, at } = value
  if (value.ok === true && isCount(seq) && isBytes(sv)) return { id, ok: true, seq, sv }
  if (isBytes(value.moved) && isCount(seq) && isBytes(sv) && isTime(at)) {
    return { id, moved: value.moved, seq, sv, at }
  }
  if (isCount(value.epoch)) return { id, epoch: value.epoch }
  const refused = docRefusalOf(value.refused)
  return refused ? { id, refused } : null
}

/** The account's answer to a push, as a device reads it. */
export function pushResponseOf(value: unknown): PushResponse | null {
  if (!isRecord(value)) return null
  const docs = listOf(value.docs, pushAnswerOf, PUSH_BATCH)
  return docs ? { docs } : null
}

/** `POST /v2/docs/keep`, as the Worker reads it. */
export function keepRequestOf(value: unknown): KeepRequest | null {
  if (!isRecord(value) || !isId(value.id) || !isId(value.device)) return null
  if (typeof value.text !== 'string' || value.text.length > MOST_KEPT) return null
  return { id: value.id, text: value.text, device: value.device }
}

function snapshotDocOf(value: unknown): SnapshotDoc | null {
  if (!isRecord(value) || !isId(value.id) || !isCount(value.epoch) || !isCount(value.seq)) {
    return null
  }
  if (!isBytes(value.update)) return null
  if (value.epochBase !== undefined && typeof value.epochBase !== 'string') return null
  const doc: SnapshotDoc = {
    id: value.id,
    epoch: value.epoch,
    seq: value.seq,
    update: value.update,
  }
  if (typeof value.epochBase === 'string') doc.epochBase = value.epochBase
  return doc
}

/** One page of a first sync's bulk read, as a device reads it. */
export function snapshotPageOf(value: unknown): SnapshotPage | null {
  if (!isRecord(value) || !(value.next === null || isId(value.next))) return null
  const docs = listOf(value.docs, snapshotDocOf)
  return docs ? { docs, next: value.next } : null
}

/** A text frame from a device, as the hub reads it: parsed JSON in, a frame or null. */
export function deviceFrameOf(value: unknown): DeviceFrame | null {
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'hello': {
      const { device, name, platform, app } = value
      if (!isId(device) || !isId(name) || !isId(platform) || !isId(app)) return null
      return { t: 'hello', device, name, platform, app }
    }
    case 'active':
      return { t: 'active' }
    case 'idle':
      return { t: 'idle' }
    case 'acquire':
      return isId(value.key) && typeof value.take === 'boolean'
        ? { t: 'acquire', key: value.key, take: value.take }
        : null
    case 'release':
    case 'flushed':
      return isId(value.key) && isCount(value.version)
        ? { t: value.t, key: value.key, version: value.version }
        : null
    case 'want-key':
      return isId(value.pub) ? { t: 'want-key', pub: value.pub } : null
    case 'grant-key': {
      const { to, wrapped, generation } = value
      if (!isId(to) || typeof wrapped !== 'string' || !isCount(generation)) return null
      return { t: 'grant-key', to, wrapped, generation }
    }
    case 'deny-key':
      return isId(value.to) ? { t: 'deny-key', to: value.to } : null
    default:
      return null
  }
}

/** A text frame from the hub, as a device reads it. */
export function hubFrameOf(value: unknown): HubFrame | null {
  if (!isRecord(value)) return null
  const { key } = value
  switch (value.t) {
    case 'poke':
      return isId(value.space) && isCount(value.seq)
        ? { t: 'poke', space: value.space, seq: value.seq }
        : null
    case 'granted':
      return isId(key) && isCount(value.fence) && isCount(value.version)
        ? { t: 'granted', key, fence: value.fence, version: value.version }
        : null
    case 'busy':
    case 'lost':
      return isId(key) && isId(value.device) ? { t: value.t, key, device: value.device } : null
    case 'flush':
      return isId(key) && isCount(value.fence) ? { t: 'flush', key, fence: value.fence } : null
    case 'free':
      return isId(key) ? { t: 'free', key } : null
    case 'state':
      return isId(key) && isCount(value.version)
        ? { t: 'state', key, version: value.version }
        : null
    case 'key-wanted': {
      const { device, name, pub } = value
      if (!isId(device) || !isId(name) || !isId(pub)) return null
      return { t: 'key-wanted', device, name, pub }
    }
    case 'key':
      return typeof value.wrapped === 'string' && isCount(value.generation)
        ? { t: 'key', wrapped: value.wrapped, generation: value.generation }
        : null
    case 'key-denied':
      return { t: 'key-denied' }
    default:
      return null
  }
}

function deviceRowOf(value: unknown): DeviceRow | null {
  if (!isRecord(value)) return null
  const { id, name, platform, createdAt, lastSeenAt } = value
  if (!isId(id) || typeof name !== 'string' || typeof platform !== 'string') return null
  if (!isTime(createdAt) || !(lastSeenAt === null || isTime(lastSeenAt))) return null
  return { id, name, platform, createdAt, lastSeenAt }
}

/** `GET /v2/devices`, as a device reads it. */
export function deviceRowsOf(value: unknown): DeviceRow[] | null {
  return listOf(value, deviceRowOf)
}
