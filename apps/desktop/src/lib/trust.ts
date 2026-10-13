/** Whether the HTML in a document is markup or is words.
 *
 *  Orden renders a note the way Typora does: raw HTML in it is markup, and it runs.
 *  That is a feature of a local document, and the reasoning behind it holds
 *  exactly as far as "you wrote it". A note that came from somebody else - a
 *  member of a shared space, a peer typing in a room, a guest a link let in, a
 *  paste off the web - is a document from outside, and a document from outside is
 *  shown as the characters it is made of. The renderer already knows how; see
 *  `escapeHtml` in @nib/markdown, which is what a published page is rendered
 *  with, and for the same reason.
 *
 *  Two things decide it, because two things are what the app can actually know:
 *  who may reach the space the document sits in, and what has arrived in the
 *  document itself. The rule is here, on its own and with nothing else in it, so
 *  that the reading view, a canvas card and anything after them cannot come to
 *  different answers about the same note. */

/** Where the words in a document came from. Ordered by how little is known about
 *  them, most doubtful first; see `originOf`. */
export type Origin =
  /** Reached through somebody's share link, with no account behind it. Nothing
   *  such a session can see was written by the person looking at it. */
  | 'guest'
  /** Markup has been pasted into it from outside the app. */
  | 'paste'
  /** Somebody else is in the file right now, and their keystrokes arrive as this
   *  document's own words. */
  | 'room'
  /** It sits in a space somebody else can reach, so somebody else may have
   *  written any of it - through a room, or through the sync while it was shut. */
  | 'space'
  /** Written here, in a space nobody else is in. */
  | 'own'

/** What is known about where a document's words came from. */
export interface Provenance {
  /** Whether this machine is in as a guest rather than as an account. */
  guest: boolean
  /** Whether markup has been pasted into this document from outside the app. */
  pasted: boolean
  /** Whether anybody else can reach the space it sits in. A folder in no space,
   *  and a space on a machine that is signed out, are both the reader's own; see
   *  `isShared` in sharing.svelte.ts. */
  shared: boolean
  /** Whether somebody else is in the file at this moment. Only ever asked of a
   *  shared space: in a space nobody else is in, the other device in the room is
   *  this same person's. */
  peers: boolean
}

/** Where a document's words came from, from what is known about it. */
export function originOf(who: Provenance): Origin {
  if (who.guest) return 'guest'
  if (who.pasted) return 'paste'
  if (who.shared) return who.peers ? 'room' : 'space'
  return 'own'
}

/** Whether a document's raw HTML is markup rather than characters. Only a
 *  document the reader wrote themselves, in a space nobody else is in. */
export function trustsHtml(origin: Origin): boolean {
  return origin === 'own'
}

/** Whether what was pasted could have brought HTML into the document: the
 *  clipboard carried some, or the plain text itself holds a tag.
 *
 *  The plain text is read as well as the flavours, because pasting as plain text
 *  puts the clipboard in verbatim - a page of markup copied out of a code block
 *  arrives as text and is still markup once it is rendered. */
export function pastesMarkup(types: readonly string[], text: string): boolean {
  if (types.includes('text/html')) return true
  return /<[a-z][\w:-]*(?:[\s/>]|$)/i.test(text)
}
