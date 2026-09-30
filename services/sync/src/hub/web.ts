/** A site's login as the account keeps it: encrypted on a device, uploaded by the
 *  device holding the site's lease, and read back by the next one.
 *
 *  `PUT /v2/web/:key` is a manifest, and goes through the hub, which checks the
 *  fence and writes it; everything that can be refused without the hub is refused
 *  here first, so a hub is only woken by an upload that can land. The manifest
 *  names its chunks in `x-nib-chunks`, which is how the ceiling on one site is
 *  measured and how the chunks nobody names any more are let go of; the names are
 *  HMACs, so the list says nothing the sizes did not. `PUT /v2/web/chunks/:name` is
 *  a chunk, named by its contents, so it needs no fence. Both `GET`s read the bucket
 *  and nothing else: a download never wakes a hub.
 *
 *  Programs and guests reach none of this; see programs.ts and guests.ts. See
 *  docs/sync-v2.md sections 6.5 and 7. */

import { Hono } from 'hono'
import { FENCED, OUT_OF_SPACE, TRY_IN_AN_HOUR } from '../refused'
import { mayUploadWebState } from '../limits'
import type { Env, Variables } from '../types'
import { MOST_BUNDLE, WEB_QUOTA, chunkName, chunksHeld, stateName, webBytes } from './bucket'
import { deviceOfSession } from './devices'
import { OPAQUE, isGeneration } from './frames'
import { askHub, HUB_AWAY } from './reach'
import { now } from '../crypto'

/** A site's state past what one site may keep. The app leaves out what would not
 *  fit before it uploads (docs/sync-v2.md 6.3), so a correct client never hears this
 *  and it has no catalogue row. The account being full is the service's own `out of
 *  space`, the one sentence every 507 here says. */
const TOO_BIG = 'that is more than one site can keep'
const NOT_A_NAME = 'that is not a name this can keep'
const EMPTY = 'there are no bytes to keep'

/** How many chunks one manifest may name: one per IndexedDB database of a site,
 *  and far past what any site keeps. */
const MOST_CHUNKS = 64

/** The chunk names a manifest carries, or null for a header that is not a list of
 *  them. */
function chunkList(header: string | undefined): string[] | null {
  const names = (header ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean)
  if (names.length > MOST_CHUNKS || !names.every((one) => OPAQUE.test(one))) return null
  return [...new Set(names)]
}

/** The body, or null for one past the ceiling. What a request says it brings is
 *  asked first, so a hundred megabytes is turned away without spending the memory
 *  to find out, and what arrived is measured after, since the header can lie. */
async function bodyWithin(request: Request): Promise<ArrayBuffer | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MOST_BUNDLE) return null
  const body = await request.arrayBuffer()
  return body.byteLength > MOST_BUNDLE ? null : body
}

/** The object as a download: its bytes, and what the hub wrote on it. */
function served(object: R2ObjectBody | null): Response | null {
  if (!object) return null

  const headers = new Headers({ 'content-type': 'application/octet-stream' })
  for (const [name, value] of Object.entries(object.customMetadata ?? {})) {
    headers.set(`x-nib-${name}`, value)
  }
  return new Response(object.body, { headers })
}

export const web = new Hono<{ Bindings: Env; Variables: Variables }>()

web.put('/chunks/:name', async (context) => {
  const user = context.get('user')
  const name = context.req.param('name')
  if (!OPAQUE.test(name)) return context.json({ error: NOT_A_NAME }, 400)

  const device = await deviceOfSession(context.env, user.id, context.req.header('authorization'))
  if (!device) return context.json({ error: FENCED }, 409)

  // Named by its contents, so one already here is this one: kept another hour
  // from being let go of, since a state is about to name it again.
  const touched = await context.env.DB.prepare(
    'update web_chunks set at = ? where user_id = ? and name = ?',
  )
    .bind(now(), user.id, name)
    .run()
  if (touched.meta.changes) return context.json({ name, stored: false })

  const body = await bodyWithin(context.req.raw)
  if (!body) return context.json({ error: TOO_BIG }, 413)
  if (!body.byteLength) return context.json({ error: EMPTY }, 400)

  const { used } = await webBytes(context.env, user.id, null)
  if (used + body.byteLength > WEB_QUOTA) return context.json({ error: OUT_OF_SPACE }, 507)

  await context.env.NOTES.put(chunkName(user.id, name), body, {
    httpMetadata: { contentType: 'application/octet-stream' },
  })
  await context.env.DB.prepare(
    `insert into web_chunks (user_id, name, size, at) values (?, ?, ?, ?)
     on conflict(user_id, name) do update set at = excluded.at`,
  )
    .bind(user.id, name, body.byteLength, now())
    .run()

  return context.json({ name, stored: true }, 201)
})

web.get('/chunks/:name', async (context) => {
  const name = context.req.param('name')
  if (!OPAQUE.test(name)) return context.json({ error: NOT_A_NAME }, 400)

  const object = await context.env.NOTES.get(chunkName(context.get('user').id, name))
  return served(object) ?? context.json({ error: 'no such chunk' }, 404)
})

web.put('/:key', async (context) => {
  const user = context.get('user')
  const key = context.req.param('key')
  if (!OPAQUE.test(key)) return context.json({ error: NOT_A_NAME }, 400)

  const fence = Number(context.req.header('x-nib-fence') ?? '')
  const generation = Number(context.req.header('x-nib-generation') ?? '')
  const chunks = chunkList(context.req.header('x-nib-chunks'))
  if (!Number.isSafeInteger(fence) || fence < 1 || !isGeneration(generation) || !chunks) {
    return context.json({ error: 'name the fence, the key generation and the chunks' }, 400)
  }

  const device = await deviceOfSession(context.env, user.id, context.req.header('authorization'))
  if (!device) return context.json({ error: FENCED }, 409)

  const body = await bodyWithin(context.req.raw)
  if (!body) return context.json({ error: TOO_BIG }, 413)
  if (!body.byteLength) return context.json({ error: EMPTY }, 400)

  const held = await chunksHeld(context.env, user.id, chunks)
  if (held.found < chunks.length) {
    return context.json({ error: 'upload the chunks it names first' }, 400)
  }
  if (body.byteLength + held.bytes > MOST_BUNDLE) return context.json({ error: TOO_BIG }, 413)

  const { used, replaced } = await webBytes(context.env, user.id, key)
  if (used - replaced + body.byteLength > WEB_QUOTA) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  if (!(await mayUploadWebState(context.env, user.id, key))) {
    return context.json({ error: TRY_IN_AN_HOUR }, 429)
  }

  const answer = await askHub(
    context.env,
    user.id,
    'upload',
    {
      'x-nib-user': user.id,
      'x-nib-key': key,
      'x-nib-device': device,
      'x-nib-fence': String(fence),
      'x-nib-generation': String(generation),
      'x-nib-chunks': chunks.join(','),
    },
    body,
  )

  if (!answer) {
    return context.json({ error: HUB_AWAY }, 503, {
      'retry-after': '1',
    })
  }
  // A response from another object has headers nothing may change, and the ones
  // this service adds on the way out have to go somewhere.
  return new Response(answer.body, answer)
})

web.get('/:key', async (context) => {
  const key = context.req.param('key')
  if (!OPAQUE.test(key)) return context.json({ error: NOT_A_NAME }, 400)

  const object = await context.env.NOTES.get(stateName(context.get('user').id, key))
  return served(object) ?? context.json({ error: 'no such state' }, 404)
})
