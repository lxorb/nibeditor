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
 *  documents; a `.url` is a small last-writer-wins file; `file` is any other file,
 *  a blob by hash; `folder` holds the others. */
export type EntryKind = 'note' | 'canvas' | 'pages' | 'url' | 'file' | 'folder'

export const ENTRY_KINDS: readonly EntryKind[] = [
  'note',
  'canvas',
  'pages',
  'url',
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

/** One document a device wants news of: what it has, as a state vector. */
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
 *  vector); or, for a device on an old epoch, the epoch it should be on. */
export type PullAnswer =
  | { id: string; update: Uint8Array }
  | { id: string; epoch: number; epochBase: string }
  | { id: string; refused: DocRefusal }

export interface PullResponse {
  docs: PullAnswer[]
}

/** One document's pending updates on their way up.
 *
 *  `base` is the confirmed state vector they were made on. `checked` is the state
 *  the device classified against after a `moved` (section 5.4): the account applies
 *  a push that names it only if it has not moved again since. `at` is when the
 *  newest of the updates was made, on the device's clock: what `minor` compares, and
 *  nothing else. */
export interface PushDoc {
  id: string
  epoch: number
  base: Uint8Array
  checked?: Uint8Array
  update: Uint8Array
  at: number
}

/** `POST /v2/docs/push`. */
export interface PushRequest {
  docs: PushDoc[]
}

/** Per document: applied and durable (`sv` is the account's state now); moved on
 *  since `base` (here is what the device is missing, classify and come back); on a
 *  newer epoch; or refused. */
export type PushAnswer =
  | { id: string; ok: true; sv: Uint8Array }
  | { id: string; moved: Uint8Array; sv: Uint8Array }
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

/** What the room says beyond y-protocols: the state it has made durable (at each
 *  settle), and the epoch it is moving to (before it closes with 4001). */
export type RoomNews =
  { t: 'ack'; sv: Uint8Array } | { t: 'epoch'; epoch: number; epochBase: string }

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
// Checks and codecs

/** A JSON value whose leaves may also be bytes: what `frame` carries. */
export type Framed =
  | string
  | number
  | boolean
  | null
  | Uint8Array
  | readonly Framed[]
  | { readonly [key: string]: Framed | undefined }

export function frame(_value: Framed): Uint8Array {
  throw new Error('not yet')
}

export function unframe(_bytes: Uint8Array): unknown {
  throw new Error('not yet')
}

export function roomNews(_frame: Uint8Array): RoomNews | null {
  throw new Error('not yet')
}

export function ackFrame(_sv: Uint8Array): Uint8Array {
  throw new Error('not yet')
}

export function epochFrame(_epoch: number, _epochBase: string): Uint8Array {
  throw new Error('not yet')
}

export function opOf(_value: unknown): Op | null {
  throw new Error('not yet')
}

export function opsRequestOf(_value: unknown): OpsRequest | null {
  throw new Error('not yet')
}

export function opsResponseOf(_value: unknown): OpsResponse | null {
  throw new Error('not yet')
}

export function feedPageOf(_value: unknown): FeedPage | null {
  throw new Error('not yet')
}

export function pullRequestOf(_value: unknown): PullRequest | null {
  throw new Error('not yet')
}

export function pullResponseOf(_value: unknown): PullResponse | null {
  throw new Error('not yet')
}

export function pushRequestOf(_value: unknown): PushRequest | null {
  throw new Error('not yet')
}

export function pushResponseOf(_value: unknown): PushResponse | null {
  throw new Error('not yet')
}

export function keepRequestOf(_value: unknown): KeepRequest | null {
  throw new Error('not yet')
}

export function snapshotPageOf(_value: unknown): SnapshotPage | null {
  throw new Error('not yet')
}

export function deviceFrameOf(_value: unknown): DeviceFrame | null {
  throw new Error('not yet')
}

export function hubFrameOf(_value: unknown): HubFrame | null {
  throw new Error('not yet')
}

export function deviceRowsOf(_value: unknown): DeviceRow[] | null {
  throw new Error('not yet')
}
