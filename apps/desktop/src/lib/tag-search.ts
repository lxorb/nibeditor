/** A `#tag` pressed in a note: the space's search, asked about it.
 *
 *  The same question a row of the tag tree asks and a tag chip in the Properties
 *  panel asks - `tag:` and the tag's path, which finds it and everything nested
 *  under it - put by the words themselves, the way Obsidian answers a tag clicked in
 *  a note. The panel comes out where it lives rather than taking the keyboard: the
 *  press came from a note, and the note is where the hands still are.
 *
 *  Fetched by the press rather than carried: the editor and the reading view are on
 *  the first frame, and the search is not. */

import { search } from './search.svelte'
import { workspace } from './workspace.svelte'

export function searchTag(tag: string): void {
  workspace.showPanel('search')
  search.ask(`tag:${tag}`)
}
