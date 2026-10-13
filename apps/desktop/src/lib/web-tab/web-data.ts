/** The names of the stores a space kept its web data in, when a space could (2026-09-27 to
 *  2026-10-13), and what a site is.
 *
 *  A space chose global (the one store every space shares), space (a store of its own,
 *  `space_<id>`) or site (a store per site within it, `site_<id>_<site>`). The choice is
 *  gone (#239): every page shares one store and a web note may keep its own
 *  (web-data.svelte.ts). The names stay, because the stores a space kept are found by
 *  them to be merged into the shared one (merged.ts), and the crate still takes them
 *  (src-tauri/src/web_stores.rs). A name was made of the space's id and never of its name
 *  or folder, both of which a rename changes. Pure, so the naming is tested without a
 *  window. */

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
