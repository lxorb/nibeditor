/** Sync v2's routes: a space's tree and feed, documents in batches, and the files of a
 *  space (docs/sync-v2.md section 7). Behind the session guard like `/v1`; what a
 *  guest and a program token may reach is said in guests.ts and programs.ts. Every
 *  request is answered in the shape it arrived in; see envelope.ts. */

import { keepRequestOf, opsRequestOf, pullRequestOf, pushRequestOf } from '@nib/sync-core'
import { Hono } from 'hono'
import { laterOf, pokeSpace } from '../hub/poke'
import { mayChangeTree, mayPushDocuments } from '../limits'
import { NO_SUCH_NOTE, TOO_MANY_CHANGES } from '../refused'
import { atLeast, refusal, spaceOf } from '../spaces/space'
import type { Env, Variables, Whoever } from '../types'
import { deviceIn } from '../versions'
import { deviceOf } from './device'
import { keepDoc, pullDocs, pushDocs, snapshotPage } from './docs'
import { answer, requestBody } from './envelope'
import { feedPage } from './feed'
import { reproject } from './maps'
import { applyOps } from './ops'
import { preparedSpace, prepareSpace } from './prepare'

type App = { Bindings: Env; Variables: Variables }

/** What a request that is not the one the route reads is told. A correct client never
 *  sends one, so this reaches no reader and has no catalogue row. */
const NOT_A_REQUEST = 'that is not a request this route reads'

/** Whose ceilings a request counts against: the account's, or the guest's. */
function whoseId(who: Whoever): string {
  return who.kind === 'user' ? who.user.id : who.guest.id
}

/** A cursor off a query string: a whole number the space handed out, or the start. */
function cursorIn(value: string | undefined): number {
  const asked = Math.floor(Number(value ?? 0))
  return Number.isFinite(asked) && asked > 0 ? asked : 0
}

export const v2Spaces = new Hono<App>()

/** The space's tree made into rows, the first time a v2 device asks; see prepare.ts.
 *  Any member may ask, since reading the tree is all it lets them do. */
v2Spaces.post('/:space/prepare', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const cursor = await prepareSpace(context.env, space.id, await deviceOf(context))
  return answer(context, { cursor })
})

/** A device's tree operations, applied in the order they arrive; see ops.ts. */
v2Spaces.post('/:space/ops', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const request = opsRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)
  if (!(await mayChangeTree(context.env, whoseId(context.get('who'))))) {
    return context.json({ error: TOO_MANY_CHANGES }, 429)
  }

  const device = await deviceOf(context)
  await preparedSpace(context.env, space, device)
  const done = await applyOps(context.env, space, device, request.ops)
  if (done.changed) {
    // What a v1 app reads of the folders' icons and order is keyed by path.
    await reproject(context.env, space.id)
    await pokeSpace(context.env, laterOf(context), space.id, done.cursor, device)
  }

  return answer(context, { results: done.value, cursor: done.cursor })
})

/** What changed since a cursor, the tree and the words in one order; see feed.ts. */
v2Spaces.get('/:space/feed', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  await preparedSpace(context.env, space)
  return answer(context, await feedPage(context.env, space.id, cursorIn(context.req.query('since'))))
})

/** A first sync's bulk read: the space's documents, a few megabytes a page. */
v2Spaces.get('/:space/snapshot', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  await preparedSpace(context.env, space)
  const after = context.req.query('after') ?? ''
  return answer(context, await snapshotPage(context.env, space.id, after))
})

export const v2Docs = new Hono<App>()

/** What a device is missing of each document; never wakes a room. */
v2Docs.post('/pull', async (context) => {
  const request = pullRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)
  return answer(context, { docs: await pullDocs(context.env, context.get('who'), request.docs) })
})

/** A device's pending edits, each to its document's room. */
v2Docs.post('/push', async (context) => {
  const request = pushRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)
  const who = context.get('who')
  if (!(await mayPushDocuments(context.env, whoseId(who)))) {
    return context.json({ error: TOO_MANY_CHANGES }, 429)
  }

  const docs = await pushDocs(
    context.env,
    who,
    await deviceOf(context),
    deviceIn(context.req.header('x-nib-device')),
    request.docs,
  )
  return answer(context, { docs })
})

/** The losing side of a modal answer, kept as a version. */
v2Docs.post('/keep', async (context) => {
  const request = keepRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)

  const kept = await keepDoc(context.env, context.get('who'), request)
  if (kept === 'gone') return context.json({ error: NO_SUCH_NOTE }, 404)
  if (kept === 'role') return context.json({ error: refusal('write') }, 403)
  return answer(context, { ok: true })
})
