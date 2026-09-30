/** Where an account's web state lives, and how much of it there may be.
 *
 *  A state is a manifest at `web/<user>/<key>` and the chunks it names at
 *  `web/<user>/chunks/<name>`, all of it encrypted on a device under names the
 *  service cannot read. The manifest is written only by the hub, once it has
 *  checked the fence; the chunks are named by their contents, so they need no
 *  fence and anybody signed in to the account may put one. Reading either never
 *  asks the hub. See docs/sync-v2.md sections 6.5 and 8. */

import { chunks as inChunks, places } from '../bound'
import { now } from '../crypto'
import type { Env } from '../types'

/** What web state one account may keep, all of it: its own quota, apart from
 *  the notes' gibibyte in storage.ts. */
export const WEB_QUOTA = 512 * 1024 * 1024

/** One site's state, manifest and chunks together. */
export const MOST_BUNDLE = 32 * 1024 * 1024

/** How long a chunk nobody names yet is kept. A device puts a state's chunks up
 *  before its manifest, so a chunk is always nobody's for a moment first; an hour
 *  is far past any upload, and short enough that what a device abandoned does not
 *  sit in somebody's quota. */
const UNNAMED_FOR = 60 * 60 * 1000

/** How many objects one R2 delete takes. */
const PER_DELETE = 1000

export const stateName = (user: string, key: string) => `web/${user}/${key}`
export const chunkName = (user: string, name: string) => `web/${user}/chunks/${name}`

/** The bytes an account's web state takes, and what the one being replaced took. */
export async function webBytes(
  env: Env,
  user: string,
  replacing: string | null,
): Promise<{ used: number; replaced: number }> {
  const row = await env.DB.prepare(
    `select (select coalesce(sum(size), 0) from web_states where user_id = ?1) +
            (select coalesce(sum(size), 0) from web_chunks where user_id = ?1) as used,
            (select coalesce(sum(size), 0) from web_states where user_id = ?1 and key = ?2)
              as replaced`,
  )
    .bind(user, replacing ?? '')
    .first<{ used: number; replaced: number }>()

  return { used: row?.used ?? 0, replaced: row?.replaced ?? 0 }
}

/** How many of these chunks the account holds, and their bytes together. */
export async function chunksHeld(
  env: Env,
  user: string,
  names: readonly string[],
): Promise<{ found: number; bytes: number }> {
  let found = 0
  let bytes = 0

  for (const chunk of inChunks([...new Set(names)])) {
    const row = await env.DB.prepare(
      `select count(*) as found, coalesce(sum(size), 0) as bytes from web_chunks
        where user_id = ? and name in (${places(chunk.length)})`,
    )
      .bind(user, ...chunk)
      .first<{ found: number; bytes: number }>()

    found += row?.found ?? 0
    bytes += row?.bytes ?? 0
  }

  return { found, bytes }
}

/** A manifest the hub accepted: the bytes, and the row a download and the quota
 *  read. The version, fence and generation go on the object as well, so a
 *  download is one read and cannot see bytes of one version with the number of
 *  another. */
export async function putState(
  env: Env,
  state: {
    user: string
    key: string
    device: string
    fence: number
    version: number
    generation: number
    body: ArrayBuffer
  },
): Promise<void> {
  await env.NOTES.put(stateName(state.user, state.key), state.body, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: {
      version: String(state.version),
      fence: String(state.fence),
      generation: String(state.generation),
    },
  })

  await env.DB.prepare(
    `insert into web_states (user_id, key, fence, version, generation, size, device_id, at)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(user_id, key) do update set
       fence = excluded.fence, version = excluded.version, generation = excluded.generation,
       size = excluded.size, device_id = excluded.device_id, at = excluded.at`,
  )
    .bind(
      state.user,
      state.key,
      state.fence,
      state.version,
      state.generation,
      state.body.byteLength,
      state.device,
      now(),
    )
    .run()
}

/** Lets go of the chunks no state names any more, once they have been nobody's
 *  for an hour. `named` is every chunk the account's states name now, which only
 *  the hub knows. A bound on how many one call takes, because it runs after an
 *  upload and the next upload takes the rest. */
export async function collectChunks(
  env: Env,
  user: string,
  named: ReadonlySet<string>,
): Promise<number> {
  const { results } = await env.DB.prepare(
    'select name from web_chunks where user_id = ? and at < ? order by at limit ?',
  )
    .bind(user, now() - UNNAMED_FOR, PER_DELETE)
    .all<{ name: string }>()

  const loose = results.map((one) => one.name).filter((name) => !named.has(name))
  await forgetChunks(env, user, loose)
  return loose.length
}

/** Every web state the account has, gone: what a fresh web key does to the ones
 *  sealed under the key before it, which nothing can open any more. */
export async function wipeWebState(env: Env, user: string): Promise<void> {
  for (;;) {
    const { results } = await env.DB.prepare('select key from web_states where user_id = ? limit ?')
      .bind(user, PER_DELETE)
      .all<{ key: string }>()
    if (!results.length) break

    const keys = results.map((one) => one.key)
    await env.NOTES.delete(keys.map((key) => stateName(user, key)))
    for (const chunk of inChunks(keys)) {
      await env.DB.prepare(
        `delete from web_states where user_id = ? and key in (${places(chunk.length)})`,
      )
        .bind(user, ...chunk)
        .run()
    }
  }

  for (;;) {
    const { results } = await env.DB.prepare(
      'select name from web_chunks where user_id = ? limit ?',
    )
      .bind(user, PER_DELETE)
      .all<{ name: string }>()
    if (!results.length) break
    await forgetChunks(
      env,
      user,
      results.map((one) => one.name),
    )
  }
}

async function forgetChunks(env: Env, user: string, names: readonly string[]): Promise<void> {
  if (!names.length) return

  await env.NOTES.delete(names.map((name) => chunkName(user, name)))
  for (const chunk of inChunks(names)) {
    await env.DB.prepare(
      `delete from web_chunks where user_id = ? and name in (${places(chunk.length)})`,
    )
      .bind(user, ...chunk)
      .run()
  }
}
