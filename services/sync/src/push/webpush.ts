/** Web Push: a message to a browser's push service, encrypted to the subscription
 *  (RFC 8291, `aes128gcm`) and signed as this server (VAPID, RFC 8292).
 *
 *  The browser build subscribes with the VAPID public key the Worker hands out
 *  (`GET /v2/push/key`); its service worker shows what arrives. The push service sees
 *  where it goes and how big it is, never what it says: only the subscription's own
 *  keys open it. */

import { base64url, concat, fromBase64url, p256, signedToken } from './keys'
import type { Delivery } from './send'

const encoder = new TextEncoder()

/** A subscription's two keys, as the browser hands them over. */
export interface SubscriptionKeys {
  p256dh: string
  auth: string
}

/** What the server encrypts with, made fresh for every message unless a test says. */
export interface Sender {
  publicRaw: Uint8Array
  privateKey: CryptoKey
  salt: Uint8Array
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data))
}

/** HKDF with one block of output, which is all RFC 8291 ever asks for. */
async function hkdf(salt: Uint8Array, secret: Uint8Array, info: Uint8Array, length: number) {
  const prk = await hmac(salt, secret)
  const out = await hmac(prk, concat(info, new Uint8Array([1])))
  return out.slice(0, length)
}

/** A sender of its own for one message. */
async function freshSender(): Promise<Sender> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const publicRaw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
  )
  return {
    publicRaw,
    privateKey: pair.privateKey,
    salt: crypto.getRandomValues(new Uint8Array(16)),
  }
}

/** The message body for one subscription: RFC 8291's one record, with its header. */
export async function encrypted(
  plaintext: Uint8Array,
  keys: SubscriptionKeys,
  sender: Sender,
): Promise<Uint8Array> {
  const uaPublic = fromBase64url(keys.p256dh)
  const authSecret = fromBase64url(keys.auth)
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  // `public` is the field Web Crypto reads, on Workers as everywhere; the Workers types
  // spell it `$public` because `public` is a word TypeScript keeps.
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, sender.privateKey, 256))

  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, sender.publicRaw)
  const ikm = await hkdf(authSecret, shared, keyInfo, 32)
  const cek = await hkdf(sender.salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(sender.salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // The one and last record: the words, then the delimiter that says so.
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      concat(plaintext, new Uint8Array([2])),
    ),
  )

  const header = new Uint8Array(21)
  header.set(sender.salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = sender.publicRaw.length
  return concat(header, sender.publicRaw, sealed)
}

/** The server's VAPID keys, from the Worker's settings: the public point as base64url
 *  and the private scalar as base64url. */
export interface Vapid {
  publicKey: string
  privateKey: string
  subject: string
}

/** The `Authorization` header a push service checks: a token for the service's own
 *  origin, good for twelve hours, and the key it is signed with. */
async function vapidHeader(endpoint: string, vapid: Vapid, now: number): Promise<string> {
  const publicRaw = fromBase64url(vapid.publicKey)
  const key = await crypto.subtle.importKey(
    'jwk',
    p256(publicRaw, fromBase64url(vapid.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const token = await signedToken(
    { typ: 'JWT', alg: 'ES256' },
    {
      aud: new URL(endpoint).origin,
      exp: Math.floor(now / 1000) + 12 * 3600,
      sub: vapid.subject,
    },
    key,
  )
  return `vapid t=${token}, k=${base64url(publicRaw)}`
}

/** One message to one subscription. A subscription the service no longer has (404,
 *  410) is gone, and the caller drops it. */
export async function sendWebPush(
  endpoint: string,
  keys: SubscriptionKeys,
  message: Record<string, string>,
  vapid: Vapid,
  options: { now: number; topic?: string; fetch?: typeof fetch },
): Promise<Delivery> {
  const body = await encrypted(encoder.encode(JSON.stringify(message)), keys, await freshSender())
  const headers: Record<string, string> = {
    authorization: await vapidHeader(endpoint, vapid, options.now),
    'content-encoding': 'aes128gcm',
    'content-type': 'application/octet-stream',
    ttl: '86400',
    urgency: 'high',
  }
  // A topic replaces a message of the same name still waiting: a reminder pushed twice
  // reaches the device once. At most 32 base64url characters.
  if (options.topic) headers.topic = options.topic.slice(0, 32)

  const answer = await (options.fetch ?? fetch)(endpoint, { method: 'POST', headers, body })
  if (answer.status === 404 || answer.status === 410) return 'gone'
  return answer.ok ? 'sent' : 'failed'
}
