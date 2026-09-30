/** The site a rule is about, from whatever the reader typed (docs/agent-native.md 9.2).
 *
 *  Chrome's "Add a site" takes an address in any of the shapes somebody has one in -
 *  pasted from the bar with its path, typed bare, with Chrome's own `[*.]` in front -
 *  and so does this. What it keeps is the **site**, the registrable domain
 *  (`siteOf` in web-tab/web-data.ts): a rule about the bank is about every host of the
 *  bank's, because the crate matches a rule by suffix (`covers` in policy.rs), and
 *  `mail.google.com` typed to keep mail to the agent's own store keeps the whole of
 *  Google's sign-in to it, which is the leg the reader meant to take away.
 *
 *  Refused rather than guessed: anything that is not a web address, a name with no dot
 *  (`gmail` is a typo, not an intranet), and a public suffix on its own (`co.uk`), which
 *  would be a rule about every site under it. */

import { hostOf, siteOf } from '../../web-tab/web-data'

/** The public suffix list's answer for a host: its registrable domain, or null for an
 *  address, a single name or a suffix on its own. Handed in, because the list is a
 *  hundred kilobytes fetched only when a site is added; see `registrable`. */
export type Registrable = (host: string) => string | null

/** A scheme in front, as an address pasted from the bar has. */
const SCHEMED = /^[a-z][a-z0-9+.-]*:\/\//

/** An address with nothing registrable about it, which is its own site. */
const NUMERIC = /^(\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:.]+\]$/

export function typedSite(typed: string, registrable: Registrable): string | null {
  const text = typed
    .trim()
    .toLowerCase()
    .replace(/^\[\*\.\]|^\*\./, '')
  if (!text || /\s/.test(text)) return null

  const host = hostOf(SCHEMED.test(text) ? text : `https://${text}`)?.replace(/\.$/, '')
  if (!host) return null
  if (host === 'localhost' || NUMERIC.test(host)) return host
  if (!host.includes('.') || registrable(host) === null) return null

  return siteOf(host, registrable)
}

/** The public suffix list, fetched the first time a site is added. Private suffixes
 *  count, so two people's pages on `github.io` are two sites, as a browser keeps them. */
export async function registrable(): Promise<Registrable> {
  const { getDomain } = await import('tldts')
  return (host) => getDomain(host, { allowPrivateDomains: true })
}
