/** What a device and its hub say to each other: JSON text frames, one message a
 *  frame, and `beat` beside them, which the runtime answers without waking anybody.
 *
 *  Read here and nowhere else. Everything a device sends is unknown until it has
 *  been through `readFrame`, which answers a typed message or nothing: a frame this
 *  version cannot read is dropped rather than half understood, and none of them
 *  carries a time, because every time the hub decides by is its own. See
 *  docs/sync-v2.md section 7. */

/** A lease key or a chunk name: an HMAC a device made, which the service never
 *  reads. Held to a shape all the same, because it becomes part of an object's name
 *  in the bucket, and a key with a slash in it could reach into another's. */
export const OPAQUE = /^[A-Za-z0-9_-]{16,128}$/

/** A device's id, made by the device and kept in its sync store. */
export const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

/** A public key or a wrapped key, as base64 of either alphabet. An X25519 key is
 *  44 characters and a sealed box of a 32-byte key under 200; the ceilings leave
 *  room and stop a frame from being a place to keep a novel. */
const PUBLIC_KEY = /^[A-Za-z0-9+/_=-]{16,128}$/
const WRAPPED = /^[A-Za-z0-9+/_=-]{16,1024}$/

/** How long a frame may be. The longest a correct device sends is a `grant-key`
 *  with a wrapped key in it. */
const MOST_FRAME = 4096

/** The longest name, platform and version a `hello` keeps. */
const MOST_NAME = 120
const MOST_PLATFORM = 24
const MOST_APP = 32

export type FromDevice =
  | { t: 'hello'; device: string; name: string; platform: string; app: string; pub?: string }
  | { t: 'active' }
  | { t: 'idle' }
  | { t: 'acquire'; key: string; take: boolean }
  | { t: 'release'; key: string }
  | { t: 'flushed'; key: string }
  | { t: 'want-key'; pub: string }
  | { t: 'grant-key'; to: string; wrapped: string; generation: number }
  | { t: 'deny-key'; to: string }

export type FromHub =
  | { t: 'poke'; space: string; seq: number }
  | { t: 'granted'; key: string; fence: number; version: number; rotate?: true }
  | { t: 'busy'; key: string; device: string; name: string }
  | { t: 'flush'; key: string; fence: number }
  | { t: 'lost'; key: string; device: string; name: string }
  | { t: 'free'; key: string }
  | { t: 'state'; key: string; version: number }
  | { t: 'key-wanted'; device: string; name: string; pub: string }
  | { t: 'key'; wrapped: string; generation: number }
  | { t: 'key-denied' }
  | { t: 'key-settled'; device: string }
  | { t: 'refused'; to: FromDevice['t']; key?: string; error: string }

type Fields = Record<string, unknown>

const text = (fields: Fields, name: string, most: number): string | null => {
  const value = fields[name]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= most ? trimmed : null
}

const matching = (fields: Fields, name: string, shape: RegExp): string | null => {
  const value = fields[name]
  return typeof value === 'string' && shape.test(value) ? value : null
}

/** A message from a device, or null for anything that is not one. `release` and
 *  `flushed` carry the version the device last uploaded, and it is not read: the
 *  hub knows which version it accepted, and that is the one it hands on. */
export function readFrame(said: string): FromDevice | null {
  if (said.length > MOST_FRAME) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(said)
  } catch {
    // Not JSON, so not a message: `beat` never reaches here, and nothing else a
    // correct device sends is anything but an object.
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const fields = parsed as Fields
  switch (fields.t) {
    case 'active':
    case 'idle':
      return { t: fields.t }

    case 'hello': {
      const device = matching(fields, 'device', DEVICE)
      const name = text(fields, 'name', MOST_NAME)
      const platform = text(fields, 'platform', MOST_PLATFORM)
      const app = text(fields, 'app', MOST_APP)
      if (!device || !name || !platform || !app) return null

      const pub = fields.pub === undefined ? undefined : matching(fields, 'pub', PUBLIC_KEY)
      if (pub === null) return null
      return { t: 'hello', device, name, platform, app, ...(pub ? { pub } : {}) }
    }

    case 'acquire': {
      const key = matching(fields, 'key', OPAQUE)
      return key ? { t: 'acquire', key, take: fields.take === true } : null
    }

    case 'release':
    case 'flushed': {
      const key = matching(fields, 'key', OPAQUE)
      return key ? { t: fields.t, key } : null
    }

    case 'want-key': {
      const pub = matching(fields, 'pub', PUBLIC_KEY)
      return pub ? { t: 'want-key', pub } : null
    }

    case 'grant-key': {
      const to = matching(fields, 'to', DEVICE)
      const wrapped = matching(fields, 'wrapped', WRAPPED)
      const generation = fields.generation
      if (!to || !wrapped || !isGeneration(generation)) return null
      return { t: 'grant-key', to, wrapped, generation }
    }

    case 'deny-key': {
      const to = matching(fields, 'to', DEVICE)
      return to ? { t: 'deny-key', to } : null
    }

    default:
      return null
  }
}

/** A generation of the web key: a whole number from one. */
export function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

/** The one thing every socket write goes through. A socket the runtime has
 *  already given up on throws on `send`, and its close handler is what deals with
 *  that; nothing a hub says to one device is worth failing the others over. */
export function say(socket: WebSocket, frame: FromHub): void {
  try {
    socket.send(JSON.stringify(frame))
  } catch {
    // Closing or closed: see above.
  }
}
