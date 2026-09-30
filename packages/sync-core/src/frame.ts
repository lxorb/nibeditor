/** Bytes and a little JSON in one body, without base64.
 *
 *  Sync v2 sends Yjs updates and state vectors in nearly every request, and base64
 *  would make each a third bigger for nothing. So a body is a small framed envelope
 *  (docs/sync-v2.md section 7): a JSON header that says what the request is, with
 *  every binary value in it replaced by `{"$part": n}`, then the binary values
 *  themselves, each with its length in front.
 *
 *      1 byte    version (1)
 *      4 bytes   header length, big-endian
 *      n bytes   header, JSON in UTF-8
 *      4 bytes   number of parts
 *      for each: 4 bytes length, then that many bytes
 *
 *  Big-endian fixed widths rather than varints because a reader in any language gets
 *  them right the first time, and four bytes a part is nothing beside an update.
 *
 *  The room's socket gains two messages of its own under `nib.v2`, framed the way
 *  y-protocols frames its own - a kind, then the body - with kinds far from the ones
 *  y-websocket uses, so a v1 client that hears one drops it as a kind it does not
 *  know (`receive` in packages/rooms/src/wire.ts). */

import type { RoomNews } from './wire'

/** A JSON value whose leaves may also be bytes: what `frame` carries. */
export type Framed =
  | string
  | number
  | boolean
  | null
  | Uint8Array
  | readonly Framed[]
  | { readonly [key: string]: Framed | undefined }

const VERSION = 1
const PART = '$part'

/** The most parts one envelope may say it has: past it, the count is a lie. */
const MOST_PARTS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A value with every byte array replaced by a reference to its part. */
function lifted(value: Framed | undefined, parts: Uint8Array[]): unknown {
  if (value instanceof Uint8Array) {
    parts.push(value)
    return { [PART]: parts.length - 1 }
  }
  if (Array.isArray(value)) return value.map((one: Framed) => lifted(one, parts))
  if (typeof value !== 'object' || value === null) return value

  const out: Record<string, unknown> = {}
  for (const [key, one] of Object.entries(value)) {
    if (one !== undefined) out[key] = lifted(one, parts)
  }
  return out
}

/** A header with every part reference replaced by its bytes, or undefined where a
 *  reference names a part there is not. */
function lowered(value: unknown, parts: readonly Uint8Array[]): unknown {
  if (Array.isArray(value)) return value.map((one: unknown) => lowered(one, parts))
  if (!isRecord(value)) return value

  const keys = Object.keys(value)
  if (keys.length === 1 && keys[0] === PART) {
    const at = value[PART]
    return typeof at === 'number' ? parts[at] : undefined
  }

  const out: Record<string, unknown> = {}
  for (const [key, one] of Object.entries(value)) out[key] = lowered(one, parts)
  return out
}

/** One value as an envelope. */
export function frame(value: Framed): Uint8Array {
  const parts: Uint8Array[] = []
  const header = new TextEncoder().encode(JSON.stringify(lifted(value, parts)))
  const size = 1 + 4 + header.length + 4 + parts.reduce((sum, part) => sum + 4 + part.length, 0)

  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let at = 0
  out[at] = VERSION
  at += 1
  view.setUint32(at, header.length)
  at += 4
  out.set(header, at)
  at += header.length
  view.setUint32(at, parts.length)
  at += 4
  for (const part of parts) {
    view.setUint32(at, part.length)
    at += 4
    out.set(part, at)
    at += part.length
  }
  return out
}

/** An envelope as the value it carries, still unknown until a check has read it; or
 *  null for bytes that are not an envelope at all. Parts are views into `bytes`. */
export function unframe(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fits = (at: number, length: number) => at + length <= bytes.length

  if (!fits(0, 5) || bytes[0] !== VERSION) return null
  const headerLength = view.getUint32(1)
  let at = 5
  if (!fits(at, headerLength + 4)) return null

  let header: unknown
  try {
    header = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at, at + headerLength)),
    )
  } catch {
    // Not JSON, or not UTF-8: not an envelope, and the caller answers 400.
    return null
  }
  at += headerLength

  const count = view.getUint32(at)
  at += 4
  if (count > MOST_PARTS) return null

  const parts: Uint8Array[] = []
  for (let part = 0; part < count; part++) {
    if (!fits(at, 4)) return null
    const length = view.getUint32(at)
    at += 4
    if (!fits(at, length)) return null
    parts.push(bytes.subarray(at, at + length))
    at += length
  }

  return at === bytes.length ? lowered(header, parts) : null
}

/** The room's two v2 messages, as y-websocket numbers message kinds: 0 is sync, 1 is
 *  awareness, 2 and 3 are taken by auth and awareness queries. */
const ACK = 100
const EPOCH = 101

/** "This much of the document is durable": the version and the state vector the room
 *  made durable at its settle. The version as eight bytes, a double, which holds every
 *  whole number a counter will reach. */
export function ackFrame(seq: number, sv: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 8 + sv.length)
  out[0] = ACK
  new DataView(out.buffer).setFloat64(1, seq)
  out.set(sv, 9)
  return out
}

/** "The document starts again at this epoch", sent before the room closes with 4001. */
export function epochFrame(epoch: number, epochBase: string): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify({ epoch, epochBase }))
  const out = new Uint8Array(1 + body.length)
  out[0] = EPOCH
  out.set(body, 1)
  return out
}

/** One of the room's v2 messages, or null for anything else: a y-protocols message,
 *  or bytes that do not read as either of these. */
export function roomNews(bytes: Uint8Array): RoomNews | null {
  if (bytes[0] === ACK) {
    if (bytes.length < 9) return null
    const seq = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(1)
    if (!Number.isSafeInteger(seq) || seq < 0) return null
    return { t: 'ack', seq, sv: bytes.slice(9) }
  }
  if (bytes[0] !== EPOCH) return null

  try {
    const body: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(1)),
    )
    if (!isRecord(body)) return null
    const { epoch, epochBase } = body
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) return null
    if (typeof epochBase !== 'string') return null
    return { t: 'epoch', epoch, epochBase }
  } catch {
    // A frame that says it is an epoch and is not one is dropped like any other.
    return null
  }
}
