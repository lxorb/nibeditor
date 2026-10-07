/** The store the chats' surfaces read and write (docs/chats.md 6.1): the client's,
 *  `chats` in ../store.svelte.ts, through its shapes in ../api.ts and nothing else.
 *
 *  One door rather than an import in every surface, so a test or a drive can hand the
 *  surfaces a store in memory (`fixture.svelte.ts`) and see them exactly as the app
 *  draws them, without an account. */

import type { Chats } from '../api'
import { chats } from '../store.svelte'

let current = $state.raw<Chats>(chats)

/** The store the surfaces read. */
export function store(): Chats {
  return current
}

/** Another store, for a test or a drive. */
export function useStore(next: Chats): void {
  current = next
}
