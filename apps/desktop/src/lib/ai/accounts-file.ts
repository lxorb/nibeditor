/** Where the accounts are kept: one file for every window of the app, on a desktop and a
 *  phone, which the crate reads and writes (src-tauri/src/ai_accounts.rs); and in a
 *  browser, which has no crate, this tab's own storage.
 *
 *  A read answers the text and its stamp; a write names the stamp of the text it changed
 *  and is refused with `stale` where another window wrote in between, so the store makes
 *  its change again over the newer text rather than writing the older one back. */

import { keep, storedText } from '../stored'
import { invoke, isNative } from '../tauri'

/** What the window hears when any window writes the accounts. */
const EVENT = 'nib://ai-accounts'

/** Where a browser keeps them; a desktop keeps the same text here too, as the copy the
 *  window starts from before the crate has answered (store.svelte.ts). */
export const COPY = 'nib:ai-accounts'

export interface Kept {
  text: string | null
  stamp: string
}

/** The refusal a write over a changed text meets. */
export const STALE = 'stale'

/** The text kept, read rather than trusted. */
export async function readKept(): Promise<Kept> {
  if (!isNative) return { text: storedText(COPY), stamp: '' }
  const said: unknown = await invoke<unknown>('ai_accounts_read')
  if (typeof said !== 'object' || said === null) return { text: null, stamp: '' }
  const { text, stamp } = said as { text?: unknown; stamp?: unknown }
  return {
    text: typeof text === 'string' ? text : null,
    stamp: typeof stamp === 'string' ? stamp : '',
  }
}

/** Writes `text` over the text stamped `stamp`, and answers the new stamp. Throws `stale`
 *  where the file changed since. A browser has one tab's storage and no stamps. */
export async function writeKept(text: string, stamp: string): Promise<string> {
  if (!isNative) {
    keep(COPY, text)
    return ''
  }
  const said: unknown = await invoke<unknown>('ai_accounts_write', { text, stamp })
  return typeof said === 'string' ? said : ''
}

/** Calls `on` whenever any window wrote the accounts. Nothing in a browser, whose one
 *  tab is the only writer. */
export async function hearChanges(on: () => void): Promise<void> {
  if (!isNative) return
  const { listen } = await import('@tauri-apps/api/event')
  await listen<unknown>(EVENT, () => {
    on()
  })
}
