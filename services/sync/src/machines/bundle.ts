/** The machine's bundle (docs/online-terminal.md 4.15): `nibd` and every file install.sh
 *  puts in place, as the gzipped tar services/machine/build.ts writes. The Worker carries
 *  it inside itself (entry.ts imports it as a Data module and hands it here), so the
 *  `nibd` a server runs is always the one this Worker was built with.
 *
 *  Served without a session, since a server at its first boot has none: `GET
 *  /v2/online/machine/current` says the bundle's SHA-256, and `GET
 *  /v2/online/machine/<sha>.bin` is the bytes, immutable. The code is the repository's,
 *  and every server checks what it fetched against the SHA-256 its cloud-init or its
 *  updater was given before it runs any of it. */

import { Hono } from 'hono'
import type { Env } from '../types'

let bytes: ArrayBuffer | null = null
let digest: Promise<string> | null = null

/** Set once, by entry.ts, as the module loads. */
export function carry(bundle: ArrayBuffer): void {
  bytes = bundle
  digest = null
}

/** The bundle's SHA-256 in hex, or null in a Worker that carries none (the tests, the
 *  deploys without machines). */
export async function bundleSha(): Promise<string | null> {
  if (!bytes) return null
  const carried = bytes
  digest ??= crypto.subtle
    .digest('SHA-256', carried)
    .then((hash) =>
      [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    )
  return await digest
}

export const machineBundle = new Hono<{ Bindings: Env }>()

machineBundle.get('/current', async (context) => {
  const sha = await bundleSha()
  return sha ? context.text(sha) : context.text('no bundle', 404)
})

machineBundle.get('/:file', async (context) => {
  const sha = await bundleSha()
  if (!sha || !bytes || context.req.param('file') !== `${sha}.bin`) {
    return context.text('no such bundle', 404)
  }
  return new Response(bytes, {
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})
