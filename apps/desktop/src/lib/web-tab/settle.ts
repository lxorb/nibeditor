/** Two copies of one web note, made into one.
 *
 *  Emil, 2026-10-03: *"Still getting a lot of name-clash files for web notes."* A web
 *  note is a browser tab written down - where the reading has got to, what it is
 *  called, the site's mark - and the file moves under the reader every time a link is
 *  followed (see keep.ts). Two devices with the same site open write it within
 *  seconds of each other, and a copy beside it for every one of those is a file list
 *  full of `Docs (from another device 2026-10-03).url`. Nobody wants to compare two
 *  bookmarks by hand, and nothing is in one that matters once the other is newer.
 *
 *  So a web note is never kept twice: the newer copy stands, which is what Obsidian
 *  Sync does with every file that is not markdown, and the fields one side says and
 *  the other does not are carried across. Where the reading is, what it is called and
 *  where it points come from the newer side; the site's mark from whichever has one,
 *  the newer first; when it was first written down is the earlier of the two. Pure,
 *  so each place that settles two copies - a pass, a refused push, an answer in the
 *  sync pane, and the sweep over the copies already made - settles them the same way.
 *  See sync/pass.ts and sync/web-copies.ts. */

import { readWebFile, type Shortcut, writeShortcut } from './shortcut'

/** The one file two copies of the web note at `path` come to. `theirsNewer` says
 *  which side was written last. A side that is not a shortcut at all - a `.webloc`,
 *  a file somebody broke by hand - has no fields to carry, so the newer side stands
 *  as it is. */
export function settleShortcuts(
  path: string,
  ours: string,
  theirs: string,
  theirsNewer: boolean,
): string {
  if (ours === theirs) return ours

  const [newer, older] = theirsNewer ? [theirs, ours] : [ours, theirs]
  const fresh = readWebFile(path, newer)
  const stale = readWebFile(path, older)
  if (!fresh || !stale || /\.webloc$/i.test(path.trim())) return newer

  const settled = writeShortcut(
    fresh.url,
    fresh.title ?? stale.title ?? '',
    firstAdded(fresh, stale),
    fresh.home ?? fresh.url,
    fresh.icon ?? stale.icon,
  )

  // Nothing the older side said is missing from the newer one: the newer file as it
  // was written, rather than rewritten in this app's own spelling of it.
  return sameShortcut(readWebFile(path, settled), fresh) ? newer : settled
}

/** Whether two copies are the same web note: they point at the same place. Where
 *  the reading has got to, the title and the mark are a tab's state, which the newer
 *  side settles; an address somebody typed is what the note is. */
export function sameWebNote(path: string, one: string, other: string): boolean {
  const a = readWebFile(path, one)
  const b = readWebFile(path, other)
  if (!a || !b) return one === other

  return (a.home ?? a.url) === (b.home ?? b.url)
}

/** The earlier of the two times a copy says it was written down, or now where
 *  neither says one that reads. */
function firstAdded(one: Shortcut, other: Shortcut): Date {
  const times = [one.added, other.added]
    .map((said) => (said ? new Date(said).getTime() : Number.NaN))
    .filter((time) => !Number.isNaN(time))

  return new Date(times.length ? Math.min(...times) : Date.now())
}

function sameShortcut(one: Shortcut | null, other: Shortcut): boolean {
  return (
    one !== null &&
    one.url === other.url &&
    one.title === other.title &&
    one.added === other.added &&
    (one.home ?? null) === (other.home ?? null) &&
    one.icon === other.icon
  )
}

/** Whether two addresses are on one site: the same host, `www.` aside. What makes a
 *  web tab saved under a name a web note already has the same note rather than a
 *  second one; see `keepWeb` in workspace/placing.ts. */
export function sameSite(one: string | null | undefined, other: string | null | undefined) {
  const host = hostIn(one)
  return host !== null && host === hostIn(other)
}

function hostIn(address: string | null | undefined): string | null {
  if (!address) return null
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}
