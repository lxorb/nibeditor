/** Bytes, and the two shapes they arrive in.
 *
 *  The app moves binary data over three roads: the IPC, which hands raw bytes
 *  to the desktop and a `data:` URI to the browser; the clipboard and the file
 *  dialogs, which speak `ArrayBuffer`; and storage, which keeps base64 text.
 *  Everything that has to cross between them does it here, once, rather than
 *  spelling the same loop out at each call site. */

import { invoke, isNative } from './tauri'

/** Base64 as bytes. Whitespace in the text is skipped, which is what lets a
 *  `data:` URI wrapped across lines still decode. */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  return bytes
}

/** Bytes as base64. Written in chunks: one `String.fromCharCode` over a
 *  megabyte of arguments overflows the call stack. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''

  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  }

  return btoa(binary)
}

/** SHA-256 as hex, of bytes or of text as UTF-8. The one digest the app names
 *  things by: a stored picture, a paper's cached text, a published theme, a note
 *  the account holds and the room it is edited in all agree on it, so it is
 *  worked out in one place. */
export async function sha256(data: string | Uint8Array | ArrayBuffer): Promise<string> {
  // A `Uint8Array` says which kind of buffer it sits on, and `digest` takes only
  // one on a plain `ArrayBuffer`. What arrives here came off a disk, out of a row
  // or out of an encoder, and none of those hands back shared memory.
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer> | ArrayBuffer,
  )

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A `data:` URI pulled apart, or null when the text is not one. */
export function parseDataUri(uri: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(uri)
  if (!match) return null

  // `data:,x` is a URI with no type at all, and the standard's own default for
  // that is text; anything else is the type as written.
  const mime = match[1] === '' ? 'application/octet-stream' : (match[1] ?? '')
  const body = match[3] ?? ''

  return { mime, bytes: match[2] ? fromBase64(body) : new TextEncoder().encode(decodeURI(body)) }
}

/** The bytes of a file in a space.
 *
 *  Over the IPC as bytes in the app, which is what makes a thirty megabyte PDF
 *  one copy rather than a hundred megabytes of JSON numbers. The browser keeps
 *  its files as text and answers with a `data:` URI, so there they are decoded
 *  on this side. */
export async function fileBytes(path: string): Promise<Uint8Array> {
  if (isNative) return new Uint8Array(await invoke<ArrayBuffer>('read_file', { path }))

  const uri = await invoke<string>('read_asset', { path })
  return parseDataUri(uri)?.bytes ?? new Uint8Array()
}
