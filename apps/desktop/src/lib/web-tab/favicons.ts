/** Writing down the marks pages show: the half of the favicon cache no frame waits for,
 *  so it is fetched with the first mark rather than carried into the first paint. The
 *  reading, and why it is kept the way it is, is `favicons` in pages.svelte.ts.
 *
 *  Only what a page showed is written, and nothing is fetched to fill it. One mark per
 *  page, so an unread count redrawn replaces rather than piles up - Firefox bug 1598371
 *  stored 207,000 of those - under `MOST_PAGES` and `MOST_TEXT`, the least recently used
 *  going first. */

import { forget as unkeep, keep } from '../stored'
import { drawable, favicons, keysOf, MARK, MARKS, type Seen } from './pages.svelte'

/** As many pages as the history keeps visits, and half a megabyte of pictures. */
const MOST_PAGES = 500
const MOST_TEXT = 512 * 1024

/** Writes wait for the marks to stop arriving: a page reports its mark several times as
 *  it lands. */
const QUIET = 2000

let writing: ReturnType<typeof setTimeout> | undefined

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

/** A page at `url` shows `picture` now. */
export function saw(url: string | null | undefined, picture: string) {
  const keys = keysOf(url)
  if (!keys || !drawable(picture)) return

  const id = idOf(picture)
  const index = favicons.index()
  const now = Date.now()
  const same = keys.every((key) => index.get(key)?.[0] === id)
  for (const key of keys) index.set(key, [id, now])
  if (same) return

  if (!favicons.sizes.has(id)) favicons.unwritten.set(id, picture)
  favicons.pictures.set(id, picture)
  within(index)
  favicons.changed++
  later()
}

/** Nothing is kept for this page any more, nor for its origin: a page forgotten from a
 *  history is forgotten here too. */
export function forget(url: string | null | undefined) {
  const keys = keysOf(url)
  if (!keys) return

  const index = favicons.index()
  if (keys.map((key) => index.delete(key)).includes(true)) {
    favicons.changed++
    later()
  }
}

/** Under both ceilings, the least recently used page going first. */
function within(index: Map<string, Seen>) {
  const holders: Record<string, number> = {}
  for (const [id] of index.values()) holders[id] = (holders[id] ?? 0) + 1

  const size = (id: string) =>
    favicons.sizes.get(id) ??
    favicons.unwritten.get(id)?.length ??
    favicons.pictures.get(id)?.length ??
    0
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
export function later() {
  writing ??= setTimeout(write, QUIET)
}

/** The index lists every picture that may have a key before the key is written and after
 *  it is gone, so a run cut short leaves no picture nothing can find again. */
export function write() {
  clearTimeout(writing)
  writing = undefined
  const index = favicons.index()
  const { sizes, pictures, unwritten } = favicons

  const wanted = new Set([...index.values()].map(([id]) => id))
  const adding = [...unwritten].filter(([id]) => wanted.has(id))
  unwritten.clear()

  if (adding.length) {
    put(index, [...sizes, ...adding.map(([id, one]) => [id, one.length] as const)])
  }
  for (const [id, picture] of adding) {
    if (keep(MARK + id, picture)) sizes.set(id, picture.length)
  }
  for (const id of sizes.keys()) {
    if (wanted.has(id)) continue
    unkeep(MARK + id)
    sizes.delete(id)
  }
  // What a page redrew and nothing shows any more, so a mark that changes every second
  // holds a couple of seconds of pictures in memory and not an afternoon of them.
  for (const id of pictures.keys()) if (!wanted.has(id)) pictures.delete(id)

  put(index, sizes)
}

function put(index: Map<string, Seen>, sizes: Iterable<readonly [string, number]>) {
  keep(
    MARKS,
    JSON.stringify({ pages: Object.fromEntries(index), sizes: Object.fromEntries(sizes) }),
  )
}
