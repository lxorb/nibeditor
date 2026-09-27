/** What the address field offers somebody typing: the rest of the address in the
 *  field itself, and a few pages under it.
 *
 *  Chrome's omnibox, in the two halves it has always had.
 *
 *  * **The field finishes the word.** `moo` becomes `moo|dle-app2.let.ethz.ch`, the
 *    added part selected, so typing on narrows it and Enter goes there. To the site
 *    first, because the site is what most people are on their way to, and to a whole
 *    address only once what was typed has gone past the site. Only ever a string the
 *    typing is the start of: an offer that changed what was typed rather than finishing
 *    it would be the field typing for you.
 *  * **The list finds the page.** A word from the middle of the address or the title
 *    is enough there, because the reader is choosing rather than typing.
 *
 *  Both ranked the way Chrome ranks, roughly: an address somebody typed counts ten
 *  times a visit, and all of it fades with how long ago it was.
 *
 *  Pure, and per keystroke: every row is read once, the parts of an address are worked
 *  out once per row and kept, and the rows are at most `MOST_VISITS`. See visits.ts. */

import type { Visit } from './visits'

/** How much more an address somebody typed counts than one a link led to. Chrome
 *  weighs a typed visit far above a followed one, because it is the habit the field
 *  exists to serve. */
const TYPED_WEIGHT = 10

const DAY = 24 * 60 * 60 * 1000

/** How many pages the list offers. A few, the way Chrome's list is a few: more is a
 *  page of history rather than a suggestion. */
const OFFERED = 5

/** How much a row counts, before anything about what was typed. */
export function frecency(visit: Visit, now: number): number {
  const days = (now - visit.last) / DAY
  const recent = days < 4 ? 1 : days < 14 ? 0.7 : days < 31 ? 0.5 : days < 90 ? 0.3 : 0.1

  return (visit.visits + visit.typed * TYPED_WEIGHT) * recent
}

/** An address, taken apart the ways the field compares it. All lower case but the
 *  path, which a server may read case by case. */
interface Parts {
  protocol: string
  /** The host as it is, with its port: `www.google.com`. */
  host: string
  /** And without the `www.` every browser leaves off: `google.com`. */
  bare: string
  /** Everything after the host: `/search?q=nib`. */
  path: string
  /** What the list searches in: the bare address and the title, lower case. */
  words: string
}

/** Parts, once per row. A row changed is a new object, so the old one's parts go with
 *  it; see visits.ts. */
const taken = new WeakMap<Visit, Parts>()

function split(address: string): Omit<Parts, 'words'> {
  const url = new URL(address)
  const host = url.host.toLowerCase()

  return {
    protocol: url.protocol,
    host,
    bare: host.replace(/^www\./, ''),
    path: `${url.pathname}${url.search}`,
  }
}

function partsOf(visit: Visit): Parts {
  const known = taken.get(visit)
  if (known) return known

  const said = split(visit.url)
  const parts = { ...said, words: `${said.bare}${said.path} ${visit.title}`.toLowerCase() }

  taken.set(visit, parts)
  return parts
}

/** An address as the field and the list show it: without `https://` and without
 *  `www.`, which is what every browser shows now, and without the slash a site's own
 *  front page ends in. `http:` stays in front, because that is the one thing about an
 *  address worth warning somebody about. See `plainOrigin` in address.ts. */
export function shownAddress(url: string): string {
  const { protocol, bare, path } = split(url)
  const shown = `${bare}${path === '/' ? '' : path}`

  return protocol === 'http:' ? `http://${shown}` : shown
}

/** What the field would read as with the rest of an address after what was typed, and
 *  where Enter goes from it. */
export interface Completion {
  /** The whole of what the field says: what was typed, as it was typed, and the rest. */
  text: string
  url: string
}

/** A scheme written in full at the front. Anything short of `://` is still being
 *  typed, and could as easily be the start of a host called `http-cats.com`. */
const SCHEME = /^(https?):\/\//i

/** The rest of the best address `typed` is the start of, or null where there is none.
 *
 *  The host first: while what was typed is still inside a host, the offer is that host,
 *  whichever of its pages were visited, and Enter goes to its front page with the
 *  scheme the site was visited on. A site's weight is the sum of its pages', so the
 *  site somebody lives on beats one page they opened twice. Past the host - a slash, a
 *  question mark - the offer is a whole address.
 *
 *  `www.` may be typed or not, and so may the scheme; a scheme typed has to be the one
 *  the page was on. A space means words, which are a search and never an address. */
export function completion(list: readonly Visit[], typed: string, now: number): Completion | null {
  const said = typed.trimStart()
  if (!said || /\s/.test(said)) return null

  const scheme = SCHEME.exec(said)
  const rest = scheme ? said.slice(scheme[0].length) : said
  if (!rest) return null

  const asked = rest.toLowerCase()
  const protocol = scheme ? `${(scheme[1] ?? '').toLowerCase()}:` : null
  const pastHost = /[/?#]/.test(rest)

  let best: { score: number; form: string; url: string } | null = null
  const sites = new Map<string, { score: number; form: string; url: string }>()

  for (const visit of list) {
    const parts = partsOf(visit)
    if (protocol !== null && parts.protocol !== protocol) continue

    if (pastHost) {
      const form = [`${parts.bare}${parts.path}`, `${parts.host}${parts.path}`].find((one) =>
        one.toLowerCase().startsWith(asked),
      )
      if (form === undefined) continue

      const score = frecency(visit, now)
      if (!best || score > best.score) best = { score, form, url: visit.url }
      continue
    }

    const form = [parts.bare, parts.host].find((one) => one.startsWith(asked))
    if (form === undefined) continue

    const site = `${parts.protocol}//${parts.host}`
    const was = sites.get(site)
    sites.set(site, {
      score: (was?.score ?? 0) + frecency(visit, now),
      form,
      url: `${site}/`,
    })
  }

  for (const site of sites.values()) {
    if (!best || site.score > best.score) best = site
  }

  return best ? { text: `${said}${best.form.slice(asked.length)}`, url: best.url } : null
}

/** What a term at the front of a row's host counts: twice a word's start. */
const HOST_START = 4

/** How well `term` is found in a row: at the front of the host, at the front of a
 *  word, anywhere, or not at all. A term of one or two letters is found only at the
 *  front of something, because `e` is somewhere in every address there is. */
function found(parts: Parts, term: string): number {
  if (parts.bare.startsWith(term) || parts.host.startsWith(term)) return HOST_START

  let at = parts.words.indexOf(term)
  let anywhere = false
  while (at !== -1) {
    const before = parts.words[at - 1] ?? ' '
    if (!/[\p{L}\p{N}]/u.test(before)) return 2
    anywhere = true
    at = parts.words.indexOf(term, at + 1)
  }

  return anywhere && term.length > 2 ? 1 : 0
}

/** The pages worth offering for `typed`, best first: every word of it found somewhere
 *  in the address or the title, weighted by how well and by the row's own weight.
 *
 *  Pages on a site the typing is the start of come first whatever they weigh, because
 *  that site is what the field has just finished the word to: Chrome's top row is the
 *  one Enter would go to, and a list that led with another site would contradict the
 *  field above it. */
export function suggested(
  list: readonly Visit[],
  typed: string,
  now: number,
  count = OFFERED,
): Visit[] {
  const terms = typed.trim().replace(SCHEME, '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []

  const scored: { visit: Visit; site: boolean; score: number }[] = []
  for (const visit of list) {
    const parts = partsOf(visit)

    let how = 1
    for (const term of terms) {
      how *= found(parts, term)
      if (how === 0) break
    }

    if (how === 0) continue

    const site = found(parts, terms[0] ?? '') === HOST_START
    scored.push({ visit, site, score: how * frecency(visit, now) })
  }

  return scored
    .sort(
      (one, other) =>
        Number(other.site) - Number(one.site) ||
        other.score - one.score ||
        one.visit.url.length - other.visit.url.length,
    )
    .slice(0, count)
    .map((one) => one.visit)
}
