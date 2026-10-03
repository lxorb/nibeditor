/** The two rows a search can end on that are not things already there: the address
 *  typed, gone to, and the note a name typed would make.
 *
 *  Neither may take Enter from something that answered. They go after everything that
 *  was found, and they are first only where nothing was - so a name nothing has is one
 *  Enter from being a note, the way Obsidian's switcher and Notion's search end, and a
 *  query that finds a command still runs the command. The one exception is an address
 *  written out in full, `https://` or `www.` and on, which nobody types looking for a
 *  note. Shift+Enter makes the note whatever else answers; see Palette.svelte. */

import { visitKey } from '../web-tab/visits'
import { type NoteToMake, noteToMake } from './new-note'
import type { Row } from './rows'

/** The note `term` would make, where it reads as a name and names nothing the space
 *  has: `taken` is every file's path under the space, lower case. */
export function makeable(term: string, taken: ReadonlySet<string>): NoteToMake | null {
  const made = noteToMake(term)
  if (!made) return null

  const at = made.folder ? `${made.folder}/${made.name}` : made.name
  return taken.has(at.toLowerCase()) ? null : made
}

/** The address something typed is, and nothing for words: a few words in the palette
 *  are a search for a note, not for the web. See web-tab/address.ts. */
export { typedAddress } from '../web-tab/address'

/** `found` with the two offers where they belong. `address` is what `term` goes to
 *  when it is an address, and `shown` how that reads. */
export function withOffers(
  found: readonly Row[],
  term: string,
  address: { url: string; shown: string } | null,
  make: NoteToMake | null,
): Row[] {
  const there = address && visitKey(address.url)
  const goes = found.some(
    (row) =>
      (row.kind === 'page' && row.url === there) ||
      (row.kind === 'tab' && row.tab.url !== null && row.tab.url === there),
  )

  const offers: Row[] =
    address && !goes ? [{ kind: 'address', url: address.url, address: address.shown }] : []
  const written = /^(https?:\/\/|www\.)/i.test(term.trim())
  const out = written ? [...offers, ...found] : [...found, ...offers]

  return make ? [...out, { kind: 'make', make }] : out
}
