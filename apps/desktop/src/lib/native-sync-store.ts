/** The sync store on a desktop and a phone: SQLite in the crate, reached through six
 *  commands (src-tauri/src/sync_store.rs). Fetched only by `openSyncStore` in
 *  sync2/store.ts, and only inside the app.
 *
 *  Bytes cross the bridge as bytes, in the envelope sync v2 already speaks to the
 *  account (`frame` in @nib/sync-core): a write goes up as the raw request body and a
 *  read comes back as the raw response, so a document's update is never spelled as a
 *  list of numbers, which is what JSON would make of it - four characters a byte, parsed
 *  back one number at a time. The crate reads and writes the same envelope in
 *  sync_store/wire.rs. One answer carries at most the envelope's ceiling of parts, ten
 *  thousand; a read of more says so, and is asked in batches. */

import { frame, unframe } from '@nib/sync-core/wire'
import { invoke } from './native'
import {
  answerOf,
  changeOf,
  countsOf,
  openedOf,
  queryOf,
  StoreError,
  type Answers,
  type Change,
  type Query,
  type SyncStore,
} from './sync2/store'

/** Opens an account's store in the crate. */
export async function openNative(account: string): Promise<SyncStore> {
  const opened = openedOf(await invoke('sync_store_open', { account }))

  return {
    opened,
    async read<const Q extends readonly Query[]>(queries: Q): Promise<Answers<Q>> {
      for (const query of queries) queryOf(query)
      const answered = unframe(bytesOf(await invoke('sync_store_read', { queries })))
      if (!Array.isArray(answered) || answered.length !== queries.length) {
        throw new StoreError('the sync store answered an odd read')
      }
      // Each answer is checked against its own question, in order, which is what
      // `Answers<Q>` says of the list as a whole.
      return queries.map((query, at) => answerOf(query, answered[at])) as Answers<Q>
    },
    async write(changes: readonly Change[]): Promise<number[]> {
      for (const change of changes) changeOf(change)
      return countsOf(await invoke('sync_store_write', frame(changes)), changes.length)
    },
    cleanExit: (clean) => invoke('sync_store_clean_exit', { clean }),
    close: () => invoke('sync_store_close'),
  }
}

/** Deletes an account's store in the crate. */
export function forgetNative(account: string): Promise<void> {
  return invoke('sync_store_forget', { account })
}

/** The crate's raw answer as bytes. What it arrives as depends on the platform: an
 *  `ArrayBuffer` where the answer is fetched, a list of numbers where the webview
 *  evaluates it (a Mac and an iPhone). */
export function bytesOf(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (Array.isArray(raw) && raw.every((one) => Number.isInteger(one) && one >= 0 && one < 256)) {
    return Uint8Array.from(raw as number[])
  }
  throw new StoreError('the sync store answered something that is not bytes')
}
