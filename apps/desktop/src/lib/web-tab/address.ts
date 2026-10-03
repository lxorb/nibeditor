/** What somebody typed in the address field, and what a page's address reads as.
 *
 *  Pure, and the only place either question is answered: the bar, the note that
 *  holds a web tab's address and the link that opens one all go through here, so a
 *  space cannot end up holding an address the bar would not have gone to. What the
 *  crate then refuses is the same rule said in Rust, because a link inside the page
 *  is judged by it too; see `allowed` in src-tauri/src/web_tabs.rs. */

/** Where a few words go when they are not an address.
 *
 *  A browser's address bar searches, and a field that did nothing for `svelte docs`
 *  would read as broken. Google, which is Emil's call and the answer most hands
 *  expect from an address bar: the results are the ones somebody typing a few words
 *  is picturing, and a browser that quietly searches somewhere else reads as a
 *  browser that found nothing. It was DuckDuckGo, for asking the least - no account,
 *  no profile, nothing kept - and that reasoning still stands; it simply is not the
 *  reasoning of the person typing.
 *
 *  The default and the first of Chrome's list, which the reader may change in Settings;
 *  see engines.ts. `%s` is where the words go, as in Chrome's own custom engines. */
export const SEARCH = 'https://www.google.com/search?q=%s'

/** Where the words go in a search engine's address. */
export const WORDS = '%s'

/** The address a few words go to on an engine whose search is `engine`. */
export function searchOn(engine: string, words: string): string {
  return engine.replaceAll(WORDS, encodeURIComponent(words))
}

/** Something that could be a host: dotted labels, or `localhost`, either with a
 *  port and a path after it. Deliberately not a guess at every address on the web -
 *  a string with a space in it is words, and a single word with no dot is words
 *  too. */
const HOST = /^(?:localhost|\[[0-9a-f:]+\]|[^\s/?#@]+\.[^\s/?#@.]{2,})(?::\d{1,5})?(?:[/?#]|$)/i

/** A scheme written at the front, whatever it is. */
const SCHEME = /^([a-z][a-z\d+.-]*):/i

/** Chrome's "View page source": a page's own address behind it. */
const SOURCE = /^view-source:/i

/** Whether an address is one a web tab may open: the web, and not the app.
 *
 *  The app's own origins are refused because a tab holding nib inside nib is a
 *  page whose script sits beside the app's, and every other scheme is refused
 *  because a tab is a browser and not a way to reach this machine. The crate says
 *  the same thing again on every navigation, which is what makes it true for the
 *  links inside the page as well as for this field. */
export function isWebAddress(url: string): boolean {
  const inner = url.replace(SOURCE, '')
  if (inner !== url) return !SOURCE.test(inner) && isWebAddress(inner)

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

  return !['tauri.localhost', 'ipc.localhost', 'asset.localhost', 'nib.localhost'].includes(
    parsed.hostname.toLowerCase(),
  )
}

/** The address something typed is, or null for words and for nothing: what the palette
 *  offers to go to, where a few words are a search for a note rather than for the web. */
export function typedAddress(typed: string): string | null {
  const said = typed.trim()
  if (!said) return null

  if (said.startsWith('//')) return isWebAddress(`https:${said}`) ? `https:${said}` : null

  if (HOST.test(said)) {
    const guessed = `https://${said}`
    return isWebAddress(guessed) ? guessed : null
  }

  if (SCHEME.test(said)) return isWebAddress(said) ? said : null

  return null
}

/** The address something typed means, or null when it means nothing at all.
 *
 *  A host first, because `localhost:1425` reads as a scheme called `localhost` and is
 *  not one - which is the same special case every browser makes. A host is given
 *  `https:`, which is what a browser does and what a page deserves in 2026, and a
 *  host this app refuses is nothing rather than something to search for.
 *
 *  Then a scheme, taken as written, so `http://` pages still open and a
 *  `javascript:` one never does. Anything left is words, and words are a search on
 *  `engine`, the reader's choice of search engine. */
export function webAddress(typed: string, engine = SEARCH): string | null {
  const said = typed.trim()
  if (!said) return null

  const address = typedAddress(said)
  if (address !== null) return address
  // An address this app refuses is nothing rather than something to search for.
  if (said.startsWith('//') || HOST.test(said) || SCHEME.test(said)) return null

  return searchOn(engine, said)
}

/** What Ctrl+Enter means in an address field: the word, as a `.com`.
 *
 *  Every browser has done this since Netscape - `svelte` and Ctrl+Enter is
 *  `https://www.svelte.com` - and a reader who has the habit types it without
 *  thinking. One word only: something with a dot, a space or a scheme in it already
 *  means what it says, and this leaves it alone so the ordinary press decides. */
export function dotCom(typed: string): string | null {
  const said = typed.trim()
  if (!said || /[\s/?#@:.]/.test(said)) return null

  const guessed = `https://www.${said}.com`
  return isWebAddress(guessed) ? guessed : null
}
/** The origin, plainly, for the bar to show while nobody is typing in it.
 *
 *  The host and nothing else, because the host is the part that says who is
 *  answering and the rest is where a reader stops reading. `www.` goes, the way
 *  every browser drops it. An `http:` page keeps its scheme in front, because that
 *  is the one thing about an address worth warning somebody about. */
export function plainOrigin(url: string): string {
  if (SOURCE.test(url)) return `view-source:${plainOrigin(url.replace(SOURCE, ''))}`

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  const host = parsed.host.replace(/^www\./i, '')
  return parsed.protocol === 'http:' ? `http://${host}` : host
}
