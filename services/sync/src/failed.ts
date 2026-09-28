/** What is written down when something goes wrong, and what is answered back.
 *
 *  A throw used to reach Hono's own handler, which answers `Internal Server
 *  Error` as plain text and leaves nothing behind that a query can find. The
 *  service answered thirteen of those in four days and not one could be traced
 *  even as far as a route: Workers Logs keeps a sample of invocations, a bare
 *  throw adds nothing to it, and `wrangler tail` only ever shows what is
 *  happening now. So every failure comes through here instead.
 *
 *  One line goes to the log, as a JSON object rather than a sentence so that a
 *  log query can filter on a field instead of a substring: where it happened,
 *  what the error calls itself, what it said, and the ray the request came in
 *  with, which is the one identifier that also appears in the HTTP analytics.
 *  Nothing else. Not a body, not an address, not a token: the route and the
 *  error's own words are what makes the next one diagnosable, and whose sign-in
 *  it was is neither needed for that nor ours to keep.
 *
 *  What comes back is JSON with the same two fields whatever failed, because a
 *  client that reads `error` out of every other refusal should not have to
 *  special-case the one that is a bug. `id` is the ray, which is what somebody
 *  reporting it can be asked for. */

import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env, Variables } from './types'

/** Long enough to say what went wrong, short enough that a provider answering
 *  with a page of HTML does not become the log entry. */
const SAID_LIMIT = 300

/** An address is not what this log is for, and a mail provider refusing one
 *  tends to quote it back. */
function withoutAddresses(said: string): string {
  return said.replace(/[^\s@<>,;:"'()[\]]+@[^\s@<>,;:"'()[\]]+/g, '<address>')
}

/** Writes one failure down. `at` is where it happened - a route, or the name of
 *  the one thing in a route that reaches the network - and `id` is the request's
 *  ray where there is a request to ask. */
export function note(at: string, error: unknown, id: string | null): void {
  const named = error instanceof Error ? error : null
  const said = named ? named.message : String(error)

  // Cloudflare's own errors carry a code beside the sentence - Email Sending's
  // `E_SENDER_NOT_VERIFIED`, `E_RECIPIENT_SUPPRESSED` - and the code is the part
  // a query can count and the docs can be searched for.
  const coded = (error as { code?: unknown } | null)?.code
  const code = typeof coded === 'string' ? coded : undefined

  console.error(
    JSON.stringify({
      failed: at,
      name: named?.name ?? typeof error,
      code,
      said: withoutAddresses(said).slice(0, SAID_LIMIT),
      id,
    }),
  )
}

/** Everything a route threw rather than answered. Registered once, in index.ts. */
export function failed(
  error: Error,
  context: Context<{ Bindings: Env; Variables: Variables }>,
): Response {
  // A refusal something raised on purpose already carries the answer it chose,
  // and turning one of those into a 500 would be this handler inventing a bug.
  if (error instanceof HTTPException) return error.getResponse()

  const id = context.req.header('cf-ray') ?? null
  note(`${context.req.method} ${new URL(context.req.url).pathname}`, error, id)

  return context.json({ error: 'something went wrong here - try again', id }, 500)
}
