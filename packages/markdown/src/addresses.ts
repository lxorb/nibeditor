/** The two questions anything asks about an address before writing it down.
 *
 *  Its own file because two things that must not reach each other's imports ask
 *  them: the article extractor (`article.ts`) resolves what a page's markup wrote,
 *  and the clipper's service worker checks what arrived over a message - and a
 *  worker that imported the extractor would carry Readability for two lines.
 *  Asking them in one place is also what keeps the answers the same, and a scheme
 *  that is read one way here and another way there is how a filter gets walked
 *  past. */

/** Schemes a browser runs instead of fetching. `@nib/markdown` drops them again
 *  when it renders, which is the line that matters for a published page; a note
 *  should not be carrying one in the first place. */
const RUNS = new Set(['javascript:', 'vbscript:'])

/** An address, resolved against the page it came from, or null when it is not
 *  an address at all.
 *
 *  The parsed `URL` rather than its text, because what the caller does next
 *  depends on the scheme, and finding that out by parsing it a second time
 *  would be a second parse for every link on a page that has thousands. */
export function absolute(value: string, base?: string): URL | null {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

/** Whether an address is code rather than a place.
 *
 *  Asked of the parsed address and never of the text it was written as: a
 *  browser reads `java<tab>script:` as the scheme, and a test against the
 *  characters does not. */
export function runsCode(address: URL): boolean {
  return RUNS.has(address.protocol)
}
