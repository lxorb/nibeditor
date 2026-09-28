/** A link dragged onto the strip from somewhere else: another browser's address
 *  bar or page, a mail, a chat. Chrome opens it as a tab where it was let go, and so
 *  does this.
 *
 *  Only a whole address on the web, the one test every web tab is held to (see
 *  web-tab/address.ts): a file dragged out of Explorer, a sentence dragged out of a
 *  note and a `javascript:` link all carry text, and none of them is a page. And none
 *  of the app's own drags, which carry their rows under types of their own and are
 *  somebody else's to read. */

import { isWebAddress } from '../web-tab/address'

/** The types a link travels under: the list a browser writes, and the plain text
 *  every other app writes. */
const LIST = 'text/uri-list'
const PLAIN = 'text/plain'

/** The address a drop carries, or null for one that carries none. The list first,
 *  whose comment lines start with `#`, then the text. */
export function droppedAddress(read: (type: string) => string): string | null {
  const listed = read(LIST)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))

  for (const one of [listed, read(PLAIN).trim()]) {
    if (one && isWebAddress(one)) return one
  }

  return null
}
