/** Where a space keeps what websites store: cookies, logins, `localStorage`, caches.
 *
 *  Emil, 2026-09-27: *"there should be a setting for a space where you can set on which
 *  granularity to save the website data. either global (default) which just uses the
 *  global cookies and data store of nib or per space which saves it per space or per
 *  site which makes it separate for each site in this space."*
 *
 *  Three answers, and the first is what every space has always had:
 *
 *  - **global** - the one store every space shares. Signed in once, signed in everywhere.
 *  - **space** - a store of this space's own, so a work space and a home space can be
 *    signed in to the same site as two different people.
 *  - **site** - within this space, a store per site, so no site sees what another one
 *    left behind.
 *
 *  This file names the stores; the crate makes them (src-tauri/src/web_stores.rs). A
 *  name is the whole of a store's identity, so a name has to come out the same on every
 *  launch - which is why it is made of the space's id and never of its name or folder,
 *  both of which a rename changes. Pure, so the naming is tested without a window. */

/** How far apart a space keeps what websites store. */
export type WebData = 'global' | 'space' | 'site'

/** The three, in the order they are offered: from sharing everything to sharing
 *  nothing. */
export const WEB_DATA: readonly WebData[] = ['global', 'space', 'site']

export function isWebData(value: unknown): value is WebData {
  return value === 'global' || value === 'space' || value === 'site'
}

/** The characters a store's name may hold, which is what the crate takes as a folder
 *  name; anything else in an id or a host is written as `-`. */
const UNSAFE = /[^a-z0-9.-]/g

/** The longest name the crate takes; see `LONGEST` in web_stores.rs. */
const LONGEST = 160

/** The host of a web address, as the address itself spells it: lower case, and an
 *  international name in its ASCII form, because that is what `URL` hands back. Null
 *  for anything that is not a web address. */
export function hostOf(url: string | null): string | null {
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.hostname || null
  } catch {
    return null
  }
}

/** The site a host belongs to, which is what a store is kept for under **site**.
 *
 *  **A site is the registrable domain** - the part of the host a person could have
 *  registered, one label under a public suffix: `moodle-app2.let.ethz.ch` and
 *  `aai-logon.ethz.ch` are both `ethz.ch`, `a.github.io` and `b.github.io` are two sites,
 *  `bbc.co.uk` is `bbc.co.uk` and not `co.uk`. It is what a browser calls a site when
 *  it keeps sites apart from one another - Chrome's site isolation, `SameSite` cookies,
 *  storage partitioning all draw the line here - so a store per site is separate
 *  exactly where a browser already treats two pages as strangers.
 *
 *  It is also what keeps a sign-in working. A login that passes through a sister host
 *  - Moodle to ETH's identity provider and back - stays within one site and so within
 *  one store; a store per host would sign the reader in at the identity provider and
 *  leave Moodle none the wiser. A login through somebody else's domain happens inside
 *  the tab it started in, whose store is the site the tab is on, so it works there too.
 *
 *  `registrable` is the public suffix list's answer, handed in because the list is a
 *  hundred kilobytes that only a space kept per site ever needs; see web-data.svelte.ts.
 *  A host with no registrable domain - an address, `localhost` - is its own site, which
 *  is what a browser does with those too. */
export function siteOf(host: string, registrable: (host: string) => string | null): string {
  return registrable(host) ?? host
}

/** The name of the store a page goes in, or null for the one every space shares.
 *
 *  `space_<id>` for a space of its own, `site_<id>_<site>` for one site within it. The
 *  underscore is the one character neither an id nor a host holds, so no two of these
 *  can be spelled alike. A site with nothing to name - a page with no host - is in the
 *  space's own store rather than in a store of nothing. */
export function storeName(choice: WebData, space: string, site: string | null): string | null {
  if (choice === 'global') return null

  const id = space.toLowerCase().replace(UNSAFE, '-')
  if (choice === 'space' || !site) return `space_${id}`

  return `site_${id}_${site.toLowerCase().replace(UNSAFE, '-')}`.slice(0, LONGEST)
}

/** Where the address field's history of a space is kept: the one list for a space
 *  that shares the global store, a list of its own for one that keeps its data apart.
 *  A space that signs in apart and then offered the other spaces' pages as you typed
 *  would be keeping its cookies apart and telling everything else. A space kept per site
 *  keeps one list for the space, because the list is the space's and not a site's. */
export function historyKey(choice: WebData, space: string | null): string {
  return choice === 'global' || !space ? 'nib:web-visits' : `nib:web-visits:${space}`
}

/** Which space a page belongs to: the one whose folder holds its note, or the space
 *  that is open for a tab with no note yet, which is the space it was opened in. */
export function spaceOf(
  path: string | null,
  spaces: readonly { id: string; root: string }[],
  open: string | null,
): string | null {
  if (!path) return open

  const at = path.replaceAll('\\', '/')
  const holding = spaces.find((space) => {
    const root = space.root.replaceAll('\\', '/').replace(/\/+$/, '')
    return at.startsWith(`${root}/`)
  })

  return holding?.id ?? open
}
