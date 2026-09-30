/** A site's login on its way to the account and back: the bundle a capture sealed,
 *  uploaded under the lease's fence, and the newest one downloaded for a restore.
 *
 *  Chunks first, because the account refuses a manifest naming a chunk it does not hold,
 *  and only the chunks this run has not sent already: a chunk is named by what it holds,
 *  so a database that did not change is not uploaded twice. Then the manifest, with the
 *  fence the lease was granted under; an upload made under an older one is refused as
 *  `fenced`, which is a computer that slept through losing its lease finding out. Down is
 *  the other way round: the manifest, then the chunks it names that are not here yet,
 *  which only this computer can read off it. See docs/sync-v2.md sections 6.5 and 7,
 *  and services/sync/src/hub/web.ts. */

import { BASE } from '../api'
import type { Captured } from './web-state'
import { webState } from './web-state'

/** What an upload came to: the version the account gave it, `fenced` when the lease
 *  had moved on, or null when it did not land and is worth trying at the next moment. */
export type Uploaded = number | 'fenced' | null

/** A lease as the transfer sees it: its opaque key, its store and site, and the chunks
 *  already on the account. */
export interface Carrying {
  key: string
  store: string | null
  site: string
  sent: Set<string>
}

async function put(
  token: string,
  path: string,
  body: Uint8Array,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/octet-stream',
      ...headers,
    },
    body: body as Uint8Array<ArrayBuffer>,
  })
}

/** Uploads a capture under `fence` and key generation `generation`. */
export async function upload(
  token: string,
  lease: Carrying,
  captured: Captured,
  fence: number,
  generation: number,
): Promise<Uploaded> {
  try {
    for (const chunk of captured.chunks) {
      if (lease.sent.has(chunk.name)) continue
      const bytes = await webState.file(captured.folder, chunk.name)
      const answer = await put(token, `/v2/web/chunks/${chunk.name}`, bytes)
      if (!answer.ok) return null
      lease.sent.add(chunk.name)
    }

    const manifest = await webState.file(captured.folder, captured.manifest.name)
    const answer = await put(token, `/v2/web/${lease.key}`, manifest, {
      'x-nib-fence': String(fence),
      'x-nib-generation': String(generation),
      'x-nib-chunks': captured.named.join(','),
    })
    if (answer.status === 409) return 'fenced'
    if (answer.status === 400) {
      // A chunk the account let go of: sent again from scratch next time.
      lease.sent.clear()
      return null
    }
    if (!answer.ok) return null

    const said: unknown = await answer.json()
    const version =
      typeof said === 'object' && said !== null ? (said as { version?: unknown }).version : null
    return typeof version === 'number' ? version : null
  } catch {
    // Offline, or the account out of reach: the next moment sends it again.
    return null
  }
}

/** The newest state of a lease downloaded into a folder of its own: the manifest's path
 *  and the version it is, or null when the account has none. Throws when it could not be
 *  fetched, which is a restore that waits for the next moment. */
export async function download(
  token: string,
  lease: Carrying,
): Promise<{ path: string; version: number } | null> {
  const got = (path: string) =>
    fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } })

  const answer = await got(`/v2/web/${lease.key}`)
  if (answer.status === 404) return null
  if (!answer.ok) throw new Error(`the web state could not be fetched (${String(answer.status)})`)

  const version = Number(answer.headers.get('x-nib-version') ?? '')
  const inbox = await webState.inbox()
  await webState.put(inbox, 'manifest', new Uint8Array(await answer.arrayBuffer()))
  const path = `${inbox}${inbox.includes('\\') ? '\\' : '/'}manifest`

  for (const chunk of await webState.wants(lease.store, lease.site, path)) {
    const part = await got(`/v2/web/chunks/${chunk}`)
    if (!part.ok) throw new Error(`a chunk could not be fetched (${String(part.status)})`)
    await webState.put(inbox, chunk, new Uint8Array(await part.arrayBuffer()))
  }

  return { path, version: Number.isSafeInteger(version) ? version : 0 }
}
