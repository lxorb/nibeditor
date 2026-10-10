/** Everything the online terminal says over its two sockets, as types, as checks and
 *  as bytes (docs/online-terminal.md, 4.6).
 *
 *  Two links, one module, for the reason `@nib/sync-core/wire` gives: every end reads
 *  what another end wrote, and a shape spelled twice is two shapes a year later.
 *
 *  - **The app's socket**, `GET /v2/online/:term/socket`, between a nib and the
 *    Worker's `Machine`. Control frames are JSON text. Output is a binary frame, eight
 *    bytes of `seq` and then the bytes, because output is nearly all a socket carries
 *    and JSON would escape a third of it. Raw input (a paste of bytes, a key the
 *    terminal encodes itself) may go up as a binary frame too.
 *  - **The link**, one socket between `Machine` and the machine's `nibd`, every frame
 *    naming its session. Each frame is a `@nib/sync-core/wire` envelope, which carries
 *    a little JSON and raw bytes side by side, so input and output cross it unescaped.
 *
 *  A session's output is one stream of bytes, and `seq` is an offset into it: an
 *  output frame's `seq` is the offset of its first byte, so the next frame starts at
 *  `seq + data.length`; a screen's `seq` is the offset everything before which it
 *  shows; a `hello`'s `since` is the offset of the first byte its client has not
 *  drawn. Offsets travel as a float64, as the rooms' ACK does: it holds every whole
 *  number a session will print.
 *
 *  Nothing is coerced: a frame that does not check is dropped, as the hub drops one. */

import { frame, unframe } from '@nib/sync-core/wire'
import type { Activity, MachineState, SleepReason } from './types'
import { isLoopbackUrl, isWebUrl } from './urls'

// ---------------------------------------------------------------------------
// Bounds (4.6, 4.8)

/** Sockets one session takes. */
export const MOST_SOCKETS = 25
/** Sessions one machine runs; the ninth is refused with the list of the eight. */
export const MOST_SESSIONS = 8
/** Input frames a person may send a second. */
export const INPUT_RATE = 100
/** The largest input frame, a paste included. */
export const MOST_INPUT = 64 * 1024
/** How far behind a socket may fall before it is sent a fresh screen instead. */
export const MOST_BEHIND = 1024 * 1024
/** The output `nibd` keeps per session to answer a reconnect with. */
export const KEPT_OUTPUT = 1024 * 1024
/** Lines of scrollback a session's screen keeps: the local terminal's. */
export const SCROLLBACK = 5000
/** The widest and tallest screen anything here will size a pty to. */
export const MOST_CELLS = 1000

/** Input as frames none of which is larger than `MOST_INPUT` once it is UTF-8: a paste
 *  of a long log is many frames, in order, never one refused as `large`. Never cut
 *  inside a character, so every frame is text on its own. */
export function inputChunks(data: string, most = MOST_INPUT): string[] {
  const chunks: string[] = []
  let from = 0
  let bytes = 0
  for (let at = 0; at < data.length;) {
    const code = data.codePointAt(at) ?? 0
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (bytes + size > most && at > from) {
      chunks.push(data.slice(from, at))
      from = at
      bytes = 0
    }
    bytes += size
    at += code > 0xffff ? 2 : 1
  }
  if (from < data.length || chunks.length === 0) chunks.push(data.slice(from))
  return chunks
}

/** The kinds of picture a paste carries to the machine, each the end of its file's name
 *  there: what a coding agent reads as an image from a path (docs/online-terminal.md
 *  4.13). */
export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp'

export const IMAGE_KINDS: readonly ImageKind[] = ['png', 'jpeg', 'gif', 'webp']

/** The largest picture a paste carries up: a screenshot of a big screen is a few
 *  megabytes, and an agent scales anything past that down before it sends it on. */
export const MOST_IMAGE = 16 * 1024 * 1024

/** A picture's bytes a frame at most: `MOST_INPUT` once they are base64, so a picture is
 *  paced and bounded as a paste is. */
export const IMAGE_PART = (MOST_INPUT / 4) * 3

/** What a picture on its way is called until the machine has it, and what its file is
 *  named there: the app's own random letters and digits, so the name is never a path. */
export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{16,64}$/.test(value)
}

/** The app socket's address for a `.term` file's id. */
export function socketPath(term: string): string {
  return `/v2/online/${encodeURIComponent(term)}/socket`
}

// ---------------------------------------------------------------------------
// The app's socket

/** What a socket is refused with: the space gives it no role or the file is gone; it
 *  may not type; the account is not on the allow-list; the month's allowance or the
 *  service's budget is used; the service is off; the machine is held by a flag; the
 *  machine has its eight sessions; a rate limit; a frame too large. */
export type Refusal =
  'gone' | 'role' | 'list' | 'allowance' | 'budget' | 'off' | 'flag' | 'sessions' | 'rate' | 'large'

export const REFUSALS: readonly Refusal[] = [
  'gone',
  'role',
  'list',
  'allowance',
  'budget',
  'off',
  'flag',
  'sessions',
  'rate',
  'large',
]

/** Why a machine is down, as its tab is told: the awake rule's reasons, a flag held
 *  by Emil, a Stop by its owner or the admin, or a restart nobody asked for. */
export type DownReason = SleepReason | 'flag' | 'stopped' | 'restart'

const DOWN_REASONS: readonly DownReason[] = [
  'idle',
  'allowance',
  'budget',
  'off',
  'flag',
  'stopped',
  'restart',
]

const MACHINE_STATES: readonly MachineState[] = ['asleep', 'starting', 'awake', 'stopping']

/** A saved screen drawn back after a boot: when it was saved, and the program that
 *  was in front then (`claude` or `codex` is what Resume offers to continue). */
export interface Restored {
  at: number
  program: string | null
}

/** One person on a session: who, on which device, and whether they typed in the last
 *  two seconds. */
export interface Person {
  who: string
  device: string
  typing: boolean
}

/** What the app says, as text. `hello` opens: the size of its screen, and the offset
 *  it last drew, if it drew any. `start` begins a new shell in a session whose shell
 *  ended; `resume` types the saved agent's own continue command. */
export type ClientFrame =
  | { t: 'hello'; since?: number; cols: number; rows: number }
  | { t: 'in'; data: string }
  | { t: 'size'; cols: number; rows: number }
  | { t: 'start' }
  | { t: 'resume' }
  /** A tab this nib opened for the machine landed on the loopback page the opened
   *  address sent it back to: that request, made on the machine instead (urls.ts). */
  | { t: 'callback'; url: string }
  /** A part of a picture pasted into the session, base64, at most `IMAGE_PART` bytes; the
   *  machine writes it to a file once the `last` arrives and answers with an `image`. */
  | { t: 'image'; id: string; kind: ImageKind; part: string; last: boolean }

/** What `Machine` says to the app, as text. Output is not here: it is binary
 *  (`outFrame`).
 *
 *  - `screen`: the whole screen as `@xterm/headless`'s serialise addon writes it, up
 *    to `seq`, with `restored` when it came back from a save;
 *  - `size`: the pty's size, and who set it (null before anybody typed);
 *  - `people`: everybody on the session now;
 *  - `typed`: whose input the output from `seq` answers, for the cursor's colour;
 *  - `program`: the program in front, the title it set, and its mark by the local
 *    terminal's rules (`naming.ts`'s `TerminalMark`), each null when there is none;
 *  - `machine`: the machine's state, and why it is down;
 *  - `role`: whether this socket may type;
 *  - `ended`: the shell ended with this code (null for a signal);
 *  - `refused`: what was asked was refused, and why;
 *  - `browse`: a program on the machine asked for a browser; to one socket of the
 *    machine's owner only;
 *  - `called`: a `callback` was made on the machine, and the HTTP status it was
 *    answered with, 0 where nothing answered;
 *  - `image`: a pasted picture is a file on the machine now, at `path`, or could not be
 *    written (null); to the sockets that may type, the one that sent it among them. */
export type ServerFrame =
  | {
      t: 'screen'
      seq: number
      cols: number
      rows: number
      data: string
      restored?: Restored
    }
  | { t: 'size'; cols: number; rows: number; by: string | null }
  | { t: 'people'; people: Person[] }
  | { t: 'typed'; who: string; seq: number }
  | { t: 'program'; name: string | null; title: string | null; mark: string | null }
  | { t: 'machine'; state: MachineState; reason?: DownReason }
  | { t: 'role'; type: boolean }
  | { t: 'ended'; code: number | null }
  | { t: 'refused'; error: Refusal }
  | { t: 'browse'; url: string }
  | { t: 'called'; url: string; status: number }
  | { t: 'image'; id: string; path: string | null }
  | { t: 'note'; note: Note }

/** Something worth one line under the screen: `restore`, the home could not be put back
 *  from its backup, so this wake has the image's fresh one; `disk`, the machine's disk
 *  is nearly full (`diskFull`), which is how a machine froze on 2026-10-06. */
export type Note = 'restore' | 'disk'

const NOTES: readonly Note[] = ['restore', 'disk']

/** A text frame of either side, as it goes on the socket. */
export function text(value: ClientFrame | ServerFrame): string {
  return JSON.stringify(value)
}

/** Output on the app's socket: eight bytes of `seq`, then the bytes. */
export function outFrame(seq: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length)
  new DataView(out.buffer).setFloat64(0, seq)
  out.set(data, 8)
  return out
}

/** An output frame as its offset and bytes, or null for one too short or with an
 *  offset that is no offset. The bytes are a view into `bytes`. */
export function outOf(bytes: Uint8Array): { seq: number; data: Uint8Array } | null {
  if (bytes.length < 8) return null
  const seq = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0)
  return isCount(seq) ? { seq, data: bytes.subarray(8) } : null
}

// ---------------------------------------------------------------------------
// The link between `Machine` and `nibd`

/** What `Machine` tells `nibd`: open a session (or reattach to one that exists, a
 *  restored one included) at a size; input for it; a new size; send what came after
 *  an offset (or the screen, if that is no longer kept); end it; and save every
 *  screen because the machine is going to sleep. */
export type MachineFrame =
  | { t: 'open'; session: string; cols: number; rows: number }
  | { t: 'in'; session: string; data: Uint8Array }
  | { t: 'size'; session: string; cols: number; rows: number }
  | { t: 'want'; session: string; since: number }
  | { t: 'close'; session: string }
  | { t: 'sleep' }
  | { t: 'callback'; session: string; url: string }
  /** A part of a picture pasted in the session, its bytes; see `ClientFrame`. */
  | { t: 'image'; session: string; id: string; kind: ImageKind; data: Uint8Array; last: boolean }
  /** Are you there: answered with `pong` at once. */
  | { t: 'ping' }
  /** Every screen saved, then `nibd` ends itself for its supervisor to start again: the
   *  owner's Restart, and the health path's answer to a `nibd` that keeps going quiet. */
  | { t: 'restart' }

/** What `nibd` tells `Machine`: output from an offset; a whole screen; the program in
 *  front; a shell that ended; the last 30 seconds' activity; that every screen is
 *  saved, after a `sleep` or a SIGTERM; an address a program in a session asked a
 *  browser for (`nib-open`); how a `callback` was answered; and where a pasted picture
 *  was written, or null where it could not be. */
export type NibdFrame =
  | { t: 'out'; session: string; seq: number; data: Uint8Array }
  | {
      t: 'screen'
      session: string
      seq: number
      cols: number
      rows: number
      data: string
      restored?: Restored
    }
  | {
      t: 'program'
      session: string
      name: string | null
      title: string | null
      mark: string | null
    }
  | { t: 'ended'; session: string; code: number | null }
  | { t: 'activity'; activity: Activity }
  | { t: 'saved' }
  | { t: 'browse'; session: string; url: string }
  | { t: 'called'; session: string; url: string; status: number }
  | { t: 'image'; session: string; id: string; path: string | null }
  | { t: 'pong' }

/** How often `Machine` asks `nibd` whether it is there, and how long a link may say
 *  nothing at all before `Machine` counts it dead and makes it again: four pings
 *  missed. A ping is a few bytes on a link that is open anyway, and a terminal on a dead
 *  link looks live with keys going nowhere until this runs out (issue 208: it was 40 s
 *  and a 15 s ping, up to 55 s). */
export const PING_EVERY = 5_000
export const QUIET_FOR = 20_000

/** How long `nibd` lets a link that pinged say nothing before it drops it, to read its
 *  ptys again. Longer than `QUIET_FOR`, so a `Machine` deployed before it, which pinged
 *  every 15 s, is never dropped between two of its pings; a new link replaces the old
 *  one at once anyway. `nibd` reports activity every 30 s, so even a `Machine` that
 *  predates the ping hears it more often than this while it answers. */
export const SILENT_FOR = 40_000

/** A link frame as its bytes. */
export function linkFrame(value: MachineFrame | NibdFrame): Uint8Array {
  return frame(value)
}

// ---------------------------------------------------------------------------
// Checks: unknown in, the frame or null out

/** The longest id, device or person anything here carries, as in sync-core. */
const LONGEST_ID = 200
/** The longest program name or title kept. */
const LONGEST_TITLE = 1024
/** The largest serialised screen: 5,000 lines of a wide screen, colours and all. */
const MOST_SCREEN = 32 * 1024 * 1024

type Fields = Record<string, unknown>

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LONGEST_ID
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCells(value: unknown): value is number {
  return isCount(value) && value >= 1 && value <= MOST_CELLS
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isShort(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= LONGEST_TITLE)
}

function isCode(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value))
}

function isScreen(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MOST_SCREEN
}

/** An HTTP status, or 0 for none. */
function isStatus(value: unknown): value is number {
  return isCount(value) && value <= 999
}

/** A path on the machine: absolute, and no longer than a title. */
function isPathOrNone(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && value.startsWith('/') && value.length <= LONGEST_TITLE)
  )
}

/** Base64 text no longer than an input frame. */
function isPart(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MOST_INPUT && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
}

function oneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.some((one) => one === value)
}

/** Parsed JSON, or undefined for text that is not JSON. */
function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // Not JSON: not a frame, and the caller drops it.
    return undefined
  }
}

function restoredOf(value: unknown): Restored | null {
  if (!isRecord(value) || !isTime(value.at) || !isShort(value.program)) return null
  return { at: value.at, program: value.program }
}

/** A screen's fields, shared by both links; null if any fails. */
function screenOf(
  value: Fields,
): { seq: number; cols: number; rows: number; data: string; restored?: Restored } | null {
  const { seq, cols, rows, data } = value
  if (!isCount(seq) || !isCells(cols) || !isCells(rows) || !isScreen(data)) return null
  if (value.restored === undefined) return { seq, cols, rows, data }
  const restored = restoredOf(value.restored)
  return restored ? { seq, cols, rows, data, restored } : null
}

function programOf(
  value: Fields,
): { name: string | null; title: string | null; mark: string | null } | null {
  const { name, title, mark } = value
  if (!isShort(name) || !isShort(title) || !(mark === null || isId(mark))) return null
  return { name, title, mark }
}

function personOf(value: unknown): Person | null {
  if (!isRecord(value) || !isId(value.who) || !isId(value.device)) return null
  if (typeof value.typing !== 'boolean') return null
  return { who: value.who, device: value.device, typing: value.typing }
}

function activityOf(value: unknown): Activity | null {
  if (!isRecord(value)) return null
  const { at, output, cpu, net, homeBytes, disk } = value
  if (!isTime(at) || !isCount(output) || !isCount(net) || !isCount(homeBytes)) return null
  if (typeof cpu !== 'number' || !Number.isFinite(cpu) || cpu < 0) return null
  if (disk === undefined) return { at, output, cpu, net, homeBytes }
  // Said by a `nibd` new enough to: the disk, or nothing of it where it does not read.
  if (!isRecord(disk) || !isCount(disk.used) || !isCount(disk.total)) return null
  return { at, output, cpu, net, homeBytes, disk: { used: disk.used, total: disk.total } }
}

/** A text frame from the app, as `Machine` reads it. */
export function clientFrameOf(raw: string): ClientFrame | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'hello': {
      const { since, cols, rows } = value
      if (!isCells(cols) || !isCells(rows)) return null
      if (since === undefined) return { t: 'hello', cols, rows }
      return isCount(since) ? { t: 'hello', since, cols, rows } : null
    }
    case 'in':
      return typeof value.data === 'string' && value.data.length <= MOST_INPUT
        ? { t: 'in', data: value.data }
        : null
    case 'size':
      return isCells(value.cols) && isCells(value.rows)
        ? { t: 'size', cols: value.cols, rows: value.rows }
        : null
    case 'start':
    case 'resume':
      return { t: value.t }
    case 'callback':
      return isLoopbackUrl(value.url) ? { t: 'callback', url: value.url } : null
    case 'image': {
      const { id, kind, part, last } = value
      if (!isImageId(id) || !oneOf(IMAGE_KINDS, kind) || !isPart(part)) return null
      return typeof last === 'boolean' ? { t: 'image', id, kind, part, last } : null
    }
    default:
      return null
  }
}

/** A text frame from `Machine`, as the app reads it. */
export function serverFrameOf(raw: string): ServerFrame | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'screen': {
      const screen = screenOf(value)
      return screen ? { t: 'screen', ...screen } : null
    }
    case 'size': {
      const { cols, rows, by } = value
      if (!isCells(cols) || !isCells(rows) || !(by === null || isId(by))) return null
      return { t: 'size', cols, rows, by }
    }
    case 'people': {
      if (!Array.isArray(value.people) || value.people.length > MOST_SOCKETS) return null
      const people: Person[] = []
      for (const one of value.people) {
        const person = personOf(one)
        if (!person) return null
        people.push(person)
      }
      return { t: 'people', people }
    }
    case 'typed':
      return isId(value.who) && isCount(value.seq)
        ? { t: 'typed', who: value.who, seq: value.seq }
        : null
    case 'program': {
      const program = programOf(value)
      return program ? { t: 'program', ...program } : null
    }
    case 'machine': {
      const { state, reason } = value
      if (!oneOf(MACHINE_STATES, state)) return null
      if (reason === undefined) return { t: 'machine', state }
      return oneOf(DOWN_REASONS, reason) ? { t: 'machine', state, reason } : null
    }
    case 'role':
      return typeof value.type === 'boolean' ? { t: 'role', type: value.type } : null
    case 'ended':
      return isCode(value.code) ? { t: 'ended', code: value.code } : null
    case 'refused':
      return oneOf(REFUSALS, value.error) ? { t: 'refused', error: value.error } : null
    case 'browse':
      return isWebUrl(value.url) ? { t: 'browse', url: value.url } : null
    case 'called':
      return isLoopbackUrl(value.url) && isStatus(value.status)
        ? { t: 'called', url: value.url, status: value.status }
        : null
    case 'image':
      return isImageId(value.id) && isPathOrNone(value.path)
        ? { t: 'image', id: value.id, path: value.path }
        : null
    case 'note':
      return oneOf(NOTES, value.note) ? { t: 'note', note: value.note } : null
    default:
      return null
  }
}

/** A link frame from `Machine`, as `nibd` reads it. */
export function machineFrameOf(bytes: Uint8Array): MachineFrame | null {
  const value = unframe(bytes)
  if (!isRecord(value)) return null
  if (value.t === 'sleep' || value.t === 'ping' || value.t === 'restart') return { t: value.t }

  const { session } = value
  if (!isId(session)) return null
  switch (value.t) {
    case 'open':
    case 'size':
      return isCells(value.cols) && isCells(value.rows)
        ? { t: value.t, session, cols: value.cols, rows: value.rows }
        : null
    case 'in':
      return value.data instanceof Uint8Array && value.data.length <= MOST_INPUT
        ? { t: 'in', session, data: value.data }
        : null
    case 'want':
      return isCount(value.since) ? { t: 'want', session, since: value.since } : null
    case 'close':
      return { t: 'close', session }
    case 'callback':
      return isLoopbackUrl(value.url) ? { t: 'callback', session, url: value.url } : null
    case 'image': {
      const { id, kind, data, last } = value
      if (!isImageId(id) || !oneOf(IMAGE_KINDS, kind) || typeof last !== 'boolean') return null
      return data instanceof Uint8Array && data.length <= IMAGE_PART
        ? { t: 'image', session, id, kind, data, last }
        : null
    }
    default:
      return null
  }
}

/** A link frame from `nibd`, as `Machine` reads it. */
export function nibdFrameOf(bytes: Uint8Array): NibdFrame | null {
  const value = unframe(bytes)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'activity': {
      const activity = activityOf(value.activity)
      return activity ? { t: 'activity', activity } : null
    }
    case 'saved':
    case 'pong':
      return { t: value.t }
    default:
      break
  }

  const { session } = value
  if (!isId(session)) return null
  switch (value.t) {
    case 'out':
      return isCount(value.seq) && value.data instanceof Uint8Array
        ? { t: 'out', session, seq: value.seq, data: value.data }
        : null
    case 'screen': {
      const screen = screenOf(value)
      return screen ? { t: 'screen', session, ...screen } : null
    }
    case 'program': {
      const program = programOf(value)
      return program ? { t: 'program', session, ...program } : null
    }
    case 'ended':
      return isCode(value.code) ? { t: 'ended', session, code: value.code } : null
    case 'browse':
      return isWebUrl(value.url) ? { t: 'browse', session, url: value.url } : null
    case 'called':
      return isLoopbackUrl(value.url) && isStatus(value.status)
        ? { t: 'called', session, url: value.url, status: value.status }
        : null
    case 'image':
      return isImageId(value.id) && isPathOrNone(value.path)
        ? { t: 'image', session, id: value.id, path: value.path }
        : null
    default:
      return null
  }
}
