/** Which web store a space's pages live in, chosen once for every computer.
 *
 *  A web page runs in a store of cookies and site data: the account's one shared
 *  store, one of the space's own, or one per site. That choice used to be each
 *  computer's, so one space could be signed in to a site on the laptop and not on
 *  the desktop, and nothing that travels could follow it. It is the space's now,
 *  written by its owner and read by everybody in it off the listing - a member runs
 *  the owner's pages the way the owner set them up. See docs/sync-v2.md section 6.1
 *  and open question 3. */

import { Hono } from 'hono'
import { readBody } from '../body'
import { now } from '../crypto'
import { laterOf, pokeSpace } from '../hub/poke'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

const STORES = ['global', 'space', 'site'] as const
export type WebStore = (typeof STORES)[number]

const isWebStore = (value: unknown): value is WebStore =>
  typeof value === 'string' && (STORES as readonly string[]).includes(value)

/** The store a row says, and the shared one for a row from before there was a
 *  choice to make. */
export function webStoreOf(raw: unknown): WebStore {
  return isWebStore(raw) ? raw : 'global'
}

export const webStore = new Hono<{ Bindings: Env; Variables: Variables }>()

webStore.put('/:id/web-store', atLeast('owner'), async (context) => {
  const body = await readBody(context)
  const store = body.text('store', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!isWebStore(store)) return context.json({ error: 'choose global, space or site' }, 400)

  const space = spaceOf(context)
  await context.env.DB.prepare('update spaces set web_store = ?, updated_at = ? where id = ?')
    .bind(store, now(), space.id)
    .run()

  // Every computer in the space learns it at once rather than at its next poll: a
  // page opened there before then would open in the store it is leaving.
  const cursor = await context.env.DB.prepare(
    'select next - 1 as seq from space_cursor where space_id = ?',
  )
    .bind(space.id)
    .first<{ seq: number }>()
  await pokeSpace(context.env, laterOf(context), space.id, cursor?.seq ?? 0)

  return context.json({ webStore: store })
})
