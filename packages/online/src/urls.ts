/** The addresses a machine may hand its owner's computer, and the one kind it may be
 *  handed back (docs/online-terminal.md 4.13).
 *
 *  A program on the machine asking for a browser - `gh auth login --web`, Claude Code's
 *  sign-in, Python's `webbrowser` - is asking for one on the person's own computer: the
 *  machine has no screen. So `nib-open` hands the address up the link, and the owner's
 *  nib opens it. Only the web: an address in any other scheme would hand a file, a mail
 *  program or an app on the person's computer to a program on a machine.
 *
 *  And the one thing VS Code's port forwarding is there for in a sign-in: the page the
 *  provider sends the browser back to is `http://localhost:<port>/callback` - the
 *  program's own listener, on the machine and not on the computer the browser runs on.
 *  So an address that names such a page is opened in a tab nib watches, and when the tab
 *  lands there, that one request is made on the machine instead (`callback`). Only to a
 *  loopback origin the opened address itself named, so a page cannot steer the machine
 *  anywhere it was not already sent. Pure. */

/** The longest address either way. A sign-in address with its scopes and challenge is
 *  well under two kilobytes; eight is a page's worth of room. */
export const LONGEST_URL = 8192

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parsed(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** Whether an address is the web's, `http` or `https`, and not too long. */
export function isWebUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > LONGEST_URL) return false
  const one = parsed(url)
  return one !== null && (one.protocol === 'http:' || one.protocol === 'https:')
}

/** The loopback origin an address is on, `http://localhost:1455`, with a port, or null
 *  for any other address: a callback listener always names its port. */
export function loopbackOrigin(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > LONGEST_URL) return null
  const one = parsed(url)
  if (one?.protocol !== 'http:' || !one.port) return null
  return LOOPBACK_HOSTS.has(one.hostname.toLowerCase()) ? one.origin : null
}

/** Whether an address is on a loopback origin: what a callback may be. */
export function isLoopbackUrl(url: unknown): url is string {
  return loopbackOrigin(url) !== null
}

/** The loopback origins an opened address sends the browser back to: every value of its
 *  query that is itself a loopback address (`redirect_uri`, `redirect_url`,
 *  `callback`...), whatever the parameter is called. Empty for an address that names
 *  none. */
export function callbacksIn(url: string): string[] {
  const one = parsed(url)
  if (!one) return []
  const found = new Set<string>()
  for (const value of one.searchParams.values()) {
    const origin = loopbackOrigin(value)
    if (origin) found.add(origin)
  }
  return [...found]
}

/** Whether `landed`, where a tab arrived, is the callback `opened` sent it back to. */
export function isCallbackOf(opened: string, landed: string): boolean {
  const origin = loopbackOrigin(landed)
  return origin !== null && callbacksIn(opened).includes(origin)
}

/** The host an address is shown by, `github.com`. */
export function hostOf(url: string): string {
  return parsed(url)?.host ?? url
}
