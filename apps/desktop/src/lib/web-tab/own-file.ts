/** A web note's file with its own web data turned on or off, everything else as it was;
 *  see own-data.ts. Apart from shortcut.ts, which every launch reads, because only a press
 *  in a menu writes this. Pure. */

import { readWebFile, writeShortcut } from './shortcut'

/** A web note's file as it is, but keeping its own web data `own` - an id, or none for
 *  the store every page shares; see own-data.ts. Null for a file that is not one this app
 *  writes: no shortcut at all, or a `.webloc`, which is read and never written. The title
 *  a file does not say is the name the note goes by, `fallback`. */
export function withOwn(
  path: string,
  text: string | null,
  own: string | null,
  fallback = '',
): string | null {
  const said = readWebFile(path, text)
  if (!said || /\.webloc$/i.test(path.trim())) return null
  const added = said.added ? new Date(said.added) : new Date()
  return writeShortcut(
    said.url,
    said.title ?? fallback,
    Number.isNaN(added.getTime()) ? new Date() : added,
    said.home,
    said.icon,
    own,
  )
}
