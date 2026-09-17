/** Asking a whole space for its hits, in the order the notes answer.
 *
 *  One call, however many notes: the parsed query goes over as a tree and the
 *  space is read once. What comes back arrives in handfuls rather than at the
 *  end, so the first rows are on screen while the last folder is still being
 *  read. In the app those handfuls are an event from the crate; in the browser
 *  they come from a worker, which is where the notes are read and scored so that
 *  neither the reading nor the scoring is a keystroke that does not appear.
 *
 *  Loose hits are the exception to arriving as they are found: a guess is worth
 *  showing in the order the scores put it, and the scores are not all in until
 *  the space has been read. Both sides send them last; see fuzzy.ts. */

import { invoke, isNative } from '../tauri'
import type { FuzzyHit } from './fuzzy'
import type { Hit } from './match'
import type { Query } from './query'

const HITS = 'nib://search-hits'

/** One handful, as both sides send it. */
export interface Found {
  hits: Hit[]
  loose: FuzzyHit[]
}

/** How many rows the papers may fill. A paper answers once per page, so a query
 *  every page of a long one holds would otherwise be the whole list; the notes are
 *  what a space is mostly made of. */
const PAPERS = 20

/** Which search a handful belongs to. Typing outruns the disk, and answers to a
 *  word that is no longer in the field would otherwise land in the list. */
let asked = 0

export async function searchSpace(
  root: string,
  query: Query,
  terms: string[],
  limit: number,
  onFound: (found: Found) => void,
  /** The notes and folders the space leaves out, relative to it. Skipped before
   *  the note is read on both sides, which is the whole point of leaving one out:
   *  an archive of two thousand notes should cost a search nothing rather than cost
   *  it a read and then a filter. See workspace/excluded.svelte.ts. */
  excluded: readonly string[] = [],
): Promise<void> {
  // The papers answer first, and from memory: their words are not on disk as text,
  // so neither walk below has anything to read. What was taken down in an earlier
  // sitting is read back once per space and per listing of it rather than per
  // search - every call after the first awaits that one's promise - so this is a
  // wait only for the first question about a space, and one row per paper rather
  // than a PDF taken apart.
  //
  // Nothing about the files is passed in here on purpose. A search has the root and
  // nothing else, and a read-back that trusted whatever the store held because its
  // caller could not say otherwise is how a PDF replaced on disk used to answer with
  // its old text. What the file list says is written down where it is known; see
  // `papersListed` in pdf/papers.ts.
  const { papersFor, searchPapers } = await import('../pdf/papers')
  await papersFor(root)
  const papers = searchPapers(root, query, PAPERS, excluded)
  if (papers.length) onFound({ hits: papers, loose: [] })

  if (!isNative) {
    const { searchInWorker } = await import('../web/search-client')
    await searchInWorker(root, query, terms, limit, onFound, excluded)
    return
  }

  const id = ++asked
  const { listen } = await import('@tauri-apps/api/event')
  // An event is a boundary, so what it carries is read rather than trusted: a
  // handful from a crate that has not learnt about loose hits yet is a handful
  // of exact ones.
  const stop = await listen<{ id: number; hits?: Hit[]; loose?: FuzzyHit[] }>(HITS, (event) => {
    const batch = event.payload
    if (batch.id !== id) return

    onFound({ hits: batch.hits ?? [], loose: batch.loose ?? [] })
  })

  try {
    await invoke('search_space', { root, query, terms, limit, id, excluded })
  } finally {
    stop()
  }
}
