/** What this device and its account's hub say to each other: JSON text frames, one
 *  message a frame, and `beat` beside them, which the service answers `ok` without
 *  waking anybody. The hub's own half is services/sync/src/hub/frames.ts; these are the
 *  same shapes, read from the other side, and docs/sync-v2.md section 7 is both.
 *
 *  Read here and nowhere else. A frame from the hub is unknown until `readHubFrame` has
 *  looked at it, and one this version cannot read is dropped rather than half
 *  understood, the way the hub drops one of ours. Pure, so the reading is tested
 *  without a socket. */

import { chatPokeOf, type ChatPoke } from '@nib/chats/wire'
import { isRecord } from '../stored'

/** The heartbeat and its answer, as the runtime on the other end answers it. */
export const BEAT = 'beat'
export const BEAT_ANSWER = 'ok'

/** A lease key or a chunk name: an HMAC this device made, which the service never
 *  reads. The hub's own rule for them. */
const OPAQUE = /^[A-Za-z0-9_-]{16,128}$/

/** A device's id, as the hub takes one. */
export const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

/** What this device says. `release` and `flushed` may carry the version last uploaded,
 *  which the hub does not read; it counts versions itself. */
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

/** What the hub says. */
export type FromHub =
  | { t: 'poke'; space: string; seq: number }
  | { t: 'granted'; key: string; fence: number; version: number; rotate: boolean }
  | { t: 'busy'; key: string; device: string; name: string }
  | { t: 'flush'; key: string; fence: number }
  | { t: 'lost'; key: string; device: string; name: string }
  | { t: 'free'; key: string }
  | { t: 'state'; key: string; version: number }
  | { t: 'key-wanted'; device: string; name: string; pub: string }
  | { t: 'key'; wrapped: string; generation: number }
  | { t: 'key-denied' }
  | { t: 'key-settled'; device: string }
  | { t: 'refused'; to: string; key: string | null; error: string }
  /** A chat moved while none of this account's devices had it open (docs/chats.md
   *  4.4): read by `@nib/chats/wire`, which the hub's own half writes it by. */
  | ChatPoke

export type HubType = FromHub['t']

/** One kind of frame, by its `t`. */
export type HubFrame<T extends HubType> = Extract<FromHub, { t: T }>

const text = (value: unknown): value is string => typeof value === 'string'
const whole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const opaque = (value: unknown): value is string => text(value) && OPAQUE.test(value)
const device = (value: unknown): value is string => text(value) && DEVICE.test(value)

/** A frame from the hub, or null for anything that is not one. */
export function readHubFrame(said: string): FromHub | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(said)
  } catch {
    // `ok` answering a beat, or something this version does not speak.
    return null
  }
  if (!isRecord(parsed)) return null

  const one = parsed
  switch (one.t) {
    case 'poke':
      return text(one.space) && whole(one.seq)
        ? { t: 'poke', space: one.space, seq: one.seq }
        : null

    case 'granted':
      return opaque(one.key) && whole(one.fence) && whole(one.version)
        ? {
            t: 'granted',
            key: one.key,
            fence: one.fence,
            version: one.version,
            rotate: one.rotate === true,
          }
        : null

    case 'busy':
    case 'lost':
      return opaque(one.key) && device(one.device)
        ? { t: one.t, key: one.key, device: one.device, name: text(one.name) ? one.name : '' }
        : null

    case 'flush':
      return opaque(one.key) && whole(one.fence)
        ? { t: 'flush', key: one.key, fence: one.fence }
        : null

    case 'free':
      return opaque(one.key) ? { t: 'free', key: one.key } : null

    case 'state':
      return opaque(one.key) && whole(one.version)
        ? { t: 'state', key: one.key, version: one.version }
        : null

    case 'key-wanted':
      return device(one.device) && text(one.pub) && one.pub.length <= 128
        ? {
            t: 'key-wanted',
            device: one.device,
            name: text(one.name) ? one.name : '',
            pub: one.pub,
          }
        : null

    case 'key':
      return text(one.wrapped) && whole(one.generation) && one.generation >= 1
        ? { t: 'key', wrapped: one.wrapped, generation: one.generation }
        : null

    case 'key-denied':
      return { t: 'key-denied' }

    case 'key-settled':
      return device(one.device) ? { t: 'key-settled', device: one.device } : null

    case 'refused':
      return text(one.to) && text(one.error)
        ? { t: 'refused', to: one.to, key: opaque(one.key) ? one.key : null, error: one.error }
        : null

    case 'chat':
      return chatPokeOf(one)

    default:
      return null
  }
}
