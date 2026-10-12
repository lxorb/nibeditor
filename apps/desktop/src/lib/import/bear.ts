/** A Bear export.
 *
 *  Bear writes markdown, so almost nothing has to happen: its files, its folders
 *  and its TextBundles are read the way any folder of notes is. The one thing
 *  that is Bear's own is how it writes a tag with a space in it - `#two words#`,
 *  closed with a second hash - which nothing else reads as a tag at all.
 *
 *  Those become nib's tags, which have no spaces in them: `#two-words`. A tag is
 *  a thing you click, and a space in one is why Bear had to invent the closing
 *  hash in the first place.
 *
 *  The rewrite itself is convert.ts, because the Convert syntax command does the
 *  same thing to notes that arrived some other way, and one rule about what a tag
 *  is beats two. */

import { convertTags } from './convert'
import { isHidden } from './folder'
import { readPlain } from './plain'
import type { ImportPlan } from './plan'
import type { Source } from './sources'

/** Hidden files stay behind, as from any folder of notes: Bear writes none, and a
 *  folder taken for its export may be somebody's notes kept in git. */
export function readBear(sources: readonly Source[]): Promise<ImportPlan> {
  return readPlain(sources, { format: 'bear', words: bearTags, skip: isHidden })
}

/** Bear's closed tags as nib's, leaving every fenced block exactly as written. */
export function bearTags(text: string): string {
  return convertTags(text).text
}
