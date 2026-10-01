/** The engine's requests, as HTTP: the routes of docs/sync-v2.md section 7, in the
 *  framed envelope both ends speak (`frame` in @nib/sync-core/wire), so a Yjs update
 *  travels as its bytes.
 *
 *  What a pass needs to hear is one of three things. An answer. No answer - the network
 *  is down, the account is busy (a 429, a 5xx) - which a pass reads as "stop here and
 *  try again later", and which is what keeps the corner light hollow rather than red. Or
 *  a refusal of the request itself: a session that has ended (401, which signs the app
 *  out the way every other request does), or something the account will not do for
 *  this person (403, 404), which the step that asked decides about. */

import { frame, unframe } from '@nib/sync-core/wire'
import type { Account, Route } from './world'

/** A request the account refused outright, rather than one that went unanswered. */
export class Refused extends Error {
  override name = 'Refused'
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const OCTETS = 'application/octet-stream'

/** Where each route is. */
function pathOf(route: Route, space: string, body: unknown): string {
  const at = encodeURIComponent(space)
  switch (route) {
    case 'prepare':
    case 'ops':
      return `/v2/spaces/${at}/${route}`
    case 'feed': {
      const since =
        typeof body === 'object' && body !== null && 'since' in body ? Number(body.since) : 0
      return `/v2/spaces/${at}/feed?since=${String(Number.isFinite(since) ? since : 0)}`
    }
    case 'pull':
    case 'push':
    case 'keep':
      return `/v2/docs/${route}`
  }
}

export interface Reaching {
  /** The service's address, with no slash at the end. */
  base: string
  token: () => string | null
  /** What this device is called: the name a version it sends is written under. */
  device: () => string
  /** `fetch`, or a stand-in for it. */
  fetch: (request: Request) => Promise<Response>
}

/** The account, over HTTP. */
export function accountOver(reaching: Reaching): Account {
  return {
    async ask(route, body, space) {
      const token = reaching.token()
      if (!token) return null
      const reading = route === 'feed'
      const request = new Request(`${reaching.base}${pathOf(route, space, body)}`, {
        method: reading ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: OCTETS,
          'x-nib-device': reaching.device(),
          ...(reading ? {} : { 'content-type': OCTETS }),
        },
        ...(reading ? {} : { body: new Uint8Array(frame(body)) }),
      })

      let response: Response
      try {
        response = await reaching.fetch(request)
      } catch {
        // No network, or none that reaches the service.
        return null
      }
      if (response.status === 429 || response.status >= 500) return null
      if (!response.ok) {
        const said = await response.json().catch(() => null)
        const error =
          typeof said === 'object' && said !== null && 'error' in said ? String(said.error) : ''
        throw new Refused(response.status, error || `request failed (${String(response.status)})`)
      }
      return unframe(new Uint8Array(await response.arrayBuffer()))
    },
  }
}
