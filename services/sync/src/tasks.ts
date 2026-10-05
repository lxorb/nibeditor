/** A task added from outside the app: the clipper's "As a task" (docs/tasks.md 3, row
 *  16), a line in the space's inbox with the page linked in it.
 *
 *  The same addition the account connector's `add_task` makes (mcp/tasks.ts), behind
 *  the session every other route of a space is behind, and told to the space's devices
 *  the way a note written through the notes route is. */

import { Hono } from 'hono'
import { readBody } from './body'
import { laterOf, pokeSpace } from './hub/poke'
import { addTaskTo, refusalOf } from './mcp/tasks'
import { atLeast, spaceOf } from './spaces/space'
import { deviceOf } from './sync2/device'
import type { Env, Variables } from './types'

/** How long one task's words may be: a line, with a long link in it. */
const LONGEST = 2000

export const tasks = new Hono<{ Bindings: Env; Variables: Variables }>()

tasks.post('/spaces/:spaceId/tasks', atLeast('write', 'spaceId'), async (context) => {
  const space = spaceOf(context)
  const body = await readBody(context)
  const text = body.text('text', LONGEST)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!text?.trim()) return context.json({ error: 'say the task' }, 400)

  try {
    const added = await addTaskTo(context.env, space, { text: text.replace(/\s+/g, ' ') })
    const note = await context.env.DB.prepare(
      "select seq from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
    )
      .bind(space.id, added.path)
      .first<{ seq: number }>()
    if (note)
      await pokeSpace(context.env, laterOf(context), space.id, note.seq, await deviceOf(context))
    return context.json(added, 201)
  } catch (error) {
    const said = refusalOf(error)
    if (said === null) throw error
    return context.json({ error: said }, 400)
  }
})
