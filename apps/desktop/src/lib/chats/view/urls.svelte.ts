/** Where a chat's files are drawn from (docs/chats.md 4.8). The store answers a file's
 *  address when asked (`Chats.fileUrl`), which may be a round trip; a row draws at once,
 *  so the address is asked once per file, kept, and the row draws again when it lands.
 *  Until then a picture is its stated size in the surface's ground, never a jump. */

import { SvelteMap } from 'svelte/reactivity'
import { store } from './source.svelte'

const known = new SvelteMap<string, string | null>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- what was asked; nothing draws from it
const asked = new Set<string>()

/** A file's address, or null while it is on its way or where there is none. */
export function fileUrl(chat: string, hash: string): string | null {
  const key = `${chat}/${hash}`
  if (!asked.has(key)) {
    asked.add(key)
    void store()
      .fileUrl(chat, hash)
      .then(
        (url) => known.set(key, url),
        () => known.set(key, null),
      )
  }
  return known.get(key) ?? null
}
