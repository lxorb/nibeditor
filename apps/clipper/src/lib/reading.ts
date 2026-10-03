/** A page, read: the whole way from a document to a clip.
 *
 *  Extraction and conversion belong together and belong in the page. Turndown
 *  parses HTML with the DOM it finds around it, and a service worker has none;
 *  the content script has the real one, already holding the article that is
 *  being clipped. So the page hands over finished markdown, and the worker,
 *  which is the half with the session, deals in pictures and notes.
 *
 *  This is also the seam the tests take hold of: a saved page parsed by jsdom
 *  goes in, and the markdown a note would contain comes out. */

import { extract } from '@nib/markdown/article'
import type { Kind } from './kinds'
import { toMarkdown } from './markdown'
import type { Clip } from './messages'

export function readPage(document: Document, kind: Kind, url: string, link?: string): Clip {
  const source = extract(document, kind, url, link)
  const { markdown, images } = toMarkdown(source.html)

  return {
    origin: { kind: source.kind, url: source.url, title: source.title, tags: source.tags },
    clipped: new Date().toISOString(),
    markdown,
    images,
    // Nothing has been asked about the page yet, and nothing will be unless
    // somebody turns the interpreter on; see `interpret/`.
    filled: [],
  }
}
