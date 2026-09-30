/** What a v2 request carries, and what it is answered in.
 *
 *  Two shapes, one meaning. Anything with a Yjs update or a state vector in it travels
 *  as `@nib/sync-core`'s framed envelope (`application/octet-stream`: a JSON header,
 *  then the bytes, because base64 would cost a third more on every update); a request
 *  with nothing binary in it may be plain JSON. A request is answered in the shape it
 *  arrived in, or asked for with `accept`, so a device that frames everything and a
 *  script that speaks JSON both read their own answer. See docs/sync-v2.md section 7. */

import { frame, type Framed, unframe } from '@nib/sync-core'
import type { Context } from 'hono'
import { MOST_BODY_BYTES } from '../body'

const OCTETS = 'application/octet-stream'

/** The body, still unknown until a check has read it; undefined for one that is not
 *  an envelope, not JSON, or longer than any route reads. */
export async function requestBody(context: Context): Promise<unknown> {
  const said = Number(context.req.header('content-length') ?? '')
  if (Number.isFinite(said) && said > MOST_BODY_BYTES) return undefined

  const type = context.req.header('content-type') ?? ''
  if (type.startsWith(OCTETS)) {
    const bytes = new Uint8Array(await context.req.arrayBuffer())
    if (bytes.length > MOST_BODY_BYTES) return undefined
    return unframe(bytes) ?? undefined
  }

  try {
    return await context.req.json()
  } catch {
    // Not JSON: the route answers that it could not read the request.
    return undefined
  }
}

/** Whether the asker reads envelopes: it sent one, or asked for one. */
function framed(context: Context): boolean {
  const type = context.req.header('content-type') ?? ''
  const accept = context.req.header('accept') ?? ''
  return type.startsWith(OCTETS) || accept.includes(OCTETS)
}

/** An answer in the shape the asker reads. Bytes in a JSON answer go as plain lists of
 *  numbers, which is what a script that asked in JSON can read without a codec. */
export function answer(context: Context, value: Framed, status: 200 | 201 = 200): Response {
  if (framed(context)) {
    return new Response(frame(value), { status, headers: { 'content-type': OCTETS } })
  }
  return context.json(JSON.parse(JSON.stringify(value, bytesAsNumbers)) as object, status)
}

function bytesAsNumbers(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array ? [...value] : value
}
