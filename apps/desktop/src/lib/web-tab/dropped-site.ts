/** A link dragged out of a page and let go on the file list: a web note where it landed.
 *
 *  What a browser's bookmark bar does with a link dropped on it, in nib's own shape for a
 *  bookmark (see menu.ts): a `.url` in the folder it was let go over, named after the
 *  link's own words - the text of the link, which the engine hands over as the HTML of
 *  the link - or its site where it has none. A picture dragged out of a page carries the
 *  picture as a file too and is copied in beside the notes as any file is; see
 *  `isLinkDrop` in drag-paths.ts. Fetched with the first drop. */

import { droppedAddress } from '../tab-strip/dropped'
import type { Sites } from './new-site'
import { newSite } from './new-site'
import { plainOrigin } from './address'

/** The few entities a link's words come with. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** The words of the first link in `html`, or the empty string: the engine hands a
 *  dragged link over as `<a href="...">its words</a>`. Read without a document, so
 *  nothing in it is ever parsed as markup that runs. */
export function linkWords(html: string): string {
  const inner = /<a(?:\s[^>]*)?>([\s\S]*?)<\/a>/i.exec(html)?.[1] ?? ''
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith('#x') || name.startsWith('#X'))
        return String.fromCodePoint(parseInt(name.slice(2), 16))
      if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)))
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** The web note for a dropped link, in `folder`. Nothing for a drop whose link is no
 *  page a web tab may open. Answers the note's path, or null. */
export async function siteDropped(
  ws: Sites,
  folder: string,
  list: string,
  html: string,
): Promise<string | null> {
  const url = droppedAddress((type) => (type === 'text/uri-list' ? list : ''))
  if (url === null) return null

  const words = linkWords(html)
  const title = words && words !== url ? words : plainOrigin(url)
  return newSite(ws, folder, title, url)
}
