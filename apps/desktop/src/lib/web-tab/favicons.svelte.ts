/** Every site's mark this device has seen, kept between launches: the one favicon cache.
 *
 *  Emil, 2026-09-30: *"When I restart nib all the icons from previously opened websites
 *  are gone and I only see them when I actually load them. But they could be cached."*
 *  A page's mark lived on the page, and a tab with no file lost it with the page.
 *
 *  Chrome's answer, kept small. Its Favicons database maps a page to an icon stored once,
 *  and a page it has no mapping for borrows its host's (`fallback_to_host`), which is also
 *  Firefox's root icon. So here: a page is its origin and path, a query or a fragment
 *  being the same site's page, and one it never showed borrows the last mark its origin
 *  showed. Not the registrable site: mail and docs under one domain are two products.
 *
 *  Only what a page itself showed is kept, as the engine reported it (web_icons.rs):
 *  nothing is fetched to fill this, which would tell a server where somebody has been.
 *  A page's live mark always wins over this; see `siteMark`, the one door every surface
 *  draws a site's mark through.
 *
 *  Shared by every space. It is only ever asked about an address the surface already
 *  shows, so it says nothing a space's own rows do not, and no page can read it or learn
 *  from it: it never decides whether a page fetches its mark, which is what the favicon
 *  supercookie measured. Forgetting a page from a history forgets its mark here.
 *
 *  Bounded the way Firefox learned to be (bug 1598371, a mail site's unread count stored
 *  as 207,000 icons): one mark per page, so a count redrawn replaces rather than adds, and
 *  `MOST_PAGES` and `MOST_TEXT` over all of it, the least recently used going first.
 *
 *  Synchronous on purpose: the strip draws a restored tab's mark in the frame it draws the
 *  tab, so there is no globe to swap. The index is small and read on the first ask; each
 *  picture is its own key, read when a mark wants it. */

import { forget, isNumber, isRecord, isString, keep, stored, storedText } from '../stored'

/** Which picture each page and origin showed last, and when it was last wanted. */
const INDEX = 'nib:favicons'
/** One picture, under its own id. */
const PICTURE = 'nib:favicon:'

/** As many pages as the history keeps visits, and half a megabyte of pictures. */
const MOST_PAGES = 500
const MOST_TEXT = 512 * 1024

/** The largest picture kept: web_icons.rs sends none larger. */
const LARGEST = 22 * 1024

/** A picture the window draws as it stands; see `picture` in web_icons.rs. */
const DRAWABLE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i

/** Writes wait for the marks to stop arriving: a page reports its mark several times as
 *  it lands. A mark drawn again is a use worth writing down once a day. */
const QUIET = 2000
const DAY = 24 * 60 * 60 * 1000

/** A page's picture and when it was last shown or drawn. */
type Held = [picture: string, used: number]

/** The two keys an address is looked for under, the page first, or null for anything
 *  that is not a web page. */
export function keysOf(url: string | null | undefined): [string, string] | null {
  if (!url) return null

  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once and thrown away
    const at = new URL(url)
    if (at.protocol !== 'https:' && at.protocol !== 'http:') return null
    return [at.origin + at.pathname, at.origin]
  } catch {
    return null
  }
}

/** A picture's id, from its bytes: one picture shown by a hundred pages is kept once. */
function idOf(picture: string): string {
  let one = 0x811c9dc5
  let two = 0x01000193
  for (let at = 0; at < picture.length; at++) {
    const code = picture.charCodeAt(at)
    one = Math.imul(one ^ code, 2654435761)
    two = Math.imul(two ^ code, 1597334677)
  }
  return (one >>> 0).toString(36) + (two >>> 0).toString(36)
}

function drawable(picture: string): boolean {
  return picture.length <= LARGEST && DRAWABLE.test(picture)
}

class Favicons {
  /** Moved on every change, so every mark drawn from here is drawn again. */
  private changed = $state(0)

  /** The index, read on the first ask. */
  private held: Map<string, Held> | null = null
  /** Each picture's length, and so which have a key of their own in storage. */
  private readonly sizes = new Map<string, number>()
  /** Pictures read or seen this run. */
  private readonly pictures = new Map<string, string | null>()
  /** Pictures seen and not yet written. */
  private readonly unwritten = new Map<string, string>()

  private writing: ReturnType<typeof setTimeout> | undefined

  private index(): Map<string, Held> {
    if (this.held) return this.held

    this.held = new Map()
    const saved = stored(INDEX)
    if (!isRecord(saved) || !isRecord(saved.pages) || !isRecord(saved.sizes)) return this.held

    for (const [key, one] of Object.entries(saved.pages)) {
      if (Array.isArray(one) && isString(one[0]) && isNumber(one[1])) {
        this.held.set(key, [one[0], one[1]])
      }
    }
    for (const [id, size] of Object.entries(saved.sizes)) {
      if (isNumber(size)) this.sizes.set(id, size)
    }
    return this.held
  }

  private picture(id: string): string | null {
    let found = this.pictures.get(id)
    if (found === undefined) {
      const text = storedText(PICTURE + id)
      found = text !== null && drawable(text) ? text : null
      this.pictures.set(id, found)
    }
    return found
  }

  /** The mark last seen at `url`, else at its origin, else null. */
  of(url: string | null | undefined): string | null {
    // Read, so whatever asked is asked again when a page shows a new mark.
    const keys = this.changed >= 0 ? keysOf(url) : null
    if (!keys) return null

    const index = this.index()
    for (const key of keys) {
      const held = index.get(key)
      const picture = held ? this.picture(held[0]) : null
      if (!held || !picture) continue

      if (Date.now() - held[1] > DAY) {
        held[1] = Date.now()
        this.later()
      }
      return picture
    }
    return null
  }

  /** A page at `url` shows `picture` now. */
  saw(url: string | null | undefined, picture: string) {
    const keys = keysOf(url)
    if (!keys || !drawable(picture)) return

    const id = idOf(picture)
    const index = this.index()
    const now = Date.now()
    const same = keys.every((key) => index.get(key)?.[0] === id)
    for (const key of keys) index.set(key, [id, now])
    if (same) return

    if (!this.sizes.has(id)) this.unwritten.set(id, picture)
    this.pictures.set(id, picture)
    this.within(index)
    this.changed++
    this.later()
  }

  /** Nothing is kept for this page any more, nor for its origin. */
  forget(url: string | null | undefined) {
    const keys = keysOf(url)
    if (!keys) return

    const index = this.index()
    if (keys.map((key) => index.delete(key)).includes(true)) {
      this.changed++
      this.later()
    }
  }

  /** Under both ceilings, the least recently used page going first. */
  private within(index: Map<string, Held>) {
    const holders: Record<string, number> = {}
    for (const [id] of index.values()) holders[id] = (holders[id] ?? 0) + 1

    const size = (id: string) =>
      this.sizes.get(id) ?? this.unwritten.get(id)?.length ?? this.pictures.get(id)?.length ?? 0
    let text = 0
    for (const id of Object.keys(holders)) text += size(id)
    if (index.size <= MOST_PAGES && text <= MOST_TEXT) return

    const oldest = [...index].sort(([, one], [, other]) => one[1] - other[1])
    for (const [key, [id]] of oldest) {
      if (index.size <= MOST_PAGES && text <= MOST_TEXT) return
      index.delete(key)
      const left = (holders[id] ?? 1) - 1
      holders[id] = left
      if (left === 0) text -= size(id)
    }
  }

  /** Writes it all down once the marks have stopped arriving. */
  private later() {
    if (this.writing !== undefined) return
    this.writing = setTimeout(() => {
      this.writing = undefined
      this.write()
    }, QUIET)
  }

  /** The index lists every picture that may have a key before the key is written and
   *  after it is gone, so a run cut short leaves no picture nothing can find again. */
  write() {
    clearTimeout(this.writing)
    this.writing = undefined
    const index = this.index()

    const wanted = new Set([...index.values()].map(([id]) => id))
    const adding = [...this.unwritten].filter(([id]) => wanted.has(id))
    this.unwritten.clear()

    if (adding.length) {
      this.put(index, [...this.sizes, ...adding.map(([id, one]) => [id, one.length] as const)])
    }
    for (const [id, picture] of adding) {
      if (keep(PICTURE + id, picture)) this.sizes.set(id, picture.length)
    }
    for (const id of this.sizes.keys()) {
      if (wanted.has(id)) continue
      forget(PICTURE + id)
      this.sizes.delete(id)
    }
    // What a page redrew and nothing shows any more, so a mark that changes every second
    // holds a couple of seconds of pictures in memory and not an afternoon of them.
    for (const id of this.pictures.keys()) if (!wanted.has(id)) this.pictures.delete(id)

    this.put(index, this.sizes)
  }

  private put(index: Map<string, Held>, sizes: Iterable<readonly [string, number]>) {
    keep(
      INDEX,
      JSON.stringify({ pages: Object.fromEntries(index), sizes: Object.fromEntries(sizes) }),
    )
  }
}

export const favicons = new Favicons()

/** The one answer to which picture a site wears: the live page's own, else the last one
 *  this device saw at the address, else the one a file wrote down, else null for the
 *  globe. Every surface that draws a site's mark asks this and nothing else. */
export function siteMark(
  live: string | null | undefined,
  url: string | null | undefined,
  written?: string | null,
): string | null {
  return live ?? favicons.of(url) ?? written ?? null
}
